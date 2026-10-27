import { mergeSameModeLegs, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
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
  for (const { request, preview } of waiting) {
    if (request.kind === "delete") {
      items = items.filter((item) => !(item.kind === "trip" && item.id === request.itemId));
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
  return { ...timeline, items };
}
