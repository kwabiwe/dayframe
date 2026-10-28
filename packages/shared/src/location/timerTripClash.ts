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
/** It ran on into the trip by more than this (the tolerance automatic logging uses). */
export const TIMER_TRIP_CLASH_OVERLAP_MS = AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS;

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
  return (entry.reviewStatus ?? "confirmed") === "confirmed" &&
    classifyAutomaticActivity(entry) === "manual_or_other" &&
    !(entry.categoryStarterKey && TIMER_TRIP_MOVE_STARTER_KEYS.has(entry.categoryStarterKey));
}

function ranInto(entry: TimerTripClashEntry, trip: TimerTripClashTrip, nowMs: number) {
  const entryStart = Date.parse(entry.startedAt);
  const entryStop = entry.stoppedAt == null ? nowMs : Date.parse(entry.stoppedAt);
  const tripStart = Date.parse(trip.startedAt), tripStop = Date.parse(trip.stoppedAt);
  if (![entryStart, entryStop, tripStart, tripStop].every(Number.isFinite) || tripStop <= tripStart) return null;
  if (entryStart > tripStart - TIMER_TRIP_CLASH_LEAD_MS) return null;
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
