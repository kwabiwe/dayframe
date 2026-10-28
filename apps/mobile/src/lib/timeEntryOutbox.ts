import AsyncStorage from "@react-native-async-storage/async-storage";
import { TIME_ENTRY_CLIENT_COMMAND_ID_HEADER, TimeEntryClientCommandIdSchema } from "@dayframe/shared";
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
/**
 * The refusal fence (Codex r3 on #532): the optimistic block IDs whose queued Start the server refused,
 * per account. Any Edit or Delete written for one later (a group deletion's loop still writing, say)
 * is refused as it is written, so nothing can wait for a Start that Clear has already removed. Only
 * opaque local IDs are kept, for 30 days and at most 200 records.
 */
const TIME_ENTRY_REFUSED_STARTS_KEY = "dayframe.timeEntryOutbox.refusedStarts.v1";
const REFUSED_START_FENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const REFUSED_START_FENCE_MAX_RECORDS = 200;
export const REFUSED_START_COMMAND_MESSAGE = "The block this change was for was never saved.";
export const MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS = 8_000;
const PERMANENT_STATUS_CODES = new Set([400, 409, 413, 422]);
const RETRY_BACKOFF_SECONDS = [5, 15, 30, 120, 300, 900];

export type PendingTimeEntryCommand = MobileAccountOwner & {
  clientCommandId: string;
  operation: "update" | "delete" | "split";
  targetEntryId?: string;
  optimisticEntryId?: string;
  patch?: TimeEntryUpdatePatch;
  /** Split (owner 28 Oct 2026): where the running block ends; its second part runs from here. */
  splitAt?: string;
  /**
   * Split: the local id the second part is shown under until the server names it. The server's id is
   * recorded against it (as a queued Start's is), so a Stop or Edit of the second part waits for it.
   */
  splitEntryLocalId?: string;
  deliverAfter?: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt?: string;
  lastAttemptedAt?: string;
  lastError?: string;
  lastStatusCode?: number;
  failureKind?: "retryable" | "permanent";
  /** Its block's queued Start was refused, so it can never be delivered: Discard only. */
  refusedStart?: boolean;
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
/**
 * Deletes whose Undo is still open, or not open yet (stability audit timer-1): held in this process
 * until the Undo lifecycle releases or removes them, whatever `deliverAfter` says. A sheet deletion's
 * Undo opens only once the sheet has left, which can be long after the delete was written (the app
 * backgrounded mid-dismiss). The durable `deliverAfter` stays the fallback after a force-quit, when
 * no Undo can follow.
 *
 * Every hold belongs to a lease, the lifetime of the Undo owner (Codex r1 on #540): ending the lease
 * (sign-out, the dashboard going away) drops its holds, including those of writes still in flight, and
 * a write that starts after it ended is not held at all. No hold outlasts its durable deadline by more
 * than `HOLD_LAPSE_MARGIN_MS`: the drain then tells the lease (which retires that Undo) and delivers.
 */
type HoldLeaseState = {
  ended: boolean;
  ids: Set<string>;
  onLapse?: (clientCommandId: string) => void;
};
type CommandHold = { deadlineMs: number; lease: HoldLeaseState };
export type TimeEntryCommandHoldLease = {
  readonly ended: boolean;
  /** Drops every hold this lease owns, now and for writes still in flight; durable commands stay. */
  end(): void;
};
export const HOLD_LAPSE_MARGIN_MS = 30_000;
const heldCommands = new Map<string, CommandHold>();
/** Commands a request was sent for in this process, so an Undo can tell it is too late. */
const dispatchedCommandIds = new Set<string>();
const DISPATCHED_COMMAND_IDS_MAX = 500;

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
  /**
   * Held in this process until released or removed (an Undo window), not just until `deliverAfter`,
   * for as long as this lease lasts and at most `HOLD_LAPSE_MARGIN_MS` past `deliverAfter`.
   */
  holdLease?: TimeEntryCommandHoldLease;
  requestImmediateDelivery?: boolean;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "delete",
    deliverAfter: input.deliverAfter,
    holdLease: input.holdLease,
    requestImmediateDelivery: input.requestImmediateDelivery
  });
}

/**
 * Split for the running block (owner 28 Oct 2026, as Toggl): ends `target` at `splitAt` and starts its
 * second part there, running, with every detail. Held like a sheet Delete for its Undo window
 * (`deliverAfter` and `holdLease`); Undo removes it before it is sent.
 */
export async function enqueueTimeEntrySplit(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  splitAt: string;
  splitEntryLocalId: string;
  deliverAfter?: string;
  holdLease?: TimeEntryCommandHoldLease;
  requestImmediateDelivery?: boolean;
}) {
  return enqueueTimeEntryCommand({
    owner: input.owner,
    target: input.target,
    operation: "split",
    split: { splitAt: input.splitAt, splitEntryLocalId: input.splitEntryLocalId },
    deliverAfter: input.deliverAfter,
    holdLease: input.holdLease,
    requestImmediateDelivery: input.requestImmediateDelivery
  });
}

const leaseStates = new WeakMap<TimeEntryCommandHoldLease, HoldLeaseState>();

/** One Undo owner's lifetime. `onLapse` runs, before delivery, for a hold that ran out its bound. */
export function createTimeEntryCommandHoldLease(
  options: { onLapse?: (clientCommandId: string) => void } = {}
): TimeEntryCommandHoldLease {
  const state: HoldLeaseState = { ended: false, ids: new Set(), onLapse: options.onLapse };
  const lease: TimeEntryCommandHoldLease = {
    get ended() {
      return state.ended;
    },
    end() {
      if (state.ended) return;
      state.ended = true;
      for (const id of state.ids) {
        if (heldCommands.get(id)?.lease === state) heldCommands.delete(id);
      }
      state.ids.clear();
    }
  };
  leaseStates.set(lease, state);
  return lease;
}

/**
 * Moves the durable hold of still-held commands out to at least `deliverAfter` (an Undo window that has
 * just opened), so a force-quit during that window still waits for it to close. Never shortens a hold
 * and never touches a command that was released or delivered.
 */
export async function extendTimeEntryCommandHold(
  clientCommandIds: readonly string[],
  deliverAfter: string
) {
  const ids = new Set(clientCommandIds);
  const until = Date.parse(deliverAfter);
  if (ids.size === 0 || !Number.isFinite(until)) return 0;
  return withMutation(async () => {
    const all = await readAllCommands();
    let extendedCount = 0;
    const next = all.map((command) => {
      const held = heldCommands.get(command.clientCommandId);
      if (
        !ids.has(command.clientCommandId) ||
        !held ||
        !command.deliverAfter ||
        Date.parse(command.deliverAfter) >= until
      ) {
        return command;
      }
      held.deadlineMs = Math.max(held.deadlineMs, until);
      extendedCount += 1;
      return { ...command, deliverAfter, updatedAt: new Date().toISOString() };
    });
    if (extendedCount > 0) await writeAllCommands(next);
    return extendedCount;
  });
}

/** True when a request for any of these commands was sent in this process: Undo is too late. */
export function wereTimeEntryCommandsDispatched(clientCommandIds: readonly string[]) {
  return clientCommandIds.some((id) => dispatchedCommandIds.has(id));
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
    let rewritten = false;
    const next = all.map((command) => {
      if (!ids.has(command.clientCommandId)) return command;
      const wasHeld = dropHold(command.clientCommandId);
      if (!command.deliverAfter) {
        if (wasHeld) releasedCount += 1;
        return command;
      }
      releasedCount += 1;
      rewritten = true;
      const { deliverAfter: _deliverAfter, ...released } = command;
      return { ...released, updatedAt: new Date().toISOString() };
    });
    for (const id of ids) dropHold(id);
    if (releasedCount > 0) {
      if (rewritten) await writeAllCommands(next);
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

/**
 * A queued Start the server refused never gets a block: the Edits and Deletes made for it become sync
 * issues (permanent, `refusedStart`) that the person can see and discard in Sync help, never retry.
 * Holding them permanent also keeps them from holding the account's outbox. Idempotent: the sync
 * pass runs it for every refused Start until it succeeds.
 */
export async function refuseTimeEntryCommandsForOptimisticEntry(
  owner: MobileAccountOwner,
  optimisticEntryId: string,
  message: string = REFUSED_START_COMMAND_MESSAGE
) {
  const refusedSplits: PendingTimeEntryCommand[] = [];
  const refusedCount = await withMutation(async () => {
    // The fence first, under the same lock as every enqueue: a command written after this is refused
    // as it is written, and one written before is refused below.
    const fence = await readRefusedStartFence();
    if (!fence.some((record) => fencedFor(record, owner, optimisticEntryId))) {
      await writeRefusedStartFence([
        ...fence,
        { userId: owner.userId, workspaceId: owner.workspaceId, optimisticEntryId, message, refusedAt: new Date().toISOString() }
      ]);
    }
    const all = await readAllCommands();
    const now = new Date().toISOString();
    let refusedCount = 0;
    const next = all.map((command) => {
      if (
        !mobileAccountOwnersEqual(command, owner) ||
        command.optimisticEntryId !== optimisticEntryId ||
        command.targetEntryId ||
        command.failureKind === "permanent"
      ) {
        return command;
      }
      refusedCount += 1;
      if (command.operation === "split") refusedSplits.push(command);
      const { nextAttemptAt: _nextAttemptAt, deliverAfter: _deliverAfter, ...rest } = command;
      return { ...rest, failureKind: "permanent" as const, refusedStart: true, lastError: message, updatedAt: now };
    });
    if (refusedCount > 0) await writeAllCommands(next);
    return refusedCount;
  });
  // A split of a block that never existed never makes its second part either.
  for (const split of refusedSplits) await settleRefusedSplit(owner, split);
  return refusedCount;
}

/** The owner's fenced optimistic block IDs, so correlation pruning keeps what the fence names. */
export async function readRefusedStartFenceEntryIds(owner: MobileAccountOwner) {
  return (await readRefusedStartFence())
    .filter((record) => mobileAccountOwnersEqual(record, owner))
    .map((record) => record.optimisticEntryId);
}

export async function removeTimeEntryCommands(clientCommandIds: readonly string[]) {
  const ids = new Set(clientCommandIds);
  if (ids.size === 0) return 0;
  return withMutation(async () => {
    for (const id of ids) dropHold(id);
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

/**
 * Whether this one command is now a sync issue (permanently rejected, or refused at enqueue). An
 * edit's "not saved" feedback asks about its own command: other, older issues on the account stay in
 * Settings › Sync help and the avatar badge, not in every later edit's result.
 */
export async function isTimeEntryCommandRejected(
  owner: MobileAccountOwner,
  clientCommandId: string
) {
  return (await readPendingTimeEntryCommands(owner)).some((command) =>
    command.clientCommandId === clientCommandId && command.failureKind === "permanent");
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
    /** Stable identities of the rejected commands, so a new rejection is noticed even at an equal count. */
    needsAttentionIds: permanent.map((command) => `entry:${command.clientCommandId}`),
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
        command.refusedStart ||
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
  heldCommands.clear();
  dispatchedCommandIds.clear();
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
    if (isHeld(original, now)) {
      return outboxResult(all, input.owner, deliveredCount, true, "deferred");
    }
    lapseOverdueHold(original.clientCommandId, now.getTime());
    const targetEntryId = original.targetEntryId ?? (
      original.optimisticEntryId
        ? input.control.correlations.get(original.optimisticEntryId)
        : undefined
    );
    if (!targetEntryId) {
      // A refused Start's block never exists: its command is refused, not waited for (Codex r3 on #532).
      if (original.optimisticEntryId && await refuseFencedCommand(input.owner, original.clientCommandId)) continue;
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

    // Re-checked after the session reads: an Undo window may have opened meanwhile.
    if (heldCommands.has(original.clientCommandId)) {
      return currentOutboxResult(input.owner, deliveredCount, true, "deferred");
    }
    markDispatched(original.clientCommandId);
    const split = original.operation === "split";
    try {
      const response = await mobileFetchWithTimeout(
        split
          ? `${DAYFRAME_API_BASE}/api/time-entries`
          : `${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(targetEntryId)}`,
        {
          method: split ? "POST" : original.operation === "delete" ? "DELETE" : "PATCH",
          headers: {
            ...(original.operation !== "delete" ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${sessionRead.snapshot.token}`,
            // The same id on every attempt: the server answers a resend of an Edit it already applied
            // as delivered instead of applying it again over a newer change (item 17).
            ...(TimeEntryClientCommandIdSchema.safeParse(original.clientCommandId).success
              ? { [TIME_ENTRY_CLIENT_COMMAND_ID_HEADER]: original.clientCommandId }
              : {})
          },
          ...(original.operation === "update"
            ? { body: JSON.stringify(original.patch ?? {}) }
            : split
            // The server's split of a running block: one transaction under the timer lock, answered
            // again for the same command id. It splits the block as it is when this arrives.
            ? { body: JSON.stringify({ mode: "split", source: "mobile_app", entryId: targetEntryId, splitAt: original.splitAt }) }
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
      if (split && response.ok) {
        const answer = await splitAnswerFrom(response);
        const newEntryId = answer.newEntryId;
        if (!newEntryId && answer.replayed) {
          // Done before, and its second part has gone since (joined back elsewhere): nothing to follow it.
          await settleRefusedSplit(input.owner, original);
          if (await removeDeliveredCommand(original.clientCommandId)) deliveredCount += 1;
          continue;
        }
        if (!newEntryId) {
          const current = await retainCommandFailure(original.clientCommandId, attemptedAt, {
            kind: "retryable",
            message: "Dayframe didn't name the split block. It will retry automatically."
          });
          return outboxResult(current, input.owner, deliveredCount, true, "retryable_failure");
        }
        // Recorded before the command goes, so a Stop or Edit of the second part never loses its target.
        const { recordTimerEntryIdCorrelation } = await import("./api");
        await recordTimerEntryIdCorrelation(original.splitEntryLocalId as string, newEntryId, input.owner);
        input.control.correlations.set(original.splitEntryLocalId as string, newEntryId);
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
      if (split) await settleRefusedSplit(input.owner, original);
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

/** The second part's id from the server's answer to a split (null when none), and whether it was a repeat. */
async function splitAnswerFrom(response: Response) {
  const body = await response.json().catch(() => null) as { newEntryId?: unknown; replayed?: unknown } | null;
  return {
    newEntryId: typeof body?.newEntryId === "string" && body.newEntryId ? body.newEntryId : null,
    replayed: body?.replayed === true
  };
}

/**
 * A split the server refused for good never makes its second part: as for a refused Start, the Stops
 * written for that part go and its Edits and Deletes become sync issues (fenced), so nothing waits for it.
 */
async function settleRefusedSplit(owner: MobileAccountOwner, command: PendingTimeEntryCommand) {
  if (!command.splitEntryLocalId) return;
  try {
    const { removePendingTimerStopsForTarget } = await import("./timerStopOutbox");
    await removePendingTimerStopsForTarget(owner, { optimisticEntryId: command.splitEntryLocalId });
    await refuseTimeEntryCommandsForOptimisticEntry(owner, command.splitEntryLocalId, "The split this change was for was never saved.");
  } catch {
    // The next pass's dependency check refuses fenced commands; a storage failure here only delays it.
  }
}

async function enqueueTimeEntryCommand(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
  operation: "update" | "delete" | "split";
  patch?: TimeEntryUpdatePatch;
  split?: { splitAt: string; splitEntryLocalId: string };
  deliverAfter?: string;
  holdLease?: TimeEntryCommandHoldLease;
  requestImmediateDelivery?: boolean;
}) {
  const activeOwner = await readActiveMobileAccount();
  if (!mobileAccountOwnersEqual(activeOwner, input.owner)) {
    throw new Error("This change belongs to a different Dayframe account.");
  }
  return withMutation(async () => {
    const now = new Date().toISOString();
    const fenced = input.target.optimisticEntryId
      ? (await readRefusedStartFence()).find((record) =>
          fencedFor(record, input.owner, input.target.optimisticEntryId as string))
      : undefined;
    const command: PendingTimeEntryCommand = {
      clientCommandId: generatedCommandId(),
      operation: input.operation,
      userId: input.owner.userId,
      workspaceId: input.owner.workspaceId,
      ...input.target,
      ...(input.operation === "update" ? { patch: input.patch ?? {} } : {}),
      ...(input.operation === "split" && input.split ? input.split : {}),
      ...(validIso(input.deliverAfter) && !fenced ? { deliverAfter: input.deliverAfter } : {}),
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      // Its block's Start was refused: a sync issue from the start (Discard only), never waiting.
      ...(fenced ? { failureKind: "permanent" as const, refusedStart: true, lastError: fenced.message } : {})
    };
    // Held before it is written, so no drain can see it unheld; never for a lease that has ended.
    const lease = input.holdLease ? leaseStates.get(input.holdLease) : undefined;
    if (lease && !lease.ended && !fenced) {
      const deliverAfterMs = Date.parse(command.deliverAfter ?? "");
      lease.ids.add(command.clientCommandId);
      heldCommands.set(command.clientCommandId, {
        deadlineMs: Number.isFinite(deliverAfterMs) ? deliverAfterMs : Date.now(),
        lease
      });
    }
    const all = await readAllCommands();
    try {
      await writeAllCommands([...all, command]);
    } catch (error) {
      dropHold(command.clientCommandId);
      throw error;
    }
    if (
      !fenced &&
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
  if (isHeld(command, now)) return false;
  if (!command.targetEntryId && !(
    command.optimisticEntryId && correlations.has(command.optimisticEntryId)
  )) {
    return false;
  }
  return options.force === true || !command.nextAttemptAt ||
    Date.parse(command.nextAttemptAt) <= now.getTime();
}

function isHeld(command: PendingTimeEntryCommand, now: Date) {
  const held = heldCommands.get(command.clientCommandId);
  return Boolean(held && now.getTime() <= held.deadlineMs + HOLD_LAPSE_MARGIN_MS) ||
    Boolean(command.deliverAfter && Date.parse(command.deliverAfter) > now.getTime());
}

function dropHold(clientCommandId: string) {
  const held = heldCommands.get(clientCommandId);
  if (!held) return false;
  heldCommands.delete(clientCommandId);
  held.lease.ids.delete(clientCommandId);
  return true;
}

/** A hold past its bound is dropped, and its lease told (retiring that Undo), before any delivery. */
function lapseOverdueHold(clientCommandId: string, nowMs: number) {
  const held = heldCommands.get(clientCommandId);
  if (!held || nowMs <= held.deadlineMs + HOLD_LAPSE_MARGIN_MS) return;
  dropHold(clientCommandId);
  try {
    held.lease.onLapse?.(clientCommandId);
  } catch {
    // The owner's bookkeeping must never keep a durable command from its delivery.
  }
}

function markDispatched(clientCommandId: string) {
  dispatchedCommandIds.delete(clientCommandId);
  dispatchedCommandIds.add(clientCommandId);
  while (dispatchedCommandIds.size > DISPATCHED_COMMAND_IDS_MAX) {
    const oldest = dispatchedCommandIds.values().next().value;
    if (oldest === undefined) break;
    dispatchedCommandIds.delete(oldest);
  }
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

type RefusedStartFenceRecord = MobileAccountOwner & {
  optimisticEntryId: string;
  message: string;
  refusedAt: string;
};

function fencedFor(record: RefusedStartFenceRecord, owner: MobileAccountOwner, optimisticEntryId: string) {
  return record.optimisticEntryId === optimisticEntryId && mobileAccountOwnersEqual(record, owner);
}

/** Refuses one waiting command whose Start is fenced; false when it isn't (or storage failed). */
async function refuseFencedCommand(owner: MobileAccountOwner, clientCommandId: string) {
  try {
    return await withMutation(async () => {
      const fence = await readRefusedStartFence();
      const all = await readAllCommands();
      let refused = false;
      const now = new Date().toISOString();
      const next = all.map((command) => {
        if (
          command.clientCommandId !== clientCommandId ||
          command.failureKind === "permanent" ||
          command.targetEntryId ||
          !command.optimisticEntryId ||
          !mobileAccountOwnersEqual(command, owner)
        ) {
          return command;
        }
        const record = fence.find((candidate) => fencedFor(candidate, owner, command.optimisticEntryId as string));
        if (!record) return command;
        refused = true;
        const { nextAttemptAt: _nextAttemptAt, deliverAfter: _deliverAfter, ...rest } = command;
        return { ...rest, failureKind: "permanent" as const, refusedStart: true, lastError: record.message, updatedAt: now };
      });
      if (refused) await writeAllCommands(next);
      return refused;
    });
  } catch {
    return false;
  }
}

async function readRefusedStartFence(now = Date.now()): Promise<RefusedStartFenceRecord[]> {
  const raw = await AsyncStorage.getItem(TIME_ENTRY_REFUSED_STARTS_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value): RefusedStartFenceRecord[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const userId = optionalText(item.userId);
    const workspaceId = optionalText(item.workspaceId);
    const optimisticEntryId = optionalText(item.optimisticEntryId);
    const refusedAt = validIso(item.refusedAt);
    if (!userId || !workspaceId || !optimisticEntryId || !refusedAt) return [];
    if (now - Date.parse(refusedAt) > REFUSED_START_FENCE_MAX_AGE_MS) return [];
    return [{
      userId,
      workspaceId,
      optimisticEntryId,
      message: optionalText(item.message) ?? REFUSED_START_COMMAND_MESSAGE,
      refusedAt
    }];
  });
}

async function writeRefusedStartFence(records: readonly RefusedStartFenceRecord[]) {
  const now = Date.now();
  const kept = records
    .filter((record) => now - Date.parse(record.refusedAt) <= REFUSED_START_FENCE_MAX_AGE_MS)
    .slice(-REFUSED_START_FENCE_MAX_RECORDS);
  await AsyncStorage.setItem(TIME_ENTRY_REFUSED_STARTS_KEY, JSON.stringify(kept));
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
  const operation = item.operation === "update" || item.operation === "delete" || item.operation === "split"
    ? item.operation
    : null;
  const splitAt = validIso(item.splitAt);
  const splitEntryLocalId = optionalText(item.splitEntryLocalId);
  const userId = optionalText(item.userId);
  const workspaceId = optionalText(item.workspaceId);
  const targetEntryId = optionalText(item.targetEntryId);
  const optimisticEntryId = optionalText(item.optimisticEntryId);
  const createdAt = validIso(item.createdAt);
  const updatedAt = validIso(item.updatedAt);
  if (
    !clientCommandId || !operation || !userId || !workspaceId ||
    (!targetEntryId && !optimisticEntryId) || !createdAt || !updatedAt ||
    (operation === "split" && (!splitAt || !splitEntryLocalId))
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
    ...(operation === "split" ? { splitAt: splitAt as string, splitEntryLocalId: splitEntryLocalId as string } : {}),
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
      : {}),
    ...(item.refusedStart === true ? { refusedStart: true } : {})
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
