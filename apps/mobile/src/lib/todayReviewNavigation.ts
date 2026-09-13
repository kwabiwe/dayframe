import type { TodayActivity } from "./todayReviewPresentation";

export type TodayReviewNavigationTarget =
  | { kind: "location_evidence"; pathname: "/review/[id]"; params: { id: string } }
  | { kind: "generic_review"; pathname: "/review"; params: { focusReviewId: string } }
  | { kind: "legacy_entry"; pathname: "/review"; params: { focusEntryId: string } }
  | { kind: "sync_diagnostics"; pathname: "/settings"; params: { section: "sync" } }
  | { kind: "canonical_entry"; entryId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only routes exact source identities; a nearby item is never a fallback. */
export function todayReviewNavigationTarget(activity: TodayActivity): TodayReviewNavigationTarget | null {
  if (activity.state === "accepted_locally" || activity.resolution === "unknown" || activity.state === "needs_attention") {
    return { kind: "sync_diagnostics", pathname: "/settings", params: { section: "sync" } };
  }
  if (activity.source.kind === "entry") {
    return UUID.test(activity.source.entryId)
      ? { kind: "canonical_entry", entryId: activity.source.entryId }
      : null;
  }
  if (activity.source.kind === "legacy_review_entry") {
    return UUID.test(activity.source.entryId)
      ? { kind: "legacy_entry", pathname: "/review", params: { focusEntryId: activity.source.entryId } }
      : null;
  }
  if (!UUID.test(activity.source.reviewItemId)) return null;
  return activity.reviewSourceKind === "location_v2"
    ? { kind: "location_evidence", pathname: "/review/[id]", params: { id: activity.source.reviewItemId } }
    : { kind: "generic_review", pathname: "/review", params: { focusReviewId: activity.source.reviewItemId } };
}
