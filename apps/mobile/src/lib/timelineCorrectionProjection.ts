import { mergeSameModeLegs, sameKnownPlace, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import type { AcknowledgedTimelineCorrection, PendingTimelineCorrection } from "./timelineCorrectionOutbox";

/**
 * What the List shows over a timeline asked for at `requestedAt`: the corrections the server acknowledged
 * after that (not in it yet), then those still on the phone. One acknowledged before it is in it already.
 */
export function correctionsToShow(
  acknowledged: readonly AcknowledgedTimelineCorrection[],
  pending: readonly PendingTimelineCorrection[],
  requestedAt: number | null
): PendingTimelineCorrection[] {
  return [...acknowledged.filter((item) => requestedAt == null || item.acknowledgedAt > requestedAt), ...pending];
}

/**
 * The List as it will be once the queued corrections are sent (location v4 step 12): each one the phone
 * still holds, in order, over the timeline the server last gave. A refused one is left out, so the row is
 * back as it was while the List says why. Pure; the server's next timeline replaces it.
 */
export function projectTimelineCorrections(
  timeline: LocationTimeline | null,
  pending: readonly PendingTimelineCorrection[]
): LocationTimeline | null {
  if (!timeline) return timeline;
  const waiting = pending.filter((item) => item.failureKind !== "permanent");
  if (waiting.length === 0) return timeline;
  let items: Array<TimelinePlace | TimelineTrip> = timeline.items;
  let openTrip = timeline.openTrip;
  for (const { request, preview } of waiting) {
    if (request.kind === "delete" && request.subject === "trip") {
      items = items.filter((item) => !(item.kind === "trip" && item.id === request.itemId));
      continue;
    }
    if (request.kind === "delete") {
      items = withoutPlace(items, request.itemId);
      continue;
    }
    if (request.kind === "merge") {
      const folded = foldedVisits(items, request.itemId);
      items = withoutTrip(items, request.itemId);
      // The journey in progress from the second visit leaves the one stay, as the server moves it (Codex r1 on #606).
      if (folded && openTrip?.fromId === folded.second) openTrip = { ...openTrip, fromId: folded.first };
      continue;
    }
    items = items.map((item): TimelinePlace | TimelineTrip => {
      if (item.id !== request.itemId) return item;
      if (request.kind === "place" && item.kind === "place") {
        const matchKind = request.placeId ? "saved" : request.learnedPlaceId ? "learned" : "unknown";
        return {
          ...item,
          placeId: request.placeId,
          learnedPlaceId: request.learnedPlaceId,
          // A preview's name, even an explicit null, is the picked place's; only no preview keeps the old one.
          name: matchKind === "unknown" ? null : preview ? preview.name : item.name,
          role: matchKind === "unknown" ? null : preview ? preview.role ?? null : item.role,
          matchKind,
          setByYou: true
        };
      }
      if (request.kind === "times" && item.kind === request.subject) {
        return { ...item, startedAt: request.startedAt, stoppedAt: request.stoppedAt, setByYou: true } as TimelinePlace | TimelineTrip;
      }
      if (request.kind === "leg_mode" && item.kind === "trip") {
        // As the server: the one leg with exactly these ends takes the mode, then same-mode neighbours join; a
        // leg whose ends have changed meanwhile is left as it is (the server will refuse it) (Codex r1 on #598).
        const from = Date.parse(request.legStartedAt);
        const to = Date.parse(request.legStoppedAt);
        const index = item.legs.findIndex((leg) => Date.parse(leg.startedAt) === from && Date.parse(leg.stoppedAt) === to);
        if (index < 0) return item;
        const { runnerUp: _runnerUp, ...rest } = item.legs[index];
        const legs = item.legs.map((leg, at) => at === index ? { ...rest, mode: request.mode, confidence: "sure" as const, setByYou: true as const } : leg);
        return { ...item, legs: mergeSameModeLegs(legs) };
      }
      return item;
    });
  }
  return { ...timeline, items, openTrip };
}

/**
 * "I wasn't here", as the server makes it (step 12 part 4): the trips into and out of the place become one,
 * and the place and the trip out leave; without a trip on both sides nothing changes (the server refuses it).
 */
function withoutPlace(items: Array<TimelinePlace | TimelineTrip>, placeId: string) {
  const before = items.find((item): item is TimelineTrip => item.kind === "trip" && item.toId === placeId);
  const after = items.find((item): item is TimelineTrip => item.kind === "trip" && item.fromId === placeId);
  if (!items.some((item) => item.kind === "place" && item.id === placeId) || !before || !after || before === after) return items;
  const joined: TimelineTrip = {
    ...before,
    stoppedAt: after.stoppedAt,
    toId: after.toId,
    mode: before.mode && before.mode === after.mode ? before.mode : null,
    legs: mergeSameModeLegs([...before.legs, ...after.legs]),
    stopIds: [...before.stopIds, ...after.stopIds],
    distanceMeters: before.distanceMeters == null || after.distanceMeters == null ? null : before.distanceMeters + after.distanceMeters,
    confidence: "low",
    // Its classification was the trip in's alone, as the server drops it (Codex r1 on #606).
    reason: null,
    setByYou: true
  };
  return items.flatMap((item) => item === before ? [joined] : item === after || (item.kind === "place" && item.id === placeId) ? [] : [item]);
}

/**
 * "I didn't leave", as the server makes it: the two visits either side, to one saved or learned place, become
 * one stay, the trip and the second visit leave, and a trip that left the second visit leaves the first.
 */
function withoutTrip(items: Array<TimelinePlace | TimelineTrip>, tripId: string) {
  const trip = items.find((item): item is TimelineTrip => item.kind === "trip" && item.id === tripId);
  const first = trip && items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.fromId);
  const second = trip && items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.toId);
  if (!trip || !first || !second || first === second || !sameKnownPlace(first, second)) return items;
  return items.flatMap((item): Array<TimelinePlace | TimelineTrip> => {
    // As finished as its last part, as the server makes it (Codex r1 on #606).
    if (item === first) return [{ ...first, stoppedAt: second.stoppedAt, status: second.status, setByYou: true }];
    if (item === trip || item === second) return [];
    if (item.kind === "trip" && item.fromId === second.id) return [{ ...item, fromId: first.id }];
    return [item];
  });
}

/** The two visits "I didn't leave" would make one, when it would. */
function foldedVisits(items: ReadonlyArray<TimelinePlace | TimelineTrip>, tripId: string) {
  const trip = items.find((item): item is TimelineTrip => item.kind === "trip" && item.id === tripId);
  const first = trip && items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.fromId);
  const second = trip && items.find((item): item is TimelinePlace => item.kind === "place" && item.id === trip.toId);
  return first && second && first !== second && sameKnownPlace(first, second) ? { first: first.id, second: second.id } : null;
}

