import {
  checkAskingStartMs, checkStillAsks, checksOldestFirst, isTimerTripClashItem, timerTripClashAsksOnBlock, timerTripClashQuestion,
  type ListCheck, type TimerTripClashEntry
} from "@dayframe/shared";
import type { CategoryRow, ReviewItemRow, TimeEntryRow } from "@/lib/queries";
import { reviewOutings } from "@/lib/review-deck";

/** The blocks a client has loaded, by id, as the clash rule reads them (`timerTripClashAsksOnBlock`). */
export type ClashBlocks = ReadonlyMap<string, TimerTripClashEntry | null>;

/** A loaded block as the clash rule reads it: its times, source, review status and activity's starter key. */
export function clashBlockOf(entry: TimeEntryRow, categories: readonly Pick<CategoryRow, "id" | "starterKey">[]): TimerTripClashEntry {
  return {
    id: entry.id, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt, source: entry.source, eventType: null,
    reviewStatus: entry.reviewStatus, categoryStarterKey: categories.find((category) => category.id === entry.categoryId)?.starterKey ?? null
  };
}

/** The loaded blocks by id; a later copy (the running block, a fresher read) wins. */
export function clashBlocksFrom(entries: readonly TimeEntryRow[], categories: readonly Pick<CategoryRow, "id" | "starterKey">[]): ClashBlocks {
  return new Map(entries.map((entry) => [entry.id, clashBlockOf(entry, categories)] as const));
}

/**
 * Whether an open item still asks (location v4 design §7): a "block ran into your trip" asks until its block, as
 * loaded here, no longer runs into the trip (a block not loaded keeps asking: the server decides); anything else asks.
 */
export function clashStillAsks(item: ReviewItemRow, blocks: ClashBlocks | undefined, nowMs?: number) {
  if (!isTimerTripClashItem(item)) return true;
  const question = timerTripClashQuestion(item);
  if (!question) return false;
  // A block still running ran into the whole trip: without a clock, it is judged as at the trip's end (a pure read).
  return timerTripClashAsksOnBlock(question, blocks?.get(question.timeEntryId), nowMs ?? Math.max(Date.parse(question.tripStoppedAt), 0));
}

/**
 * Calendar (owner, 28 Oct 2026, concern 4): the "?" that still ask — open suggestions from today
 * and the 6 days before, an outing counted once on its stay, a block that ran into a trip once on its block —
 * oldest first. The sidebar badge, Today's chip and "N to check" all count and step through this one list, so
 * their numbers always agree.
 */
export function askingChecks(reviewItems: readonly ReviewItemRow[], todayStartMs: number, blocks?: ClashBlocks, nowMs?: number): ListCheck[] {
  const open = reviewItems.filter((item) => item.status === "open" && clashStillAsks(item, blocks, nowMs));
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
 * Whether a Review item is drawn as a "?" of its own (a List row, a Grid span, Today's ribbon). A block that ran
 * into a trip (`location_timer_trip_clash`) is counted like any "?" but asks on its block (its List row and Grid
 * block, location v4 design §7), never on a row or span of its own.
 */
export function drawsAsOwnCheck(item: Pick<ReviewItemRow, "type" | "eventType">) {
  return !isTimerTripClashItem(item);
}

/** The block a "?" asks on, when it asks on one (a block that ran into a trip); null otherwise. */
export function checkBlockId(item: ReviewItemRow | undefined) {
  return item ? timerTripClashQuestion(item)?.timeEntryId ?? null : null;
}

/** Calendar › List at one "?": on its own day when known (`YYYY-MM-DD`), otherwise the List's current day. */
export function reviewCheckHref(id: string, dateKey?: string | null) {
  return `/timeline?view=list&scope=day${dateKey ? `&date=${dateKey}` : ""}&check=${encodeURIComponent(id)}`;
}

/**
 * Today's "?" (Today's chip and `check=first`): the ones still asking that reach into the viewer's own today, oldest
 * first — never an earlier day's alone (Codex r1 on #613).
 */
export function todaysChecks(checks: readonly ListCheck[], todayStartMs: number) {
  return checks.filter((check) => Date.parse(check.stoppedAt ?? check.startedAt ?? "") > todayStartMs);
}

/** Where the badge and Today's chip send you: Calendar › List at the oldest question that still asks. */
export function oldestCheckHref(checks: readonly ListCheck[]) {
  const oldest = checks[0];
  if (!oldest?.startedAt) return "/timeline?view=list&scope=day";
  const day = new Date(oldest.startedAt);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return reviewCheckHref(oldest.id, key);
}
