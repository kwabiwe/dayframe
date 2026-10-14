// Owner decision 14 Oct 2026 (option C): the Review deck splits into Today and Earlier.
// Everything here is a client predicate over the deck's existing sources (the backlog pages and
// the bootstrap's cached list); nothing asks the server for anything new.

import { REVIEW_BULK_SKIP_AGE_MS } from "./reviewBulkSkip";

export type ReviewDeckSegment = "today" | "earlier";

export const REVIEW_DECK_SEGMENTS: readonly ReviewDeckSegment[] = ["today", "earlier"];

/** The local day the deck calls Today: local midnight to the next local midnight (23 or 25 hours across a clock change). */
export type ReviewDeckDay = { startMs: number; endMs: number };

export function reviewDeckToday(nowMs: number): ReviewDeckDay {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export type ReviewDeckMoment = {
  startedAt: string | null;
  stoppedAt: string | null;
  /** When the moment was detected: places a moment without a complete window (the server's created_at). */
  detectedAt?: string | null;
};

function instant(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * Today is "overlaps today", the same boundary as the server's `todayCount` and the Today ribbon
 * (review-presentation-service `loadCounts`): a complete window that starts before tomorrow and
 * ends after today's midnight, or, without a complete window, a moment detected today. So
 * overnight sleep that ends this morning stays under Today; everything else is Earlier.
 */
export function reviewDeckSegmentFor(moment: ReviewDeckMoment, today: ReviewDeckDay): ReviewDeckSegment {
  const start = instant(moment.startedAt);
  const stop = instant(moment.stoppedAt);
  if (Number.isFinite(start) && Number.isFinite(stop)) {
    return start < today.endMs && stop > today.startMs ? "today" : "earlier";
  }
  const detected = instant(moment.detectedAt);
  return Number.isFinite(detected) && detected >= today.startMs && detected < today.endMs ? "today" : "earlier";
}

/** A Review item's moment: its suggested window, else when it was created. */
export function reviewItemMoment(item: {
  suggestedStartedAt: string | null;
  suggestedStoppedAt: string | null;
  createdAt?: string | null;
}): ReviewDeckMoment {
  return { startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt, detectedAt: item.createdAt ?? null };
}

/**
 * A legacy needs-review entry's moment. The mobile entry carries no created_at, so an entry still
 * without a stop is placed by its start (the server places it by created_at; both are when it began).
 */
export function legacyEntryMoment(entry: { startedAt: string; stoppedAt: string | null }): ReviewDeckMoment {
  return { startedAt: entry.startedAt, stoppedAt: entry.stoppedAt, detectedAt: entry.startedAt };
}

/** The backlog's sort key (`coalesce(suggested_started_at, created_at)`): when a moment began. */
export function reviewDeckMomentStartMs(moment: ReviewDeckMoment) {
  const start = instant(moment.startedAt);
  if (Number.isFinite(start)) return start;
  const detected = instant(moment.detectedAt);
  return Number.isFinite(detected) ? detected : Number.NaN;
}

/** An Earlier card that started more than 7 days ago (the bulk skip's line and Location's evidence retention). */
export function reviewDeckOlderThanWeek(moment: ReviewDeckMoment, nowMs: number) {
  const start = reviewDeckMomentStartMs(moment);
  return Number.isFinite(start) && start < nowMs - REVIEW_BULK_SKIP_AGE_MS;
}

/**
 * Item 5: one date order for the whole deck, newest first. Review items and legacy needs-review
 * entries are sorted together by when the moment began (the backlog's own key,
 * `coalesce(suggested_started_at, created_at)`), whatever order their sources gave them: the
 * bootstrap lists review items newest-created first, and a cached list can mix pages. Ties keep a
 * review item before a legacy entry, then the order they came in (the backlog's own `id desc`).
 * Sticky focus, Undo returns and deferrals are applied after this, on top of it.
 */
export function orderReviewDeckChronology<R, L>(
  reviews: readonly R[],
  legacy: readonly L[],
  startOf: { review: (item: R) => number; legacy: (entry: L) => number }
): Array<{ kind: "review"; value: R } | { kind: "legacy"; value: L }> {
  const sortKey = (value: number) => (Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY);
  const sources = [
    ...reviews.map((value, index) => ({ source: { kind: "review" as const, value }, at: sortKey(startOf.review(value)), rank: 0, index })),
    ...legacy.map((value, index) => ({ source: { kind: "legacy" as const, value }, at: sortKey(startOf.legacy(value)), rank: 1, index }))
  ];
  sources.sort((left, right) => {
    if (left.at !== right.at) return right.at > left.at ? 1 : -1;
    if (left.rank !== right.rank) return left.rank - right.rank;
    return left.index - right.index;
  });
  return sources.map((entry) => entry.source);
}

export type ReviewDeckSegmentCount = { value: number; exact: boolean };

/**
 * Each segment's count. Both are exact only once the whole backlog is loaded: a moment without a
 * complete window belongs to Today by when it was detected but sorts by its start, so it can sit on
 * any later page, and a long moment can reach into today from far back. Until then each count is
 * what is loaded, shown as "9+". `today`/`earlier` exclude moments decided on this iPhone.
 */
export function reviewDeckSegmentCounts(input: {
  today: number;
  earlier: number;
  backlogComplete: boolean;
}): Record<ReviewDeckSegment, ReviewDeckSegmentCount> {
  return {
    today: { value: input.today, exact: input.backlogComplete },
    earlier: { value: input.earlier, exact: input.backlogComplete }
  };
}

/** The count beside a segment's name: "3", "9+" (not exact yet), or nothing for an unknown zero. */
export function formatReviewDeckSegmentCount(count: ReviewDeckSegmentCount) {
  if (count.exact) return String(count.value);
  return count.value > 0 ? `${count.value}+` : "";
}

export function reviewDeckSegmentName(segment: ReviewDeckSegment) {
  return segment === "today" ? "Today" : "Earlier";
}

function moments(count: number) {
  return `${count} ${count === 1 ? "moment" : "moments"}`;
}

/** VoiceOver: "Earlier, 9 moments" (the tab's selected state is spoken by the system). */
export function reviewDeckSegmentAccessibilityLabel(segment: ReviewDeckSegment, count: ReviewDeckSegmentCount) {
  const name = reviewDeckSegmentName(segment);
  if (count.exact) return count.value ? `${name}, ${moments(count.value)}` : `${name}, no moments`;
  return count.value ? `${name}, at least ${moments(count.value)}` : name;
}

/** A segment with an exact zero is dimmed (it stays, so the control keeps its shape). */
export function reviewDeckSegmentDimmed(count: ReviewDeckSegmentCount) {
  return count.exact && count.value === 0;
}

export function otherReviewDeckSegment(segment: ReviewDeckSegment): ReviewDeckSegment {
  return segment === "today" ? "earlier" : "today";
}

/** `?segment=today|earlier` (the Today nudge); anything else is ignored. */
export function parseReviewDeckSegmentParam(value: string | readonly string[] | undefined): ReviewDeckSegment | null {
  return value === "today" || value === "earlier" ? value : null;
}

/**
 * What the deck shows. "All framed" only when both segments are empty and a verified read agrees;
 * "Today is framed · 9 earlier" (or the Earlier equivalent) when only the selected one is empty and
 * its count is an exact zero; otherwise the cards, or the waiting copy while more may load.
 */
export function reviewDeckSegmentView(input: {
  selected: ReviewDeckSegment;
  selectedCards: number;
  otherCards: number;
  selectedCount: ReviewDeckSegmentCount;
  /** Nothing is left in either segment and a complete read says so. */
  allFinished: boolean;
}): "finished" | "cards" | "segment_framed" | "waiting" {
  if (input.allFinished) return "finished";
  if (input.selectedCards > 0) return "cards";
  // Only a certain zero: an exact count of unloaded moments keeps the waiting copy and Show more.
  if (input.selectedCount.exact && input.selectedCount.value === 0 && input.otherCards > 0) return "segment_framed";
  return "waiting";
}

/** "Today is framed" / "Earlier is framed" and the other segment's waiting count. */
export function reviewDeckSegmentFramedCopy(selected: ReviewDeckSegment, other: ReviewDeckSegmentCount) {
  const count = formatReviewDeckSegmentCount(other) || String(other.value);
  const noun = other.value === 1 && other.exact ? "moment" : "moments";
  return selected === "today"
    ? {
        title: "Today is framed",
        detail: `${count} earlier ${noun} to review.`,
        action: "Review earlier",
        actionAccessibilityLabel: `Review earlier, ${other.exact ? moments(other.value) : `at least ${moments(other.value)}`}`
      }
    : {
        title: "Earlier is framed",
        detail: `${count} ${noun} from today to review.`,
        action: "Review today",
        actionAccessibilityLabel: `Review today, ${other.exact ? moments(other.value) : `at least ${moments(other.value)}`}`
      };
}

/**
 * Switching segment. Tapping the selected one does nothing; otherwise a held (Undo-pending)
 * decision is saved first, exactly as leaving the screen saves it, and only then does the deck
 * change. Returns whether it switched.
 */
export function switchReviewDeckSegment(
  current: ReviewDeckSegment,
  next: ReviewDeckSegment,
  { flushHeld, select }: { flushHeld: () => void; select: (segment: ReviewDeckSegment) => void }
) {
  if (next === current) return false;
  flushHeld();
  select(next);
  return true;
}
