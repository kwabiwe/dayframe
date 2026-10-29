import { TIMER_TRIP_CLASH_REVIEW_TYPE, checkAskingStartMs, checkStillAsks, checksOldestFirst, type ListCheck } from "@dayframe/shared";
import type { ReviewItemRow } from "@/lib/queries";
import { reviewOutings } from "@/lib/review-deck";

/**
 * Calendar (owner, 28 Oct 2026, concern 4): the "?" that still ask — open suggestions from today
 * and the 6 days before, an outing counted once on its stay — oldest first. The sidebar badge, Today's chip
 * and "N to check" all count and step through this one list, so their numbers always agree.
 */
export function askingChecks(reviewItems: readonly ReviewItemRow[], todayStartMs: number): ListCheck[] {
  const open = reviewItems.filter((item) => item.status === "open" && asksAsCheck(item));
  const members = new Set([...reviewOutings(open).values()].flatMap((outing) => outing.members.map((member) => member.id)));
  const fromMs = checkAskingStartMs(todayStartMs);
  return checksOldestFirst(open
    .filter((item) => !members.has(item.id))
    .map((item) => ({
      id: item.id,
      segmentId: typeof item.rawPayload?.clientSegmentId === "string" && item.rawPayload.clientSegmentId ? item.rawPayload.clientSegmentId : null,
      startedAt: item.suggestedStartedAt,
      stoppedAt: item.suggestedStoppedAt
    }))
    .filter((check) => check.startedAt && checkStillAsks(check, fromMs)));
}

/**
 * Whether a Review item is one of the List's ordinary "?" (and the Grid's and Today's). A timer that ran into a trip
 * (`location_timer_trip_clash`) asks on its block with its own End it / Keep it, which comes later (location v4
 * design §7), so until then no web surface shows or counts it as an ordinary question (step 15).
 */
export function asksAsCheck(item: Pick<ReviewItemRow, "type">) {
  return item.type !== TIMER_TRIP_CLASH_REVIEW_TYPE;
}

/** Calendar › List at one "?": on its own day when known (`YYYY-MM-DD`), otherwise the List's current day. */
export function reviewCheckHref(id: string, dateKey?: string | null) {
  return `/timeline?view=list&scope=day${dateKey ? `&date=${dateKey}` : ""}&check=${encodeURIComponent(id)}`;
}

/** Where the badge and Today's chip send you: Calendar › List at the oldest question that still asks. */
export function oldestCheckHref(checks: readonly ListCheck[]) {
  const oldest = checks[0];
  if (!oldest?.startedAt) return "/timeline?view=list&scope=day";
  const day = new Date(oldest.startedAt);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return reviewCheckHref(oldest.id, key);
}
