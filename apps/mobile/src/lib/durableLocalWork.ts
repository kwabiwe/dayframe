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
