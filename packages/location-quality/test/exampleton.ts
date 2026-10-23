import type { TimelineEntry } from "../src/answerKey";
import type { QualitySegment } from "../src/segments";

/**
 * A synthetic Exampleton day (Monday 2 March 2026, GMT, so local time is UTC). Nothing here comes from a
 * real export: places are labels, positions are metres from an invented origin.
 *
 *   06:00–08:00  Home                     08:00–08:20  drive, 7 km
 *   08:20–12:00  Exampleton Works         12:00–12:05  walk 300 m, then 12:05–12:25 bus 6 km
 *   12:25–13:00  a café (unknown place)   13:00–15:00  a gap Google fills with a 50 m "walk"
 *   15:00–18:00  Home
 */
export const DAY = "2026-03-02";
export const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;
export const WINDOW = { from: Date.parse(at("06:00")) / 1000, to: Date.parse(at("18:00")) / 1000 };

const visit = (start: string, end: string, home = false): TimelineEntry => ({
  startTime: `${DAY}T${start}:00.000+00:00`,
  endTime: `${DAY}T${end}:00.000+00:00`,
  visit: { hierarchyLevel: "0", topCandidate: { semanticType: home ? "Home" : "Unknown" } }
});
const activity = (start: string, end: string, type: string, metres: number): TimelineEntry => ({
  startTime: `${DAY}T${start}:00.000+00:00`,
  endTime: `${DAY}T${end}:00.000+00:00`,
  activity: { distanceMeters: String(metres), topCandidate: { type } }
});

export const exampletonAnswerKey: TimelineEntry[] = [
  visit("06:00", "08:00", true),
  activity("08:00", "08:20", "in passenger vehicle", 7000),
  visit("08:20", "12:00"),
  { startTime: `${DAY}T08:20:00.000+00:00`, endTime: `${DAY}T12:00:00.000+00:00`, timelinePath: [] },
  activity("12:00", "12:05", "walking", 300),
  activity("12:05", "12:25", "in bus", 6000),
  visit("12:25", "13:00"),
  activity("13:00", "15:00", "walking", 50),
  visit("15:00", "18:00", true),
  // Outside the window: ignored.
  visit("18:00", "23:00", true)
];

const segment = (kind: "stay" | "commute", start: string, end: string | null, extra: Partial<QualitySegment> = {}): QualitySegment => ({
  kind,
  startedAt: at(start),
  stoppedAt: end ? at(end) : null,
  status: end ? "closed" : "open",
  confidence: "high",
  continuity: "continuous",
  place: null,
  match: null,
  formation: null,
  from: null,
  to: null,
  reason: kind === "commute" ? "significant_route_distance" : null,
  mode: null,
  routeM: null,
  lineM: null,
  stops: 0,
  routeSamples: null,
  maxGapS: null,
  motionSupported: false,
  motionTimed: false,
  ...extra
});

/**
 * The engine's view: the morning drive starts a minute late, the bus reads as walking, nothing covers
 * the filler gap, and the last stay is still open.
 */
export const exampletonSegments: QualitySegment[] = [
  segment("stay", "06:00", "08:01", { place: "P4", match: "saved" }),
  segment("commute", "08:01", "08:20", { from: "P4", to: "P1", mode: "automotive", routeM: 7100, routeSamples: 38 }),
  segment("stay", "08:20", "12:00", { place: "P1", match: "saved" }),
  segment("commute", "12:00", "12:25", { from: "P1", to: "-", mode: "walking" }),
  segment("stay", "12:25", "13:00", { place: "-", match: "unknown" }),
  segment("stay", "15:00", null, { place: "P4", match: "saved" })
];

export const exampletonPlaces = ["P4|0|0|100|home|f|f|5", "P1|7000|0|150||t|t|5"].join("\n");
