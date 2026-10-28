import { legModeLabel, tripsByBlockId, type ListCheck, type LocationTimeline, type TripLegMode } from "@dayframe/shared";
import type { NativeCalendarPresentation } from "./nativeCalendarPresentation";

/**
 * Calendar prototype, steps 16–17 on the iPhone Grid: React reads the day's places and trips and hands the native
 * Calendar a trip block's legs (the strip down its leading edge) and the Places lane's items (left of the blocks);
 * Swift only draws them. A lane item that still asks carries its "?" id, so a tap opens that question in the List.
 */

/** The leg glyphs the native glyph bundle ships (the registry's activity art). */
const LEG_GLYPHS: Record<TripLegMode, string> = {
  walking: "activity-footprints",
  running: "activity-footprints",
  cycling: "activity-bike",
  automotive: "activity-car",
  bus: "activity-bus",
  train: "activity-train-front",
  underground: "activity-train-front",
  tram: "activity-train-front"
};

export function withPlacesAndLegs<T extends NativeCalendarPresentation>(model: T, timeline: LocationTimeline | null,
  checks: readonly ListCheck[], formatTime: (ms: number) => string): T {
  if (!timeline) return model;
  const trips = tripsByBlockId(timeline);
  const asking = new Map(checks.flatMap((check) => check.segmentId ? [[check.segmentId, check.id] as const] : []));
  const names = new Map(timeline.items.flatMap((item) => item.kind === "place" ? [[item.id, item.name] as const] : []));
  const besidesHome = timeline.items.some((item) => item.kind === "trip" || (item.kind === "place" && item.role !== "home" && item.name !== "Home"));
  const nowMs = model.nowMs;
  const placesLane = besidesHome ? timeline.items.map((item) => {
    const startedAtMs = Date.parse(item.startedAt);
    const stoppedAtMs = item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs;
    const label = item.kind === "place"
      ? item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place")
      : `${names.get(item.fromId) ?? "Unknown place"} to ${names.get(item.toId) ?? "Unknown place"}`;
    const checkId = asking.get(item.id) ?? null;
    return {
      id: item.id,
      kind: item.kind,
      startedAtMs,
      stoppedAtMs,
      glyph: item.kind === "trip" ? "trip" : item.role === "home" ? "activity-house" : item.role === "work" ? "activity-briefcase" : "place",
      ...(checkId ? { checkId } : {}),
      accessibilityLabel: [item.kind === "trip" ? `Trip, ${label}` : label, `${formatTime(startedAtMs)} to ${formatTime(stoppedAtMs)}`,
        item.kind === "trip" && item.legs.length ? item.legs.map((leg) => legModeLabel(leg)).join(", ") : null,
        checkId ? "Needs a look" : null].filter(Boolean).join(". ")
    };
  }) : [];
  return {
    ...model,
    placesLane,
    entries: model.entries.map((entry) => {
      const trip = trips.get(entry.entryId);
      return trip ? { ...entry, legs: trip.legs.map((leg) => ({
        startedAtMs: Date.parse(leg.startedAt), stoppedAtMs: Date.parse(leg.stoppedAt), glyph: LEG_GLYPHS[leg.mode], unsure: leg.confidence === "unsure"
      })) } : entry;
    })
  };
}
