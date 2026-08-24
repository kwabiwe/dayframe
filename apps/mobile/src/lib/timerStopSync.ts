import {
  deliverPendingTimerStop,
  isNetworkTimerError
} from "./api";
import {
  pendingTimerStopsForOwner,
  readPendingTimerStops,
  resolvePendingTimerStopTargets,
  type PendingTimerStop,
  type TimerStopOwner
} from "./timerStopOutbox";
import { mobileAccountKey } from "./mobileAccount";

export type TimerStopSyncResult = {
  deliveredCount: number;
  needsAttentionCount: number;
  permanentRejectedCount: number;
  permanentRejectedClientEventIds: string[];
  remaining: PendingTimerStop[];
  transportFailure: boolean;
};

const accountDrains = new Map<string, Promise<TimerStopSyncResult>>();

export function synchronisePendingTimerStops(input: {
  correlations: ReadonlyMap<string, string>;
  owner: TimerStopOwner;
}) {
  const key = mobileAccountKey(input.owner);
  const existing = accountDrains.get(key);
  if (existing) return existing;
  const drain = (async () => {
    const resolved = await resolvePendingTimerStopTargets(
      input.correlations,
      input.owner
    );
    const owned = pendingTimerStopsForOwner(resolved, input.owner);
    let deliveredCount = 0;
    const permanentRejectedClientEventIds: string[] = [];
    let transportFailure = false;
    for (const pendingStop of owned) {
      if (!pendingStop.targetEntryId || pendingStop.failureKind === "permanent") continue;
      const result = await deliverPendingTimerStop(pendingStop, input.owner);
      if (result.status === "delivered") deliveredCount += 1;
      if (result.status === "permanent_failure") {
        permanentRejectedClientEventIds.push(result.pendingStop.clientEventId);
      }
      if (result.status === "retryable_failure" && isNetworkTimerError(result.error)) {
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
  })();
  accountDrains.set(key, drain);
  void drain.finally(() => {
    if (accountDrains.get(key) === drain) accountDrains.delete(key);
  }).catch(() => undefined);
  return drain;
}
