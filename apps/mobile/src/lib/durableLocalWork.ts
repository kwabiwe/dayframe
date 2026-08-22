import {
  readQueue,
  readTimerEntryIdCorrelations,
  type MobileBootstrap
} from "./api";
import {
  projectDurableLocalWork,
  type DurableLocalWork
} from "./durableLocalProjection";
import type { MobileAccountOwner } from "./mobileAccount";
import { readPendingTimeEntryCommands } from "./timeEntryOutbox";
import {
  pendingTimerStopsForOwner,
  readPendingTimerStops
} from "./timerStopOutbox";

export async function readDurableLocalWork(
  owner: MobileAccountOwner
): Promise<DurableLocalWork> {
  const [activityEvents, timeEntryCommands, timerStops, correlations] = await Promise.all([
    readQueue(owner),
    readPendingTimeEntryCommands(owner),
    readPendingTimerStops().then((stops) => pendingTimerStopsForOwner(stops, owner)),
    readTimerEntryIdCorrelations(owner)
  ]);
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
