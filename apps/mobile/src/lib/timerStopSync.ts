import {
  deliverPendingTimerStop,
  isNetworkTimerError
} from "./api";
import {
  getOrCreatePendingStop,
  pendingTimerStopsForOwner,
  readPendingTimerStops,
  resolvePendingTimerStopTargets,
  type PendingTimerStop,
  type TimerStopTarget,
  type TimerStopOwner
} from "./timerStopOutbox";
import { mobileAccountKey } from "./mobileAccount";
import {
  hasTimerBackgroundExecutionReservation,
  reserveTimerBackgroundExecution,
  withTimerBackgroundExecutionReservation
} from "./timerBackgroundExecution";

export type TimerStopSyncResult = {
  deliveredCount: number;
  needsAttentionCount: number;
  permanentRejectedCount: number;
  permanentRejectedClientEventIds: string[];
  remaining: PendingTimerStop[];
  transportFailure: boolean;
};

const accountDrains = new Map<string, Promise<TimerStopSyncResult>>();

export async function persistPendingTimerStop(input: {
  owner: TimerStopOwner;
  target: TimerStopTarget;
  occurredAt?: string;
  requestImmediateDelivery?: boolean;
}) {
  const pendingStop = await getOrCreatePendingStop(input);
  const backgroundReservation = input.requestImmediateDelivery &&
    pendingStop.failureKind !== "permanent"
    ? reservePendingTimerStopBackgroundExecution(input.owner)
    : null;
  return { backgroundReservation, pendingStop };
}

export function reservePendingTimerStopBackgroundExecution(owner: TimerStopOwner) {
  return reserveTimerBackgroundExecution(
    timerStopBackgroundExecutionKey(owner),
    "Dayframe timer Stop sync"
  );
}

export function synchronisePendingTimerStops(input: {
  correlations: ReadonlyMap<string, string>;
  owner: TimerStopOwner;
  signal?: AbortSignal;
}): Promise<TimerStopSyncResult> {
  const key = mobileAccountKey(input.owner);
  const existing = accountDrains.get(key);
  if (existing) {
    return existing.then(async (first): Promise<TimerStopSyncResult> => {
      if (!hasTimerBackgroundExecutionReservation(timerStopBackgroundExecutionKey(input.owner))) {
        return first;
      }
      const second: TimerStopSyncResult = await synchronisePendingTimerStops(input);
      return {
        deliveredCount: first.deliveredCount + second.deliveredCount,
        needsAttentionCount: second.needsAttentionCount,
        permanentRejectedCount:
          first.permanentRejectedCount + second.permanentRejectedCount,
        permanentRejectedClientEventIds: [
          ...first.permanentRejectedClientEventIds,
          ...second.permanentRejectedClientEventIds
        ],
        remaining: second.remaining,
        transportFailure: first.transportFailure || second.transportFailure
      };
    });
  }
  const drain = (async () => {
    const resolved = await resolvePendingTimerStopTargets(
      input.correlations,
      input.owner
    );
    const owned = pendingTimerStopsForOwner(resolved, input.owner);
    const deliverable = owned.filter((pendingStop) =>
      pendingStop.targetEntryId && pendingStop.failureKind !== "permanent"
    );
    const deliver = async (signal?: AbortSignal) => {
      let deliveredCount = 0;
      const permanentRejectedClientEventIds: string[] = [];
      let transportFailure = false;
      for (const pendingStop of deliverable) {
        if (signal?.aborted) {
          transportFailure = true;
          break;
        }
        const result = await deliverPendingTimerStop(pendingStop, input.owner, signal);
        if (result.status === "delivered") deliveredCount += 1;
        if (result.status === "permanent_failure") {
          permanentRejectedClientEventIds.push(result.pendingStop.clientEventId);
        }
        if (result.status === "retryable_failure" && isNetworkTimerError(result.error)) {
          transportFailure = true;
          break;
        }
        if (signal?.aborted) {
          transportFailure = true;
          break;
        }
      }
      const remaining = pendingTimerStopsForOwner(
        await readPendingTimerStops(),
        input.owner
      );
      return {
        deliveredCount,
        needsAttentionCount: remaining.filter((stop) => stop.failureKind === "permanent").length,
        permanentRejectedCount: permanentRejectedClientEventIds.length,
        permanentRejectedClientEventIds,
        remaining,
        transportFailure
      };
    };
    return withTimerBackgroundExecutionReservation(
      timerStopBackgroundExecutionKey(input.owner),
      "Dayframe timer Stop sync",
      (reservedSignal) => deliver(input.signal ?? reservedSignal),
      { beginIfMissing: !input.signal && deliverable.length > 0 }
    );
  })();
  accountDrains.set(key, drain);
  void drain.finally(() => {
    if (accountDrains.get(key) === drain) accountDrains.delete(key);
  }).catch(() => undefined);
  return drain;
}

function timerStopBackgroundExecutionKey(owner: TimerStopOwner) {
  return `timer_stop_outbox:${mobileAccountKey(owner)}`;
}
