/**
 * Whether a location pass may have changed what the Dashboard shows, so it should reload. A replay that
 * reports `semanticChangeCount` says exactly: zero means no Review item was added, reopened, retired or
 * changed and no Commute activity was created. A
 * replay re-emits every finalised segment, so `semanticSegmentCount` is almost never zero, and an
 * acknowledged upload alone changes nothing the Dashboard shows. Without the count (older servers, or no
 * replay this pass) any acknowledged upload or emitted segment still counts, as before.
 */
export function locationSyncChangedDashboard(
  result: {
    acknowledgedCount?: number;
    replayed?: boolean;
    semanticChangeCount?: number;
    semanticSegmentCount?: number;
  }
) {
  if (result.replayed && typeof result.semanticChangeCount === "number") return result.semanticChangeCount > 0;
  return (result.acknowledgedCount ?? 0) > 0 || (result.semanticSegmentCount ?? 0) > 0;
}
