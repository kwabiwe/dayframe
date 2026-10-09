// Settings › Apple Health › Sync now: one plain line about what this tap did, read from the
// Sleep and Workouts lanes of the manual sync (a returned result is not a successful one).
import type { HealthImportStatus } from "./health";
import type { ManualSyncResult } from "./syncCoordinator";

export function healthSyncNote(result: ManualSyncResult | null, { connected }: { connected: boolean }): string {
  if (!result) return "Couldn't sync. Your Health data syncs on its own later.";
  const outcomes = [result.lanes.sleep, result.lanes.workouts]
    .filter((lane) => lane.stage !== "disabled")
    .map((lane) => lane.outcome);
  if (outcomes.includes("authentication_required")) return "Sign in again to sync Apple Health.";
  if (outcomes.includes("needs_attention")) return "Some Health data needs attention. See “Something not syncing?”.";
  if (outcomes.some((outcome) => outcome === "transport_failure" || outcome === "server_busy" || outcome === "backoff")) {
    return "Couldn't reach Dayframe. Your Health data is kept and syncs on its own.";
  }
  if (outcomes.some((outcome) => outcome !== "complete")) return "Sync didn't finish. Dayframe keeps trying on its own.";
  if (outcomes.length) return "Synced just now.";
  // Both lanes are off when Apple Health was never connected, whatever the switches say.
  return connected ? "Nothing to sync: every Health type is off." : "Connect Apple Health first, then sync.";
}

/**
 * Availability is re-read often; the connection (permission) and sync records are not. Replacing
 * only the records the new read covers keeps "Connected" from flipping back after a refresh.
 */
export function mergeHealthStatuses(current: readonly HealthImportStatus[], next: readonly HealthImportStatus[]) {
  const replaced = new Set(next.map((status) => `${status.provider}:${status.kind ?? ""}`));
  return [...next, ...current.filter((status) => !replaced.has(`${status.provider}:${status.kind ?? ""}`))];
}
