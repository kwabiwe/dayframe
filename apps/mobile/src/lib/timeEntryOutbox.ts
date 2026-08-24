import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileRequestTimeoutError,
  isMobileTransportFailure,
  mobileFetchWithTimeout
} from "./mobile-network";
import {
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot
} from "./secure-session";
import {
  mobileAccountKey,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import type { TimeEntryUpdatePatch } from "./api";
import {
  hasTimerBackgroundExecutionReservation,
  reserveTimerBackgroundExecution,
  withTimerBackgroundExecutionReservation
} from "./timerBackgroundExecution";

const TIME_ENTRY_OUTBOX_KEY = "dayframe.timeEntryOutbox.v1";
const TIME_ENTRY_OUTBOX_QUARANTINE_KEY = "dayframe.timeEntryOutbox.quarantine.v1";
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

export type TimeEntryOutboxQuarantineRecord = {
  quarantinedAt: string;
  reason: string;
  raw: string;
  owner: MobileAccountOwner | null;
};

let mutationTail: Promise<void> = Promise.resolve();
type ActiveTimeEntryCommandDrain = {
  control: TimeEntryCommandDrainControl;
  promise: Promise<TimeEntryOutboxSyncResult>;
};
type TimeEntryCommandDrainControl = {
  correlations: Map<string, string>;
  forceRequested: boolean;
};
const syncInFlightByOwner = new Map<string, ActiveTimeEntryCommandDrain>();
const listeners = new Set<() => void>();

export async function enqueueTimeEntryUpdate(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  patch: TimeEntryUpdatePatch;
  requestImmediateDelivery?: boolean;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "update",
    patch: input.patch,
    requestImmediateDelivery: input.requestImmediateDelivery
  });
}

export async function enqueueTimeEntryDelete(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  deliverAfter?: string;
  requestImmediateDelivery?: boolean;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "delete",
    deliverAfter: input.deliverAfter,
    requestImmediateDelivery: input.requestImmediateDelivery
  });
}

export async function releaseTimeEntryCommands(
  clientCommandIds: readonly string[],
  options: {
    owner?: MobileAccountOwner;
    requestImmediateDelivery?: boolean;
  } = {}
) {
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
    if (releasedCount > 0) {
      await writeAllCommands(next);
      if (
        options.requestImmediateDelivery &&
        options.owner &&
        next.some((command) =>
          ids.has(command.clientCommandId) &&
          mobileAccountOwnersEqual(command, options.owner) &&
          isTimeEntryCommandTransportReady(command, new Map(), {
            force: true,
            now: new Date()
          })
        )
      ) {
        await reserveTimeEntryBackgroundExecution(options.owner);
      }
    }
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
  signal?: AbortSignal;
}): Promise<TimeEntryOutboxSyncResult> {
  const ownerKey = mobileAccountKey(input.owner);
  const existing = syncInFlightByOwner.get(ownerKey);
  if (existing) {
    if (input.force) existing.control.forceRequested = true;
    for (const [localId, canonicalId] of input.correlations) {
      existing.control.correlations.set(localId, canonicalId);
    }
    return existing.promise.then((result) => {
      const hasNewImmediateMutation = hasTimerBackgroundExecutionReservation(
        timeEntryBackgroundExecutionKey(input.owner)
      );
      if (!hasNewImmediateMutation && (!input.force || result.reason !== "retry_wait")) {
        return result;
      }
      return synchroniseTimeEntryCommands({
        ...input,
        correlations: new Map(existing.control.correlations),
        force: hasNewImmediateMutation ? input.force : true
      }).then((next) => combineTimeEntryOutboxSyncResults(result, next));
    });
  }
  const control: TimeEntryCommandDrainControl = {
    correlations: new Map(input.correlations),
    forceRequested: input.force === true
  };
  const sync = runTimeEntryCommandDrain({
    control,
    now: input.now,
    owner: input.owner,
    signal: input.signal
  }).finally(() => {
    if (syncInFlightByOwner.get(ownerKey)?.promise === sync) {
      syncInFlightByOwner.delete(ownerKey);
    }
  });
  syncInFlightByOwner.set(ownerKey, { control, promise: sync });
  return sync;
}

export async function getTimeEntryOutboxDiagnostics(
  owner?: MobileAccountOwner,
  options: {
    correlations?: ReadonlyMap<string, string>;
    now?: Date;
  } = {}
) {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  const commands = resolvedOwner
    ? await readPendingTimeEntryCommands(resolvedOwner)
    : [];
  const quarantine = await readTimeEntryOutboxQuarantine();
  const ownedQuarantine = resolvedOwner
    ? quarantine.filter((record) => mobileAccountOwnersEqual(record.owner, resolvedOwner))
    : [];
  const deviceQuarantine = quarantine.filter((record) => record.owner === null);
  const retryable = commands.filter((command) => command.failureKind !== "permanent");
  const permanent = commands.filter((command) => command.failureKind === "permanent");
  return {
    pendingCount: retryable.length,
    transportReadyCount: retryable.filter((command) =>
      isTimeEntryCommandTransportReady(
        command,
        options.correlations ?? new Map(),
        { now: options.now }
      )
    ).length,
    needsAttentionCount: permanent.length,
    quarantinedCount: ownedQuarantine.length,
    deviceQuarantinedCount: deviceQuarantine.length,
    nextRetryAt: retryable
      .flatMap((command) => [command.nextAttemptAt, command.deliverAfter]
        .filter((value): value is string => Boolean(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
    lastError: [...commands]
      .reverse()
      .find((command) => command.lastError)?.lastError ?? null
  };
}

export async function listTimeEntrySyncIssues(owner?: MobileAccountOwner) {
  return (await readPendingTimeEntryCommands(owner))
    .filter((command) => command.failureKind === "permanent");
}

export async function retryTimeEntrySyncIssue(
  clientCommandId: string,
  owner?: MobileAccountOwner
) {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return false;
  return withMutation(async () => {
    const current = await readAllCommands();
    let retried = false;
    const next = current.map((command) => {
      if (
        command.clientCommandId !== clientCommandId ||
        command.failureKind !== "permanent" ||
        !mobileAccountOwnersEqual(command, resolvedOwner)
      ) {
        return command;
      }
      retried = true;
      const {
        failureKind: _failureKind,
        lastError: _lastError,
        lastStatusCode: _lastStatusCode,
        nextAttemptAt: _nextAttemptAt,
        ...retryable
      } = command;
      return { ...retryable, updatedAt: new Date().toISOString() };
    });
    if (retried) await writeAllCommands(next);
    return retried;
  });
}

export async function discardTimeEntrySyncIssue(
  clientCommandId: string,
  owner?: MobileAccountOwner
) {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return false;
  return withMutation(async () => {
    const current = await readAllCommands();
    const next = current.filter((command) => !(
      command.clientCommandId === clientCommandId &&
      command.failureKind === "permanent" &&
      mobileAccountOwnersEqual(command, resolvedOwner)
    ));
    if (next.length === current.length) return false;
    await writeAllCommands(next);
    return true;
  });
}

export async function clearTimeEntryOutboxQuarantine(owner?: MobileAccountOwner) {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return false;
  const current = await readTimeEntryOutboxQuarantine();
  const next = current.filter((record) => !mobileAccountOwnersEqual(record.owner, resolvedOwner));
  if (next.length === current.length) return false;
  await writeTimeEntryOutboxQuarantine(next);
  for (const listener of listeners) listener();
  return true;
}

export async function clearDeviceTimeEntryOutboxQuarantine() {
  const current = await readTimeEntryOutboxQuarantine();
  const next = current.filter((record) => record.owner !== null);
  if (next.length === current.length) return false;
  await writeTimeEntryOutboxQuarantine(next);
  for (const listener of listeners) listener();
  return true;
}

export function subscribeTimeEntryOutbox(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetTimeEntryOutboxForTests() {
  mutationTail = Promise.resolve();
  syncInFlightByOwner.clear();
  listeners.clear();
}

async function runTimeEntryCommandDrain(input: {
  control: TimeEntryCommandDrainControl;
  owner: MobileAccountOwner;
  now?: Date;
  signal?: AbortSignal;
  backgroundExecutionChecked?: boolean;
}): Promise<TimeEntryOutboxSyncResult> {
  if (!mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)) {
    return currentOutboxResult(input.owner, 0, true, "session_changed");
  }
  if (!input.signal && !input.backgroundExecutionChecked) {
    const reservationKey = timeEntryBackgroundExecutionKey(input.owner);
    const firstPendingCommand = (await readPendingTimeEntryCommands(input.owner))
      .find((command) => command.failureKind !== "permanent");
    const hasTransportReadyCommand = firstPendingCommand
      ? isTimeEntryCommandTransportReady(
          firstPendingCommand,
          input.control.correlations,
          {
            force: input.control.forceRequested,
            now: input.now ?? new Date()
          }
        )
      : false;
    if (
      hasTimerBackgroundExecutionReservation(reservationKey) ||
      hasTransportReadyCommand
    ) {
      return withTimerBackgroundExecutionReservation(
        reservationKey,
        "Dayframe timer Edit or Delete sync",
        (signal) => runTimeEntryCommandDrain({
          ...input,
          signal,
          backgroundExecutionChecked: true
        }),
        { beginIfMissing: hasTransportReadyCommand }
      );
    }
  }
  let deliveredCount = 0;
  const now = input.now ?? new Date();

  while (true) {
    if (input.signal?.aborted) {
      return currentOutboxResult(input.owner, deliveredCount, true, "retryable_failure");
    }
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
        ? input.control.correlations.get(original.optimisticEntryId)
        : undefined
    );
    if (!targetEntryId) {
      return outboxResult(all, input.owner, deliveredCount, true, "dependency_wait");
    }
    if (
      !input.control.forceRequested &&
      original.nextAttemptAt &&
      Date.parse(original.nextAttemptAt) > now.getTime()
    ) {
      return outboxResult(all, input.owner, deliveredCount, true, "retry_wait");
    }

    const attemptedAt = new Date().toISOString();
    const sessionRead = await readOwnedAuthenticatedSessionSnapshot(input.owner);
    if (sessionRead.status !== "authenticated") {
      return currentOutboxResult(
        input.owner,
        deliveredCount,
        true,
        sessionRead.status === "signed_out" ? "authentication_required" : "session_changed"
      );
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
            : {}),
          signal: input.signal
        },
        {
          timeoutMilliseconds: MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS,
          timeoutMessage: "This change is saved on your iPhone and will retry automatically."
        }
      );
      if (response.status === 401 || response.status === 403) {
        return currentOutboxResult(
          input.owner,
          deliveredCount,
          true,
          "authentication_required"
        );
      }
      if (
        !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) ||
        !mobileAccountOwnersEqual(await readActiveMobileAccount(), input.owner)
      ) {
        return currentOutboxResult(input.owner, deliveredCount, true, "session_changed");
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
      const retryable = input.signal?.aborted ||
        error instanceof MobileRequestTimeoutError ||
        isMobileTransportFailure(error);
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
  requestImmediateDelivery?: boolean;
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
    if (
      input.requestImmediateDelivery &&
      isTimeEntryCommandTransportReady(command, new Map(), {
        force: true,
        now: new Date()
      })
    ) {
      await reserveTimeEntryBackgroundExecution(input.owner);
    }
    return command;
  });
}

export function isTimeEntryCommandTransportReady(
  command: PendingTimeEntryCommand,
  correlations: ReadonlyMap<string, string>,
  options: { force?: boolean; now?: Date } = {}
) {
  if (command.failureKind === "permanent") return false;
  const now = options.now ?? new Date();
  if (command.deliverAfter && Date.parse(command.deliverAfter) > now.getTime()) {
    return false;
  }
  if (!command.targetEntryId && !(
    command.optimisticEntryId && correlations.has(command.optimisticEntryId)
  )) {
    return false;
  }
  return options.force === true || !command.nextAttemptAt ||
    Date.parse(command.nextAttemptAt) <= now.getTime();
}

function timeEntryBackgroundExecutionKey(owner: MobileAccountOwner) {
  return `time_entry_outbox:${mobileAccountKey(owner)}`;
}

function reserveTimeEntryBackgroundExecution(owner: MobileAccountOwner) {
  return reserveTimerBackgroundExecution(
    timeEntryBackgroundExecutionKey(owner),
    "Dayframe timer Edit or Delete sync"
  );
}

function combineTimeEntryOutboxSyncResults(
  first: TimeEntryOutboxSyncResult,
  second: TimeEntryOutboxSyncResult
): TimeEntryOutboxSyncResult {
  return {
    deliveredCount: first.deliveredCount + second.deliveredCount,
    waitingCount: second.waitingCount,
    needsAttentionCount: second.needsAttentionCount,
    stopped: second.stopped,
    ...(second.reason ? { reason: second.reason } : {})
  };
}

async function readAllCommands(): Promise<PendingTimeEntryCommand[]> {
  const raw = await AsyncStorage.getItem(TIME_ENTRY_OUTBOX_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await quarantineTimeEntryOutboxPayloads([{
      owner: null,
      raw,
      reason: "The outbox JSON could not be parsed."
    }], true);
    return [];
  }
  if (!Array.isArray(parsed)) {
    await quarantineTimeEntryOutboxPayloads([{
      owner: recoverQuarantineOwner(parsed),
      raw,
      reason: "The outbox container was not an array."
    }], true);
    return [];
  }
  const commands: PendingTimeEntryCommand[] = [];
  const invalid: unknown[] = [];
  for (const value of parsed) {
    const command = parseCommand(value);
    if (command) commands.push(command);
    else invalid.push(value);
  }
  if (invalid.length > 0) {
    const grouped = new Map<string, { owner: MobileAccountOwner | null; values: unknown[] }>();
    for (const value of invalid) {
      const owner = recoverQuarantineOwner(value);
      const key = owner ? mobileAccountKey(owner) : "device";
      const group = grouped.get(key) ?? { owner, values: [] };
      group.values.push(value);
      grouped.set(key, group);
    }
    await quarantineTimeEntryOutboxPayloads(
      [...grouped.values()].map((group) => ({
        owner: group.owner,
        raw: JSON.stringify(group.values),
        reason: "One or more outbox records could not be validated."
      })),
      false
    );
    await AsyncStorage.setItem(TIME_ENTRY_OUTBOX_KEY, JSON.stringify(commands));
  }
  return commands;
}

async function readTimeEntryOutboxQuarantine(): Promise<TimeEntryOutboxQuarantineRecord[]> {
  const raw = await AsyncStorage.getItem(TIME_ENTRY_OUTBOX_QUARANTINE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const quarantinedAt = optionalText(item.quarantinedAt);
      const reason = optionalText(item.reason);
      const payload = typeof item.raw === "string" ? item.raw : null;
      const owner = recoverQuarantineOwner(item.owner);
      return quarantinedAt && reason && payload !== null
        ? [{ quarantinedAt, reason, raw: payload, owner }]
        : [];
    });
  } catch {
    return [];
  }
}

async function quarantineTimeEntryOutboxPayloads(
  records: Array<{
    owner: MobileAccountOwner | null;
    raw: string;
    reason: string;
  }>,
  removeOriginal: boolean
) {
  const quarantine = await readTimeEntryOutboxQuarantine();
  const combined = [
    ...quarantine,
    ...records.map((record) => ({
      ...record,
      quarantinedAt: new Date().toISOString()
    }))
  ];
  const perScopeCounts = new Map<string, number>();
  const next = combined.reverse().filter((record) => {
    const scope = record.owner ? mobileAccountKey(record.owner) : "device";
    const count = perScopeCounts.get(scope) ?? 0;
    if (count >= 10) return false;
    perScopeCounts.set(scope, count + 1);
    return true;
  }).slice(0, 50).reverse();
  await writeTimeEntryOutboxQuarantine(next);
  if (removeOriginal) await AsyncStorage.removeItem(TIME_ENTRY_OUTBOX_KEY);
}

async function writeTimeEntryOutboxQuarantine(
  records: readonly TimeEntryOutboxQuarantineRecord[]
) {
  if (records.length === 0) {
    await AsyncStorage.removeItem(TIME_ENTRY_OUTBOX_QUARANTINE_KEY);
    return;
  }
  await AsyncStorage.setItem(
    TIME_ENTRY_OUTBOX_QUARANTINE_KEY,
    JSON.stringify(records.map((record) => ({
      quarantinedAt: record.quarantinedAt,
      reason: record.reason,
      raw: record.raw,
      owner: record.owner
    })))
  );
}

function recoverQuarantineOwner(value: unknown): MobileAccountOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const userId = optionalText(item.userId);
  const workspaceId = optionalText(item.workspaceId);
  return userId && workspaceId ? { userId, workspaceId } : null;
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
