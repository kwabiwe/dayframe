import AsyncStorage from "@react-native-async-storage/async-storage";
import { TimelineCorrectionRequestSchema, type TimelineCorrectionRequest } from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError,
  isMobileTransportFailure,
  mobileFetchWithTimeout
} from "./mobile-network";
import { isAuthenticatedSessionSnapshotCurrent, readOwnedAuthenticatedSessionSnapshot } from "./secure-session";
import { mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "./mobileAccount";

/**
 * The iPhone's queue of location timeline corrections (location v4 step 12): what the person set in a place,
 * trip or leg sheet, kept on the phone until `POST /api/timeline/corrections` has it. Owner-scoped like the
 * time-entry outbox; each correction carries its own `clientCorrectionId`, so a resend after a lost reply is
 * answered with the correction already made (#597). Sent in order, foreground-owned, in the same passes as
 * Review's changes; a refusal (the item changed or is in a block) is kept for the List to say why, then
 * dropped. Holds item ids, place ids, times and modes, never coordinates.
 */

const TIMELINE_CORRECTION_OUTBOX_KEY = "dayframe.timelineCorrectionOutbox.v1";
const TIMELINE_CORRECTION_UNREADABLE_KEY = `${TIMELINE_CORRECTION_OUTBOX_KEY}.unreadable`;
const PERMANENT_STATUS_CODES = new Set([400, 404, 409, 413, 422]);
const RETRY_BACKOFF_SECONDS = [5, 15, 30, 120, 300, 900];
export const MOBILE_TIMELINE_CORRECTION_TIMEOUT_MS = 8_000;

export type PendingTimelineCorrection = MobileAccountOwner & {
  clientCorrectionId: string;
  request: TimelineCorrectionRequest & { clientCorrectionId: string };
  /** What the List shows until the server has it (never sent): the chosen place's name and role. */
  preview?: TimelineCorrectionPreview;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt?: string;
  lastError?: string;
  lastStatusCode?: number;
  /** "permanent": refused; the List says why once, then it is dropped. */
  failureKind?: "retryable" | "permanent";
};

export type TimelineCorrectionPreview = { name: string | null; role?: string | null };

export type TimelineCorrectionSyncResult = {
  deliveredCount: number;
  /** Corrections still to send (not refused). */
  waitingCount: number;
  /** Refused during this pass. */
  refused: PendingTimelineCorrection[];
  reason: "drained" | "retry_wait" | "retryable_failure" | "authentication_required" | "session_changed" | "background";
};

/** A correction the server has, kept a short while so the List keeps showing it until a timeline read after it lands. */
export type AcknowledgedTimelineCorrection = PendingTimelineCorrection & { acknowledgedAt: number };
const ACKNOWLEDGED_KEEP_MS = 5 * 60_000;
let acknowledged: AcknowledgedTimelineCorrection[] = [];
/** Goes up once at the end of each send pass that delivered something: the List reads its timeline again then. */
let refreshRevision = 0;

export function readTimelineCorrectionRefreshRevision() {
  return refreshRevision;
}

const listeners = new Set<() => void>();
const inFlightByOwner = new Map<string, Promise<TimelineCorrectionSyncResult>>();
let mutationTail: Promise<void> = Promise.resolve();

/** Serialises every read-modify-write of the stored queue. */
function withMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(work, work);
  mutationTail = run.then(() => undefined, () => undefined);
  return run;
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeTimelineCorrectionOutbox(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A random v4 UUID, the correction's id on every attempt. */
export function createTimelineCorrectionId(random = Math.random) {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Stored = { items: PendingTimelineCorrection[]; /** Records this version can't read (another version's): kept as they are. */ unknown: unknown[] };

async function readStore(): Promise<Stored> {
  const raw = await AsyncStorage.getItem(TIMELINE_CORRECTION_OUTBOX_KEY);
  if (!raw) return { items: [], unknown: [] };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) {
    // Unreadable as a whole: set aside as it is in one slot (the latest), and the queue starts again; logout
    // removes it (Codex r1 and r2 on #598).
    await AsyncStorage.setItem(TIMELINE_CORRECTION_UNREADABLE_KEY, raw);
    await AsyncStorage.removeItem(TIMELINE_CORRECTION_OUTBOX_KEY);
    return { items: [], unknown: [] };
  }
  const items: PendingTimelineCorrection[] = [];
  const unknown: unknown[] = [];
  for (const record of parsed) {
    const item = parseStored(record);
    if (item) items.push(item);
    else unknown.push(record);
  }
  return { items, unknown };
}

async function readAll() {
  return (await readStore()).items;
}

/** Rewrites the queue from this version's records, keeping every record it can't read exactly as it was. */
async function updateAll(
  change: (items: PendingTimelineCorrection[]) => PendingTimelineCorrection[],
  keepUnknown: (record: unknown) => boolean = () => true
) {
  const stored = await readStore();
  await writeStore(stored, change(stored.items), keepUnknown);
}

async function writeStore(stored: Stored, items: PendingTimelineCorrection[], keepUnknown: (record: unknown) => boolean = () => true) {
  const next = [...items, ...stored.unknown.filter(keepUnknown)];
  if (next.length === 0) await AsyncStorage.removeItem(TIMELINE_CORRECTION_OUTBOX_KEY);
  else await AsyncStorage.setItem(TIMELINE_CORRECTION_OUTBOX_KEY, JSON.stringify(next));
}

function parseStored(value: unknown): PendingTimelineCorrection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const request = TimelineCorrectionRequestSchema.safeParse(item.request);
  if (!request.success || !request.data.clientCorrectionId) return null;
  if (typeof item.userId !== "string" || typeof item.workspaceId !== "string") return null;
  if (item.clientCorrectionId !== request.data.clientCorrectionId) return null;
  if (typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) return null;
  return {
    userId: item.userId,
    workspaceId: item.workspaceId,
    clientCorrectionId: request.data.clientCorrectionId,
    request: { ...request.data, clientCorrectionId: request.data.clientCorrectionId },
    ...(parsePreview(item.preview) ? { preview: parsePreview(item.preview)! } : {}),
    createdAt: item.createdAt,
    attemptCount: typeof item.attemptCount === "number" && item.attemptCount >= 0 ? item.attemptCount : 0,
    ...(typeof item.nextAttemptAt === "string" && Number.isFinite(Date.parse(item.nextAttemptAt)) ? { nextAttemptAt: item.nextAttemptAt } : {}),
    ...(typeof item.lastError === "string" ? { lastError: item.lastError } : {}),
    ...(typeof item.lastStatusCode === "number" ? { lastStatusCode: item.lastStatusCode } : {}),
    ...(item.failureKind === "retryable" || item.failureKind === "permanent" ? { failureKind: item.failureKind } : {})
  };
}

function parsePreview(value: unknown): TimelineCorrectionPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.name !== null && typeof item.name !== "string") return null;
  return { name: item.name as string | null, ...(typeof item.role === "string" ? { role: item.role } : {}) };
}

/** Keeps a correction on the phone (it shows at once) and returns it; send with `synchroniseTimelineCorrections`. */
export async function enqueueTimelineCorrection(
  owner: MobileAccountOwner,
  request: TimelineCorrectionRequest,
  options: { now?: Date; createId?: () => string; preview?: TimelineCorrectionPreview } = {}
) {
  const clientCorrectionId = request.clientCorrectionId ?? (options.createId ?? createTimelineCorrectionId)();
  const parsed = TimelineCorrectionRequestSchema.parse({ ...request, clientCorrectionId });
  const item: PendingTimelineCorrection = {
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    clientCorrectionId,
    request: { ...parsed, clientCorrectionId },
    ...(options.preview ? { preview: options.preview } : {}),
    createdAt: (options.now ?? new Date()).toISOString(),
    attemptCount: 0
  };
  await withMutation(() => updateAll((items) => [...items, item]));
  notify();
  return item;
}

/** This owner's corrections, oldest first, refused ones included. */
export async function readPendingTimelineCorrections(owner: MobileAccountOwner) {
  // In the mutation chain: a read may set an unreadable queue aside, which must not race a write.
  return (await withMutation(readAll)).filter((item) => mobileAccountOwnersEqual(item, owner));
}

/** This owner's corrections the server has had for less than five minutes (see `AcknowledgedTimelineCorrection`). */
export function readAcknowledgedTimelineCorrections(owner: MobileAccountOwner, nowMs = Date.now()) {
  acknowledged = acknowledged.filter((item) => nowMs - item.acknowledgedAt < ACKNOWLEDGED_KEEP_MS);
  return acknowledged.filter((item) => mobileAccountOwnersEqual(item, owner));
}

async function removeQuietly(clientCorrectionIds: readonly string[]) {
  if (clientCorrectionIds.length === 0) return;
  const ids = new Set(clientCorrectionIds);
  await withMutation(() => updateAll((items) => items.filter((item) => !ids.has(item.clientCorrectionId))));
}

/** Drops corrections (a refusal the List has shown, or Discard). */
export async function removeTimelineCorrections(clientCorrectionIds: readonly string[]) {
  if (clientCorrectionIds.length === 0) return;
  await removeQuietly(clientCorrectionIds);
  notify();
}

/** Logout or account switch: this owner's corrections leave with the account (others' were never sent). */
export async function clearTimelineCorrectionsForOwner(owner: MobileAccountOwner) {
  // Its records this version can't read leave too, when they say whose they are; others' stay (Codex r2 on #598).
  const theirs = (record: unknown) => {
    const item = record as { userId?: unknown; workspaceId?: unknown } | null;
    return !(item && item.userId === owner.userId && item.workspaceId === owner.workspaceId);
  };
  await withMutation(async () => {
    await updateAll((items) => items.filter((item) => !mobileAccountOwnersEqual(item, owner)), theirs);
    await AsyncStorage.removeItem(TIMELINE_CORRECTION_UNREADABLE_KEY);
  });
  acknowledged = acknowledged.filter((item) => !mobileAccountOwnersEqual(item, owner));
  notify();
}

export async function getTimelineCorrectionDiagnostics(owner: MobileAccountOwner) {
  const items = await readPendingTimelineCorrections(owner);
  const waiting = items.filter((item) => item.failureKind !== "permanent");
  // Sent in order: only the first one waiting decides when the queue can move (Codex r1 on #598).
  const nextRetryAt = waiting[0]?.nextAttemptAt ?? null;
  return {
    pendingCount: waiting.length,
    refusedCount: items.length - waiting.length,
    nextRetryAt,
    lastError: waiting.find((item) => item.lastError)?.lastError ?? null
  };
}

/** Sends this owner's corrections in order, one pass at a time per owner. */
export function synchroniseTimelineCorrections(input: DrainInput) {
  const key = mobileAccountKey(input.owner);
  const existing = inFlightByOwner.get(key);
  if (existing) return existing;
  const pass = runDrain(input).finally(() => {
    if (inFlightByOwner.get(key) === pass) inFlightByOwner.delete(key);
  });
  inFlightByOwner.set(key, pass);
  return pass;
}

type DrainInput = {
  owner: MobileAccountOwner;
  force?: boolean;
  now?: Date;
  signal?: AbortSignal;
  /** Checked before each send: corrections are foreground-owned, so a pass stops when the app leaves. */
  isForeground?: () => boolean;
};

async function runDrain(input: DrainInput): Promise<TimelineCorrectionSyncResult> {
  let deliveredCount = 0;
  const refused: PendingTimelineCorrection[] = [];
  const finish = async (reason: TimelineCorrectionSyncResult["reason"]) => {
    const waitingCount = (await readPendingTimelineCorrections(input.owner)).filter((item) => item.failureKind !== "permanent").length;
    if (deliveredCount > 0) refreshRevision += 1;
    if (deliveredCount > 0 || refused.length > 0) notify();
    return { deliveredCount, waitingCount, refused, reason };
  };
  while (true) {
    if (!mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)) return finish("session_changed");
    if (input.signal?.aborted) return finish("retryable_failure");
    if (input.isForeground && !input.isForeground()) return finish("background");
    const next = (await readPendingTimelineCorrections(input.owner)).find((item) => item.failureKind !== "permanent");
    if (!next) return finish("drained");
    const now = input.now ?? new Date();
    if (!input.force && next.nextAttemptAt && Date.parse(next.nextAttemptAt) > now.getTime()) return finish("retry_wait");
    const session = await readOwnedAuthenticatedSessionSnapshot(input.owner);
    if (session.status !== "authenticated") {
      return finish(session.status === "signed_out" ? "authentication_required" : "session_changed");
    }
    // Checked again right before sending: the app may have left while the queue and session were read.
    if (input.isForeground && !input.isForeground()) return finish("background");
    const attemptedAt = new Date().toISOString();
    const stillCurrent = async () => isAuthenticatedSessionSnapshotCurrent(session.snapshot) &&
      mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner);
    let response: Response;
    try {
      response = await mobileFetchWithTimeout(`${DAYFRAME_API_BASE}/api/timeline/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.snapshot.token}` },
        body: JSON.stringify(next.request),
        signal: input.signal
      }, {
        timeoutMilliseconds: MOBILE_TIMELINE_CORRECTION_TIMEOUT_MS,
        timeoutMessage: "This change is saved on your iPhone and will retry automatically."
      });
    } catch (error) {
      // An answer for a session that has since changed: not this correction's fault (Codex r1 on #598).
      if (error instanceof StaleMobileSessionResponseError || !await stillCurrent()) return finish("session_changed");
      const retryable = input.signal?.aborted || error instanceof MobileRequestTimeoutError || isMobileTransportFailure(error);
      const kept = await recordFailure(next.clientCorrectionId, attemptedAt, !retryable,
        error instanceof Error ? error.message : "Network request failed.", stillCurrent);
      if (kept === "session_changed") return finish("session_changed");
      if (retryable) return finish("retryable_failure");
      if (kept) refused.push(kept);
      continue;
    }
    if (response.status === 401 || response.status === 403) return finish("authentication_required");
    if (!await stillCurrent()) return finish("session_changed");
    if (response.ok) {
      // Kept on the List until a timeline read after it lands; the pass says so once, at its end.
      acknowledged = [...acknowledged.filter((item) => item.clientCorrectionId !== next.clientCorrectionId),
        { ...next, acknowledgedAt: Date.now() }];
      deliveredCount += 1;
      try {
        await removeQuietly([next.clientCorrectionId]);
      } catch {
        // Saved on the server; only the local copy stayed. Sent again later, its id answers it (Codex r2 on #598).
        return finish("retryable_failure");
      }
      continue;
    }
    const permanent = PERMANENT_STATUS_CODES.has(response.status);
    const message = await responseMessage(response);
    // The account may have changed while the reply was read or the queue written: then this correction is not
    // touched (Codex r2 and r3 on #598).
    const kept = await recordFailure(next.clientCorrectionId, attemptedAt, permanent, message, stillCurrent, response.status);
    if (kept === "session_changed") return finish("session_changed");
    if (!permanent) return finish("retryable_failure");
    if (kept) refused.push(kept);
  }
}

/**
 * Records a failed send. `stillCurrent` is checked inside the write, after the queue is read: a correction is
 * never marked for an account that has just left (Codex r3 on #598). Null when it was not recorded.
 */
async function recordFailure(
  clientCorrectionId: string,
  attemptedAt: string,
  permanent: boolean,
  message: string,
  stillCurrent: () => Promise<boolean>,
  statusCode?: number
): Promise<PendingTimelineCorrection | "session_changed" | null> {
  let kept: PendingTimelineCorrection | null = null;
  let changed = false;
  await withMutation(async () => {
    const stored = await readStore();
    if (!await stillCurrent()) {
      changed = true;
      return;
    }
    await writeStore(stored, stored.items.map((item) => {
      if (item.clientCorrectionId !== clientCorrectionId) return item;
      const attemptCount = item.attemptCount + 1;
      kept = {
        ...item,
        attemptCount,
        lastError: message,
        ...(statusCode == null ? {} : { lastStatusCode: statusCode }),
        failureKind: permanent ? "permanent" : "retryable",
        ...(permanent ? {} : { nextAttemptAt: nextRetryAt(attemptedAt, attemptCount) })
      };
      return kept;
    }));
  });
  if (changed) return "session_changed";
  notify();
  return kept as PendingTimelineCorrection | null;
}

export function nextRetryAt(attemptedAt: string, attemptCount: number, random = Math.random) {
  const baseSeconds = RETRY_BACKOFF_SECONDS[Math.min(Math.max(attemptCount, 1), RETRY_BACKOFF_SECONDS.length) - 1];
  const jitter = 0.8 + Math.max(0, Math.min(random(), 1)) * 0.4;
  return new Date(Date.parse(attemptedAt) + Math.round(baseSeconds * jitter * 1000)).toISOString();
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : `The change wasn't saved (${response.status}).`;
  } catch {
    return `The change wasn't saved (${response.status}).`;
  }
}

export function __resetTimelineCorrectionOutboxForTests() {
  acknowledged = [];
  refreshRevision = 0;
  listeners.clear();
  inFlightByOwner.clear();
  mutationTail = Promise.resolve();
}
