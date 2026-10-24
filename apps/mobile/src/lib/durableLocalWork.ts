import {
  readQueue,
  readTimerEntryIdCorrelations,
  type MobileBootstrap
} from "./api";
import {
  projectDurableLocalWork,
  type DurableLocalWork
} from "./durableLocalProjection";
import { readPendingNativeEntryStops } from "./shortcuts";
import type { MobileAccountOwner } from "./mobileAccount";
import { readPendingTimeEntryCommands } from "./timeEntryOutbox";
import {
  pendingTimerStopsForOwner,
  readPendingTimerStops
} from "./timerStopOutbox";

export async function readDurableLocalWork(
  owner: MobileAccountOwner
): Promise<DurableLocalWork> {
  const [queued, nativeStops, timeEntryCommands, timerStops, correlations] = await Promise.all([
    readQueue(owner),
    // Lock Screen Stops not yet moved into the app's queue (Codex r1 on #578).
    readPendingNativeEntryStops(owner).catch(() => []),
    readPendingTimeEntryCommands(owner),
    readPendingTimerStops().then((stops) => pendingTimerStopsForOwner(stops, owner)),
    readTimerEntryIdCorrelations(owner)
  ]);
  const queuedIds = new Set(queued.map((event) => event.localId));
  const activityEvents = [...queued, ...nativeStops.filter((event) => !queuedIds.has(event.localId))];
  return { owner, activityEvents, timeEntryCommands, timerStops, correlations };
}

export async function projectBootstrapWithDurableLocalWork(
  serverBootstrap: MobileBootstrap
) {
  const owner = {
    userId: serverBootstrap.user.id,
    workspaceId: serverBootstrap.workspace.id
  };
  return projectDurableLocalWork(
    serverBootstrap,
    await readDurableLocalWork(owner)
  );
}

/**
 * This account's queued events that may be Lock Screen Stops, from the app's queue and the native one,
 * without the stores the Dashboard's Stop check does not use (Codex r3 on #578).
 */
export async function readQueuedAndNativeStops(owner: MobileAccountOwner) {
  const [queued, nativeStops] = await Promise.all([
    readQueue(owner),
    readPendingNativeEntryStops(owner).catch(() => [])
  ]);
  const queuedIds = new Set(queued.map((event) => event.localId));
  return [...queued, ...nativeStops.filter((event) => !queuedIds.has(event.localId))]
    .filter((event) => event.type === "timer_stop");
}

