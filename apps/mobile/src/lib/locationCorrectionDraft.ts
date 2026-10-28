import { sameKnownPlace, type TimelineCorrectionRequest, type TimelinePlace, type TimelineTrip, type TripLegMode } from "@dayframe/shared";
import type { TimelineCorrectionPreview } from "./timelineCorrectionOutbox";

/**
 * What a correction sheet (location v4 step 12, mock-up #ios-list) sends when Done is tapped: only what
 * the person changed, as timeline corrections, in the order the server applies them. Pure, so the sheet
 * stays a view. The server refuses a place's place or times, or a trip's times or existence, once the item
 * is in a block, so those are only offered for an item with no block; a leg's mode is offered on any trip.
 */

export type CorrectionPlaceOption = { id: string; name: string; role: string | null };
export type PlaceChoice = { kind: "keep" } | { kind: "saved"; id: string } | { kind: "unknown" };
export type CorrectionTimes = { startMs: number; stopMs: number | null };
export type QueuedCorrection = { request: TimelineCorrectionRequest; preview?: TimelineCorrectionPreview };

/** Whether this item's place or times can be corrected (no block made from it). */
export function correctable(item: TimelinePlace | TimelineTrip) {
  return item.blockIds.length === 0;
}

/** Why Done can't save these times, or null. */
export function timesProblem(original: { startedAt: string; stoppedAt: string | null }, times: CorrectionTimes) {
  if (times.stopMs == null) return null;
  if (times.stopMs <= times.startMs) return "The end must be after the start.";
  const from = Date.parse(original.startedAt);
  const to = original.stoppedAt ? Date.parse(original.stoppedAt) : times.stopMs;
  // The server keeps a correction with the item it was made on: new times must still overlap it.
  if (times.stopMs <= from || times.startMs >= to) return "Keep some of the time it was.";
  return null;
}

function changedTimes(original: { startedAt: string; stoppedAt: string | null }, times: CorrectionTimes) {
  if (times.stopMs == null || original.stoppedAt == null) return null;
  if (times.startMs === Date.parse(original.startedAt) && times.stopMs === Date.parse(original.stoppedAt)) return null;
  return { startedAt: new Date(times.startMs).toISOString(), stoppedAt: new Date(times.stopMs).toISOString() };
}

export function placeCorrections(
  place: TimelinePlace,
  draft: { choice: PlaceChoice; times: CorrectionTimes },
  options: readonly CorrectionPlaceOption[]
): QueuedCorrection[] {
  if (!correctable(place)) return [];
  const out: QueuedCorrection[] = [];
  if (draft.choice.kind === "saved" && draft.choice.id !== place.placeId) {
    const chosen = draft.choice.id;
    const option = options.find((item) => item.id === chosen);
    out.push({
      request: { kind: "place", subject: "place", itemId: place.id, placeId: chosen, learnedPlaceId: null },
      preview: { name: option?.name ?? null, role: option?.role ?? null }
    });
  } else if (draft.choice.kind === "unknown" && (place.placeId || place.learnedPlaceId)) {
    out.push({ request: { kind: "place", subject: "place", itemId: place.id, placeId: null, learnedPlaceId: null }, preview: { name: null } });
  }
  const times = timesProblem(place, draft.times) ? null : changedTimes(place, draft.times);
  if (times) out.push({ request: { kind: "times", subject: "place", itemId: place.id, ...times } });
  return out;
}

/** A trip's new times (only a trip with no block). */
export function tripCorrections(trip: TimelineTrip, draft: { times: CorrectionTimes }): QueuedCorrection[] {
  if (!correctable(trip) || timesProblem(trip, draft.times)) return [];
  const times = changedTimes(trip, draft.times);
  return times ? [{ request: { kind: "times", subject: "trip", itemId: trip.id, ...times } }] : [];
}

/**
 * One leg's mode, sent on the leg's own Done (any trip, a block's too). One at a time: a change can join the
 * leg with a neighbour of the same mode, so the next is made against the legs as they are then.
 */
export function legCorrection(trip: TimelineTrip, index: number, mode: TripLegMode): QueuedCorrection | null {
  const leg = trip.legs[index];
  if (!leg || leg.mode === mode) return null;
  return { request: { kind: "leg_mode", subject: "leg", itemId: trip.id, legStartedAt: leg.startedAt, legStoppedAt: leg.stoppedAt, mode } };
}

/**
 * Whether "I wasn't here" can join a place's trips (step 12 part 4): a finished place with a trip in and a trip
 * out, none of them in a block (the server refuses a join that touches a block).
 */
export function canSayNotHere(place: TimelinePlace, items: ReadonlyArray<TimelinePlace | TimelineTrip>) {
  const before = items.find((item): item is TimelineTrip => item.kind === "trip" && item.toId === place.id);
  const after = items.find((item): item is TimelineTrip => item.kind === "trip" && item.fromId === place.id);
  return Boolean(place.stoppedAt && correctable(place) && before && after && before !== after && correctable(before) && correctable(after));
}

/** "I wasn't here": the place leaves the day, and its trips either side become one. */
export function notHere(place: TimelinePlace): QueuedCorrection {
  return { request: { kind: "delete", subject: "place", itemId: place.id } };
}

/**
 * Whether "I didn't leave" can make a trip's two visits one stay: both to one saved or learned place, and none
 * of the three in a block.
 */
export function canSayDidntLeave(trip: TimelineTrip, items: ReadonlyArray<TimelinePlace | TimelineTrip>) {
  const first = items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.fromId);
  const second = items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.toId);
  return Boolean(first && second && first !== second && sameKnownPlace(first, second) &&
    correctable(trip) && correctable(first) && correctable(second));
}

/** "I didn't leave": the trip leaves the day, and the visits either side become one stay. */
export function didntLeave(trip: TimelineTrip): QueuedCorrection {
  return { request: { kind: "merge", subject: "trip", itemId: trip.id } };
}

/** "This wasn't a trip": takes it off the List (only a trip with no block). */
export function notATrip(trip: TimelineTrip): QueuedCorrection | null {
  return correctable(trip) ? { request: { kind: "delete", subject: "trip", itemId: trip.id } } : null;
}
