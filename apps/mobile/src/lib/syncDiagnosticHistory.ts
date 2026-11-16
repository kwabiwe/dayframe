import { DAYFRAME_API_BASE } from "./config";
import {
  currentMobileAccountEpoch,
  getActiveMobileAccountSnapshot,
  mobileAccountOwnersEqual,
  type MobileAccountOwner
} from "./mobileAccount";
import {
  currentSessionGeneration,
  isAuthenticatedSessionSnapshotCurrent,
  peekAuthenticatedSessionOwner,
  readOwnedAuthenticatedSessionSnapshot
} from "./secure-session";

const HISTORY_KEY = "dayframe.syncDiagnosticHistory.v1";
export const MAX_SYNC_DIAGNOSTIC_RECORDS = 200;
const MAX_STORAGE_LENGTH = 64 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LANES = ["timer_stop", "timer_activity", "legacy_location", "location_upload", "recovery", "connectivity"] as const;
const REASONS = ["transport", "server", "invalid_acknowledgement", "target_unavailable"] as const;
const EVENTS = [
  "queued", "attempted", "delivered", "retry_pending", "retry_scheduled", "rejected",
  "partial", "rebatched", "discarded", "offline", "online", "completed", "failed",
  "interrupted", "authentication_required"
] as const;

type Lane = typeof LANES[number];
type Event = typeof EVENTS[number];
export type SyncDiagnosticReason = typeof REASONS[number];
type Fields = {
  lane: Lane;
  event: Event;
  reason?: SyncDiagnosticReason;
  attempt?: number;
  status?: number;
  retryAt?: number;
  pending?: number;
};
type Diagnostic = Fields & { at: number; work?: string };
type Pending = Diagnostic & { workId?: string };
type Scope = { owner: MobileAccountOwner; epoch: number; generation: number };

let pending: { scope: Scope; records: Pending[] } | undefined;
let writing: Promise<void> | undefined;
let partitionCache: { scope: Scope; hash: Promise<string> } | undefined;

// Capture before async work; comparing only UUIDs would admit stale work after A → B → A.
function hasCurrentAccount(owner: MobileAccountOwner) {
  const sessionOwner = peekAuthenticatedSessionOwner();
  // Before the cold Keychain read, the durable queue can still accept owned work. A known
  // signed-out or different session, including the window before account activation, cannot.
  return mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner) &&
    (sessionOwner === undefined || mobileAccountOwnersEqual(sessionOwner, owner));
}

export function captureSyncDiagnosticScope(owner = getActiveMobileAccountSnapshot()): Scope | undefined {
  if (!owner || !hasCurrentAccount(owner)) return;
  return {
    owner: { workspaceId: owner.workspaceId, userId: owner.userId },
    epoch: currentMobileAccountEpoch(),
    generation: currentSessionGeneration()
  };
}

export function isSyncDiagnosticScopeCurrent(scope: Scope) {
  return scope.epoch === currentMobileAccountEpoch() && scope.generation === currentSessionGeneration() &&
    hasCurrentAccount(scope.owner);
}

let storageModule: Promise<typeof import("./syncDiagnosticStorage")> | undefined;
function loadStorage() {
  return storageModule ??= import("./syncDiagnosticStorage");
}

async function hash(value: string) {
  const { hashSyncDiagnosticValue } = await loadStorage();
  return hashSyncDiagnosticValue(value);
}

function partitionFor(scope: Scope) {
  if (partitionCache?.scope.epoch !== scope.epoch || !mobileAccountOwnersEqual(partitionCache?.scope.owner, scope.owner)) {
    // Store an opaque partition tag, never workspace/user IDs or the API origin.
    const partition = ["dayframe.sync-history.v1", new URL(DAYFRAME_API_BASE).origin, scope.owner.workspaceId, scope.owner.userId];
    partitionCache = { scope, hash: hash(JSON.stringify(partition)) };
    const cached = partitionCache;
    void cached.hash.catch(() => { if (partitionCache === cached) partitionCache = undefined; });
  }
  return partitionCache.hash;
}

function known<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && list.some((item) => item === value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function diagnostic(value: unknown, now: number): Diagnostic | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!known(row.lane, LANES) || !known(row.event, EVENTS) ||
      !integer(row.at, now - MAX_AGE_MS, now)) return null;
  // Reconstruct at both boundaries. No error text, event/entry IDs, capture times, or payloads.
  return {
    lane: row.lane,
    event: row.event,
    at: row.at,
    ...(known(row.reason, REASONS) ? { reason: row.reason } : {}),
    ...(integer(row.attempt, 1, 1_000_000) ? { attempt: row.attempt } : {}),
    ...(integer(row.status, 100, 599) ? { status: row.status } : {}),
    ...(integer(row.retryAt, row.at - MAX_AGE_MS, row.at + MAX_AGE_MS) ? { retryAt: row.retryAt } : {}),
    ...(integer(row.pending, 0, 1_000_000) ? { pending: row.pending } : {}),
    ...(typeof row.work === "string" && /^[a-f0-9]{24}$/.test(row.work) ? { work: row.work } : {})
  };
}

export function recordSyncDiagnostic(scope: Scope | undefined, fields: Fields, workId?: string) {
  if (!scope || !isSyncDiagnosticScopeCurrent(scope)) return;
  const at = Date.now();
  const row = diagnostic({
    lane: fields.lane, event: fields.event, at, reason: fields.reason, attempt: fields.attempt,
    status: fields.status, retryAt: fields.retryAt, pending: fields.pending
  }, at);
  if (!row) return;
  if (!pending || !isSyncDiagnosticScopeCurrent(pending.scope)) pending = { scope, records: [] };
  if (pending.records.length >= MAX_SYNC_DIAGNOSTIC_RECORDS) pending.records.shift();
  // Retain an internal work ID only until hashing; do not use server or entry IDs.
  pending.records.push({ ...row, workId: typeof workId === "string" && workId.length <= 256 ? workId : undefined });
  flushPendingHistory();
}

function flushPendingHistory() {
  if (writing || !pending) return;
  // One bounded batch per write, outside all durable work lanes. No periodic timer.
  writing = Promise.resolve().then(async () => {
    const batch = pending;
    pending = undefined;
    if (!batch || !isSyncDiagnosticScopeCurrent(batch.scope)) return;
    const partition = await partitionFor(batch.scope);
    const existing = await readHistory(partition);
    const hashes = new Map<string, Promise<string>>();
    const rows = await Promise.all(batch.records.map(async ({ workId, ...row }) => {
      if (!workId) return row;
      const key = JSON.stringify([partition, row.lane, workId]);
      let work = hashes.get(key);
      if (!work) {
        work = hash(key);
        hashes.set(key, work);
      }
      return { ...row, work: (await work).slice(0, 24) };
    }));
    if (!isSyncDiagnosticScopeCurrent(batch.scope)) return;
    const records = [...existing, ...rows].slice(-MAX_SYNC_DIAGNOSTIC_RECORDS);
    const { syncDiagnosticStorage } = await loadStorage();
    if (isSyncDiagnosticScopeCurrent(batch.scope)) {
      await syncDiagnosticStorage.setItemAsync(HISTORY_KEY, JSON.stringify({ partition, records }));
    }
  }).catch(() => {
    // Diagnostics can be lost if storage is unavailable; delivery must never wait for them.
  }).finally(() => {
    writing = undefined;
    flushPendingHistory();
  });
}

async function readHistory(partition: string): Promise<Diagnostic[]> {
  const { syncDiagnosticStorage } = await loadStorage();
  const raw = await syncDiagnosticStorage.getItemAsync(HISTORY_KEY);
  if (!raw || raw.length > MAX_STORAGE_LENGTH) return [];
  try {
    const snapshot = JSON.parse(raw);
    if (snapshot?.partition !== partition || !Array.isArray(snapshot.records)) return [];
    const now = Date.now();
    return snapshot.records.slice(-MAX_SYNC_DIAGNOSTIC_RECORDS).flatMap((value: unknown) => {
      const row = diagnostic(value, now);
      return row ? [row] : [];
    });
  } catch {
    return [];
  }
}

/** An explicit foreground action. Check the same account and session immediately before sharing. */
export async function exportSyncDiagnosticHistory(
  scope: Scope | undefined,
  share: (content: { title: string; message: string }) => Promise<unknown>,
  isVisible: () => boolean
) {
  if (!scope || !isSyncDiagnosticScopeCurrent(scope) || !isVisible()) return false;
  const session = await readOwnedAuthenticatedSessionSnapshot(scope.owner);
  if (session.status !== "authenticated") return false;
  // Include work already submitted without letting ongoing writes indefinitely postpone sharing.
  await writing;
  await writing;
  if (!isSyncDiagnosticScopeCurrent(scope)) return false;
  const records = await readHistory(await partitionFor(scope));
  const message = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    records: records.map(({ at, retryAt, ...row }) => ({
      ...row,
      at: new Date(at).toISOString(),
      ...(retryAt === undefined ? {} : { retryAt: new Date(retryAt).toISOString() })
    }))
  }, null, 2);
  if (!isVisible() || !isSyncDiagnosticScopeCurrent(scope) || !isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return false;
  await share({ title: "Dayframe sync diagnostics", message });
  return true;
}
