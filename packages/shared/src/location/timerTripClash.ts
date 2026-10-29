import { formatClockTime, type ClockFormat } from "../clockFormat";
import { AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS, classifyAutomaticActivity } from "./automaticPolicy";

/**
 * A timer left running into a trip (location v4 design §7): "Team sync ran 18m into your trip · End it at
 * 14:22 · Keep it". Your blocks win, so Dayframe never changes the block itself; it asks once, on the block.
 * The same rule decides on the server (which stores the question) and on the iPhone and web (which hide it
 * at once after a local edit).
 */

export const TIMER_TRIP_CLASH_REVIEW_TYPE = "location_timer_trip_clash";
export const TIMER_TRIP_CLASH_EVENT_TYPE = "timer_trip_clash";
export const timerTripClashClientEventId = (timeEntryId: string) => `timer-trip-clash:${timeEntryId}`;

/** It was already running when you left: started at least this long before the trip. */
export const TIMER_TRIP_CLASH_LEAD_MS = AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS;
/**
 * And at most this long before it (contract decision, 28 Oct 2026): a timer left on for days still asks, a
 * block a month long is not a timer left running. The 31 days the timeline reads stays back, so every pass can
 * find the blocks that may ask with a bounded read.
 */
export const TIMER_TRIP_CLASH_MAX_LEAD_MS = 31 * 86_400_000;
/** It ran on into the trip by more than this (the tolerance automatic logging uses). */
export const TIMER_TRIP_CLASH_OVERLAP_MS = AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS;

/** Blocks Dayframe made from location (auto-logged visits and Moves, Logs as, Review), never a timer's. */
const LOCATION_BLOCK_SOURCES: ReadonlySet<string> = new Set([
  "geofence", "geofence_specific", "geofence_broad", "ha_geofence", "location_learning", "location_auto_log"
]);

/** Move activities merge with the trip instead (step 16): Commute, Getting around, Errands. */
export const TIMER_TRIP_MOVE_STARTER_KEYS: ReadonlySet<string> = new Set(["commute", "travel", "errands"]);

export type TimerTripClashEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  source: string;
  eventType: string | null;
  reviewStatus?: string | null;
  /** The block's activity's starter key, when it has one. */
  categoryStarterKey?: string | null;
  /**
   * False when the block's end is not a timer's: a block added by hand, or an end you set yourself (you
   * chose where it ends, so it never asks). The server knows; a client may leave it out.
   */
  timerEnd?: boolean;
};

export type TimerTripClashTrip = { id: string; startedAt: string; stoppedAt: string };

export type TimerTripClash = {
  timeEntryId: string;
  tripId: string;
  tripStartedAt: string;
  tripStoppedAt: string;
  /** How far into the trip the block ran, so far for a running timer. */
  overlapSeconds: number;
};

/** Whether this block can ask at all, whatever trips there are. */
export function timerTripClashEligible(entry: TimerTripClashEntry) {
  return (entry.reviewStatus ?? "confirmed") === "confirmed" && entry.timerEnd !== false &&
    classifyAutomaticActivity(entry) === "manual_or_other" && !LOCATION_BLOCK_SOURCES.has(entry.source) &&
    !(entry.categoryStarterKey && TIMER_TRIP_MOVE_STARTER_KEYS.has(entry.categoryStarterKey));
}

function ranInto(entry: TimerTripClashEntry, trip: TimerTripClashTrip, nowMs: number) {
  const entryStart = Date.parse(entry.startedAt);
  const entryStop = entry.stoppedAt == null ? nowMs : Date.parse(entry.stoppedAt);
  const tripStart = Date.parse(trip.startedAt), tripStop = Date.parse(trip.stoppedAt);
  if (![entryStart, entryStop, tripStart, tripStop].every(Number.isFinite) || tripStop <= tripStart) return null;
  if (entryStart > tripStart - TIMER_TRIP_CLASH_LEAD_MS || entryStart < tripStart - TIMER_TRIP_CLASH_MAX_LEAD_MS) return null;
  const overlapMs = Math.min(entryStop, tripStop) - tripStart;
  return overlapMs > TIMER_TRIP_CLASH_OVERLAP_MS ? overlapMs : null;
}

/** The first trip (by start) this block ran into, or null when it asks nothing. */
export function timerTripClash(
  entry: TimerTripClashEntry, trips: readonly TimerTripClashTrip[], now: Date | number
): TimerTripClash | null {
  if (!timerTripClashEligible(entry)) return null;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const ordered = [...trips].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
  for (const trip of ordered) {
    const overlapMs = ranInto(entry, trip, nowMs);
    if (overlapMs != null) {
      return {
        timeEntryId: entry.id, tripId: trip.id, tripStartedAt: new Date(Date.parse(trip.startedAt)).toISOString(),
        tripStoppedAt: new Date(Date.parse(trip.stoppedAt)).toISOString(), overlapSeconds: Math.round(overlapMs / 1_000)
      };
    }
  }
  return null;
}

/**
 * Whether a stored question still asks about this block as it is now (after a local edit, a Stop or a
 * delete, before the server's answer): the same trip, checked against the block's current times.
 */
export function timerTripClashStillAsks(
  question: { tripId: string; tripStartedAt: string; tripStoppedAt: string },
  entry: TimerTripClashEntry | null | undefined,
  now: Date | number
) {
  if (!entry || !timerTripClashEligible(entry)) return false;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return ranInto(entry, { id: question.tripId, startedAt: question.tripStartedAt, stoppedAt: question.tripStoppedAt }, nowMs) != null;
}

/** "Team sync ran 18m into your trip" (whole minutes; an hour and over as "1h 5m"). */
export function timerTripClashTitle(blockName: string | null | undefined, overlapSeconds: number) {
  const minutes = Math.max(1, Math.round(overlapSeconds / 60));
  const span = minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
  return `${blockName?.trim() || "This block"} ran ${span} into your trip`;
}

/** What a Review item carries that says whether it is this question. */
type TimerTripClashItemLike = {
  type?: string | null;
  eventType?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

/** Whether a Review item is "a block ran into your trip" (by its Review type, or its event's type). */
export function isTimerTripClashItem(item: Pick<TimerTripClashItemLike, "type" | "eventType">) {
  return item.type === TIMER_TRIP_CLASH_REVIEW_TYPE || item.eventType === TIMER_TRIP_CLASH_EVENT_TYPE;
}

/**
 * The question a clash item asks, read from its event's payload (`timeEntryId`, `tripId`, `tripStartedAt`,
 * `tripStoppedAt`, `overlapSeconds`), or null when the item is not one or its payload is incomplete. It asks
 * on the block `timeEntryId` names, never on a row of its own (location v4 design §7).
 */
export function timerTripClashQuestion(item: TimerTripClashItemLike): TimerTripClash | null {
  if (!isTimerTripClashItem(item)) return null;
  const payload = item.rawPayload ?? {};
  const text = (key: string) => typeof payload[key] === "string" && payload[key] ? payload[key] as string : null;
  const timeEntryId = text("timeEntryId"), tripId = text("tripId");
  const tripStartedAt = text("tripStartedAt"), tripStoppedAt = text("tripStoppedAt");
  if (!timeEntryId || !tripId || !tripStartedAt || !tripStoppedAt) return null;
  if (!Number.isFinite(Date.parse(tripStartedAt)) || !Number.isFinite(Date.parse(tripStoppedAt))) return null;
  const overlap = typeof payload.overlapSeconds === "number" && Number.isFinite(payload.overlapSeconds) ? payload.overlapSeconds : 0;
  return { timeEntryId, tripId, tripStartedAt, tripStoppedAt, overlapSeconds: Math.max(0, overlap) };
}

/**
 * Whether a clash still asks on a client, from the block as that client has it now (a local edit, Stop or
 * delete hides it at once, before the server's next answer): `undefined` when the block is not loaded here
 * (the server's question stands), `null` when it is known gone.
 */
export function timerTripClashAsksOnBlock(
  question: Pick<TimerTripClash, "tripId" | "tripStartedAt" | "tripStoppedAt">,
  entry: TimerTripClashEntry | null | undefined,
  now: Date | number
) {
  if (entry === undefined) return true;
  return timerTripClashStillAsks(question, entry, now);
}

/** The block as End it leaves it: ended where the trip started. */
export function timerTripClashEndedBlock<T extends { startedAt: string; stoppedAt: string | null }>(entry: T, question: Pick<TimerTripClash, "tripStartedAt">): T {
  return { ...entry, stoppedAt: question.tripStartedAt };
}

/**
 * The question's words on its block (design §7, owner rule: one Yes only, compact pills): the server's title, or
 * "{block} ran 18m into your trip"; End it at the trip's start in local time; Keep it. Never "timer".
 */
export function timerTripClashWords(
  item: { title?: string | null },
  question: Pick<TimerTripClash, "tripStartedAt" | "overlapSeconds">,
  blockName: string | null | undefined,
  clock: ClockFormat
) {
  const endsAt = formatClockTime(question.tripStartedAt, clock);
  return {
    question: item.title?.trim() || timerTripClashTitle(blockName, question.overlapSeconds),
    endLabel: `End it at ${endsAt}`,
    keepLabel: "Keep it",
    endsAt
  };
}
