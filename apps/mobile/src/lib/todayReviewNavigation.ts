import type { TodayActivity } from "./todayReviewPresentation";

/**
 * Where a hatched block on Today's ribbon opens. Step 15 (list-first): there is no Review screen, so a suggestion's
 * block opens its "?" in Calendar › List (its day, its question or sheet open), and an older needs-review entry,
 * which is no "?" of its own, opens today's List.
 */
export type TodayReviewNavigationTarget =
  | { kind: "check"; reviewItemId: string }
  | { kind: "today_checks" }
  | { kind: "sync_diagnostics"; pathname: "/settings"; params: { from: "today"; section: "sync" } }
  | { kind: "canonical_entry"; entryId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only routes exact source identities; a nearby item is never a fallback. `from` names Today
 * for the pushed page's back button (BlocksNavHeader). */
export function todayReviewNavigationTarget(activity: TodayActivity): TodayReviewNavigationTarget | null {
  if (activity.state === "accepted_locally" || activity.resolution === "unknown" || activity.state === "needs_attention") {
    return { kind: "sync_diagnostics", pathname: "/settings", params: { from: "today", section: "sync" } };
  }
  if (activity.source.kind === "entry") {
    return UUID.test(activity.source.entryId)
      ? { kind: "canonical_entry", entryId: activity.source.entryId }
      : null;
  }
  if (activity.source.kind === "legacy_review_entry") {
    return UUID.test(activity.source.entryId) ? { kind: "today_checks" } : null;
  }
  if (!UUID.test(activity.source.reviewItemId)) return null;
  return { kind: "check", reviewItemId: activity.source.reviewItemId };
}
