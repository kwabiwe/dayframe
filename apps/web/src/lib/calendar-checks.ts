import { checkAskingStartMs, checkStillAsks, checksOldestFirst, type ListCheck } from "@dayframe/shared";
import type { ReviewItemRow } from "@/lib/queries";
import { reviewOutings } from "@/lib/review-deck";

/**
 * Calendar (owner, 28 Oct 2026, concern 4): the "?" that still ask — open suggestions from today
 * and the 6 days before, an outing counted once on its stay — oldest first. The sidebar badge, Today's chip
 * and "N to check" all count and step through this one list, so their numbers always agree.
 */
export function askingChecks(reviewItems: readonly ReviewItemRow[], todayStartMs: number): ListCheck[] {
  const open = reviewItems.filter((item) => item.status === "open");
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

/** Where the badge and Today's chip send you: Calendar › List at the oldest question that still asks. */
export function oldestCheckHref(checks: readonly ListCheck[]) {
  const oldest = checks[0];
  if (!oldest?.startedAt) return "/timeline?view=list&scope=day";
  const day = new Date(oldest.startedAt);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return `/timeline?view=list&scope=day&date=${key}&check=${encodeURIComponent(oldest.id)}`;
}
