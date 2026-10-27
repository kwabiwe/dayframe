import { mergeSameModeLegs, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import type { PendingTimelineCorrection } from "./timelineCorrectionOutbox";

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
          name: matchKind === "unknown" ? null : preview?.name ?? item.name,
          role: matchKind === "unknown" ? null : preview?.role ?? null,
          matchKind,
          setByYou: true
        };
      }
      if (request.kind === "times" && item.kind === request.subject) {
        return { ...item, startedAt: request.startedAt, stoppedAt: request.stoppedAt, setByYou: true } as TimelinePlace | TimelineTrip;
      }
      if (request.kind === "leg_mode" && item.kind === "trip") {
        const from = Date.parse(request.legStartedAt);
        const to = Date.parse(request.legStoppedAt);
        // The legs it covers (one, or the parts an earlier same-mode merge joined) take the mode.
        const legs = item.legs.map((leg) => {
          if (Date.parse(leg.startedAt) < from || Date.parse(leg.stoppedAt) > to) return leg;
          const { runnerUp: _runnerUp, ...rest } = leg;
          return { ...rest, mode: request.mode, confidence: "sure" as const, setByYou: true as const };
        });
        return { ...item, legs: mergeSameModeLegs(legs) };
      }
      return item;
    });
  }
  return { ...timeline, items };
}
