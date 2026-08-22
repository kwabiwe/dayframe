import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileRequestTimeoutError,
  isMobileTransportFailure,
  mobileFetchWithTimeout
} from "./mobile-network";
import {
  isAuthenticatedSessionSnapshotCurrent,
  readAuthenticatedSessionSnapshot
} from "./secure-session";
import {
  mobileAccountKey,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import type { TimeEntryUpdatePatch } from "./api";

const TIME_ENTRY_OUTBOX_KEY = "dayframe.timeEntryOutbox.v1";
export const MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS = 8_000;
const PERMANENT_STATUS_CODES = new Set([400, 409, 413, 422]);
const RETRY_BACKOFF_SECONDS = [5, 15, 30, 120, 300, 900];

export type PendingTimeEntryCommand = MobileAccountOwner & {
  clientCommandId: string;
  operation: "update" | "delete";
  targetEntryId?: string;
  optimisticEntryId?: string;
  patch?: TimeEntryUpdatePatch;
  deliverAfter?: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt?: string;
  lastAttemptedAt?: string;
  lastError?: string;
  lastStatusCode?: number;
  failureKind?: "retryable" | "permanent";
};

export type TimeEntryCommandTarget =
  | { targetEntryId: string; optimisticEntryId?: never }
  | { optimisticEntryId: string; targetEntryId?: never };

export type TimeEntryOutboxSyncResult = {
  deliveredCount: number;
  waitingCount: number;
  needsAttentionCount: number;
  stopped: boolean;
  reason?:
    | "authentication_required"
    | "dependency_wait"
    | "deferred"
    | "retry_wait"
    | "retryable_failure"
    | "session_changed";
};

let mutationTail: Promise<void> = Promise.resolve();
const syncInFlightByOwner = new Map<string, Promise<TimeEntryOutboxSyncResult>>();
const listeners = new Set<() => void>();

export async function enqueueTimeEntryUpdate(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  patch: TimeEntryUpdatePatch;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "update",
    patch: input.patch
  });
}

export async function enqueueTimeEntryDelete(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  deliverAfter?: string;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "delete",
    deliverAfter: input.deliverAfter
  });
}

export async function releaseTimeEntryCommands(clientCommandIds: readonly string[]) {
  const ids = new Set(clientCommandIds);
  if (ids.size === 0) return 0;
  return withMutation(async () => {
    const all = await readAllCommands();
    let releasedCount = 0;
    const next = all.map((command) => {
      if (!ids.has(command.clientCommandId) || !command.deliverAfter) return command;
      releasedCount += 1;
      const { deliverAfter: _deliverAfter, ...released } = command;
      return { ...released, updatedAt: new Date().toISOString() };
    });
    if (releasedCount > 0) await writeAllCommands(next);
    return releasedCount;
  });
}

export async function removeTimeEntryCommands(clientCommandIds: readonly string[]) {
  const ids = new Set(clientCommandIds);
  if (ids.size === 0) return 0;
  return withMutation(async () => {
    const all = await readAllCommands();
    const next = all.filter((command) => !ids.has(command.clientCommandId));
    const removedCount = all.length - next.length;
    if (removedCount > 0) await writeAllCommands(next);
    return removedCount;
  });
}

export async function readPendingTimeEntryCommands(
  owner?: MobileAccountOwner
): Promise<PendingTimeEntryCommand[]> {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return [];
  const all = await readAllCommands();
  return all.filter((command) => mobileAccountOwnersEqual(command, resolvedOwner));
}

export async function resolvePendingTimeEntryCommandTargets(
  owner: MobileAccountOwner,
  correlations: ReadonlyMap<string, string>
) {
  if (correlations.size === 0) return readPendingTimeEntryCommands(owner);
  return withMutation(async () => {
    const all = await readAllCommands();
    let changed = false;
    const next = all.map((command) => {
      if (
        !mobileAccountOwnersEqual(command, owner) ||
        !command.optimisticEntryId ||
        command.targetEntryId
      ) {
        return command;
      }
      const targetEntryId = correlations.get(command.optimisticEntryId);
      if (!targetEntryId) return command;
      changed = true;
      return { ...command, targetEntryId, updatedAt: new Date().toISOString() };
    });
    if (changed) await writeAllCommands(next);
    return next.filter((command) => mobileAccountOwnersEqual(command, owner));
  });
}

export async function synchroniseTimeEntryCommands(input: {
  owner: MobileAccountOwner;
  correlations: ReadonlyMap<string, string>;
  force?: boolean;
  now?: Date;
}): Promise<TimeEntryOutboxSyncResult> {
  const ownerKey = mobileAccountKey(input.owner);
  const existing = syncInFlightByOwner.get(ownerKey);
  if (existing) return existing;
  const sync = runTimeEntryCommandDrain(input).finally(() => {
    if (syncInFlightByOwner.get(ownerKey) === sync) {
      syncInFlightByOwner.delete(ownerKey);
    }
  });
  syncInFlightByOwner.set(ownerKey, sync);
  return sync;
}

export async function getTimeEntryOutboxDiagnostics(owner?: MobileAccountOwner) {
  const commands = await readPendingTimeEntryCommands(owner);
  const retryable = commands.filter((command) => command.failureKind !== "permanent");
  const permanent = commands.filter((command) => command.failureKind === "permanent");
  return {
    pendingCount: retryable.length,
    needsAttentionCount: permanent.length,
    nextRetryAt: retryable
      .flatMap((command) => [command.nextAttemptAt, command.deliverAfter]
        .filter((value): value is string => Boolean(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
    lastError: [...commands]
      .reverse()
      .find((command) => command.lastError)?.lastError ?? null
  };
}

export function subscribeTimeEntryOutbox(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __resetTimeEntryOutboxForTests() {
  mutationTail = Promise.resolve();
  syncInFlightByOwner.clear();
  listeners.clear();
}

async function runTimeEntryCommandDrain(input: {
  owner: MobileAccountOwner;
  correlations: ReadonlyMap<string, string>;
  force?: boolean;
  now?: Date;
}): Promise<TimeEntryOutboxSyncResult> {
  if (!mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)) {
    return currentOutboxResult(input.owner, 0, true, "session_changed");
  }
  let deliveredCount = 0;
  const now = input.now ?? new Date();

  while (true) {
    const { all, command: original } = await withMutation(async () => {
      const current = await readAllCommands();
      return {
        all: current,
        command: current.find((command) =>
          mobileAccountOwnersEqual(command, input.owner) && command.failureKind !== "permanent"
        )
      };
    });
    if (!original) return outboxResult(all, input.owner, deliveredCount, false);
    if (original.deliverAfter && Date.parse(original.deliverAfter) > now.getTime()) {
      return outboxResult(all, input.owner, deliveredCount, true, "deferred");
    }
    const targetEntryId = original.targetEntryId ?? (
      original.optimisticEntryId
        ? input.correlations.get(original.optimisticEntryId)
        : undefined
    );
    if (!targetEntryId) {
      return outboxResult(all, input.owner, deliveredCount, true, "dependency_wait");
    }
    if (!input.force && original.nextAttemptAt && Date.parse(original.nextAttemptAt) > now.getTime()) {
      return outboxResult(all, input.owner, deliveredCount, true, "retry_wait");
    }

    const attemptedAt = new Date().toISOString();
    const sessionRead = await readAuthenticatedSessionSnapshot();
    if (sessionRead.status !== "authenticated") {
      return currentOutboxResult(input.owner, deliveredCount, true, "authentication_required");
    }
    if (!mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)) {
      return currentOutboxResult(input.owner, deliveredCount, true, "session_changed");
    }

    try {
      const response = await mobileFetchWithTimeout(
        `${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(targetEntryId)}`,
        {
          method: original.operation === "delete" ? "DELETE" : "PATCH",
          headers: {
            ...(original.operation === "update" ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${sessionRead.snapshot.token}`
          },
          ...(original.operation === "update"
            ? { body: JSON.stringify(original.patch ?? {}) }
            : {})
        },
        {
          timeoutMilliseconds: MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS,
          timeoutMessage: "This change is saved on your iPhone and will retry automatically."
        }
      );
      if (
        !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) ||
        !mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)
      ) {
        return currentOutboxResult(input.owner, deliveredCount, true, "session_changed");
      }
      if (response.status === 401 || response.status === 403) {
        return currentOutboxResult(input.owner, deliveredCount, true, "authentication_required");
      }
      if (response.ok || (original.operation === "delete" && response.status === 404)) {
        const removed = await removeDeliveredCommand(original.clientCommandId);
        if (removed) deliveredCount += 1;
        continue;
      }

      const permanent = PERMANENT_STATUS_CODES.has(response.status) || response.status === 404;
      const message = await safeResponseMessage(response);
      const current = await retainCommandFailure(original.clientCommandId, attemptedAt, {
        kind: permanent ? "permanent" : "retryable",
        message,
        statusCode: response.status
      });
      if (!permanent) {
        return outboxResult(current, input.owner, deliveredCount, true, "retryable_failure");
      }
    } catch (error) {
      const retryable = error instanceof MobileRequestTimeoutError || isMobileTransportFailure(error);
      const message = error instanceof Error ? error.message : "Network request failed.";
      const current = await retainCommandFailure(original.clientCommandId, attemptedAt, {
        kind: retryable ? "retryable" : "permanent",
        message
      });
      if (retryable) {
        return outboxResult(current, input.owner, deliveredCount, true, "retryable_failure");
      }
    }
  }
}

async function enqueueTimeEntryCommand(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  operation: "update" | "delete";
  patch?: TimeEntryUpdatePatch;
  deliverAfter?: string;
}) {
  const activeOwner = await readActiveMobileAccount();
  if (!mobileAccountOwnersEqual(activeOwner, input.owner)) {
    throw new Error("This change belongs to a different Dayframe account.");
  }
  return withMutation(async () => {
    const now = new Date().toISOString();
    const command: PendingTimeEntryCommand = {
      clientCommandId: generatedCommandId(),
      operation: input.operation,
      userId: input.owner.userId,
      workspaceId: input.owner.workspaceId,
      ...input.target,
      ...(input.operation === "update" ? { patch: input.patch ?? {} } : {}),
      ...(validIso(input.deliverAfter) ? { deliverAfter: input.deliverAfter } : {}),
      createdAt: now,
      updatedAt: now,
      attemptCount: 0
    };
    const all = await readAllCommands();
    await writeAllCommands([...all, command]);
    return command;
  });
}

async function readAllCommands(): Promise<PendingTimeEntryCommand[]> {
  const raw = await AsyncStorage.getItem(TIME_ENTRY_OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const command = parseCommand(value);
      return command ? [command] : [];
    });
  } catch {
    return [];
  }
}

async function writeAllCommands(commands: readonly PendingTimeEntryCommand[]) {
  await AsyncStorage.setItem(TIME_ENTRY_OUTBOX_KEY, JSON.stringify(commands));
  for (const listener of listeners) listener();
}

function withMutation<Result>(operation: () => Promise<Result>) {
  const result = mutationTail.catch(() => undefined).then(operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function currentOutboxResult(
  owner: MobileAccountOwner,
  deliveredCount: number,
  stopped: boolean,
  reason?: TimeEntryOutboxSyncResult["reason"]
) {
  return withMutation(async () =>
    outboxResult(await readAllCommands(), owner, deliveredCount, stopped, reason)
  );
}

function removeDeliveredCommand(clientCommandId: string) {
  return withMutation(async () => {
    const current = await readAllCommands();
    const next = current.filter((command) => command.clientCommandId !== clientCommandId);
    if (next.length === current.length) return false;
    await writeAllCommands(next);
    return true;
  });
}

function retainCommandFailure(
  clientCommandId: string,
  attemptedAt: string,
  input: { kind: "retryable" | "permanent"; message: string; statusCode?: number }
) {
  return withMutation(async () => {
    const current = await readAllCommands();
    const command = current.find((candidate) => candidate.clientCommandId === clientCommandId);
    if (!command) return current;
    const next = updateFailure(current, command, attemptedAt, input);
    await writeAllCommands(next);
    return next;
  });
}

function updateFailure(
  commands: PendingTimeEntryCommand[],
  command: PendingTimeEntryCommand,
  attemptedAt: string,
  input: { kind: "retryable" | "permanent"; message: string; statusCode?: number }
) {
  const attemptCount = command.attemptCount + 1;
  return commands.map((candidate) => candidate.clientCommandId !== command.clientCommandId
    ? candidate
    : {
        ...candidate,
        attemptCount,
        failureKind: input.kind,
        lastAttemptedAt: attemptedAt,
        lastError: input.message,
        ...(input.statusCode === undefined ? {} : { lastStatusCode: input.statusCode }),
        ...(input.kind === "retryable"
          ? { nextAttemptAt: nextRetryAt(attemptedAt, attemptCount) }
          : { nextAttemptAt: undefined }),
        updatedAt: new Date().toISOString()
      });
}

function outboxResult(
  commands: PendingTimeEntryCommand[],
  owner: MobileAccountOwner,
  deliveredCount: number,
  stopped: boolean,
  reason?: TimeEntryOutboxSyncResult["reason"]
): TimeEntryOutboxSyncResult {
  const owned = commands.filter((command) => mobileAccountOwnersEqual(command, owner));
  return {
    deliveredCount,
    waitingCount: owned.filter((command) => command.failureKind !== "permanent").length,
    needsAttentionCount: owned.filter((command) => command.failureKind === "permanent").length,
    stopped,
    ...(reason ? { reason } : {})
  };
}

function nextRetryAt(attemptedAt: string, attemptCount: number, random = Math.random) {
  const baseSeconds = RETRY_BACKOFF_SECONDS[
    Math.min(Math.max(attemptCount, 1), RETRY_BACKOFF_SECONDS.length) - 1
  ];
  const jitter = 0.8 + Math.max(0, Math.min(random(), 1)) * 0.4;
  return new Date(Date.parse(attemptedAt) + Math.round(baseSeconds * jitter * 1000)).toISOString();
}

async function safeResponseMessage(response: Response) {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error ?? body.message ?? `Time entry request failed: ${response.status}`;
  } catch {
    return `Time entry request failed: ${response.status}`;
  }
}

function parseCommand(value: unknown): PendingTimeEntryCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const clientCommandId = optionalText(item.clientCommandId);
  const operation = item.operation === "update" || item.operation === "delete"
    ? item.operation
    : null;
  const userId = optionalText(item.userId);
  const workspaceId = optionalText(item.workspaceId);
  const targetEntryId = optionalText(item.targetEntryId);
  const optimisticEntryId = optionalText(item.optimisticEntryId);
  const createdAt = validIso(item.createdAt);
  const updatedAt = validIso(item.updatedAt);
  if (
    !clientCommandId || !operation || !userId || !workspaceId ||
    (!targetEntryId && !optimisticEntryId) || !createdAt || !updatedAt
  ) {
    return null;
  }
  return {
    clientCommandId,
    operation,
    userId,
    workspaceId,
    ...(targetEntryId ? { targetEntryId } : {}),
    ...(optimisticEntryId ? { optimisticEntryId } : {}),
    ...(operation === "update" && item.patch && typeof item.patch === "object"
      ? { patch: item.patch as TimeEntryUpdatePatch }
      : {}),
    createdAt,
    updatedAt,
    attemptCount: typeof item.attemptCount === "number" && Number.isFinite(item.attemptCount)
      ? Math.max(0, Math.trunc(item.attemptCount))
      : 0,
    ...(validIso(item.nextAttemptAt) ? { nextAttemptAt: validIso(item.nextAttemptAt) as string } : {}),
    ...(validIso(item.lastAttemptedAt) ? { lastAttemptedAt: validIso(item.lastAttemptedAt) as string } : {}),
    ...(validIso(item.deliverAfter) ? { deliverAfter: validIso(item.deliverAfter) as string } : {}),
    ...(optionalText(item.lastError) ? { lastError: optionalText(item.lastError) as string } : {}),
    ...(typeof item.lastStatusCode === "number" && Number.isFinite(item.lastStatusCode)
      ? { lastStatusCode: Math.trunc(item.lastStatusCode) }
      : {}),
    ...(item.failureKind === "retryable" || item.failureKind === "permanent"
      ? { failureKind: item.failureKind }
      : {})
  };
}

function generatedCommandId() {
  return `mobile-time-entry:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validIso(value: unknown) {
  const text = optionalText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}
