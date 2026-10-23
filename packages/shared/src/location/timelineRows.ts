import type { LocationTimeline, TimelinePlace, TimelineTrip } from "./timeline";
import type { TripLeg, TripLegMode } from "./types";

/**
 * Calendar › List location rows, read-only (location v4 steps 9–10, mock-ups #ios-list and #web-list,
 * placement A), shared by the iPhone and the web: the
 * day's blocks stay the main view; a place you were at but have not logged is one row in time order;
 * with "Show Home and every place" on, Home and logged places show as faint rows; a journey in progress
 * is one row; a trip's block shows its legs. Questions ("?") and corrections come in later steps.
 */

export const LEG_MODE_LABEL: Record<TripLegMode, string> = {
  walking: "Walk",
  running: "Run",
  cycling: "Cycle",
  automotive: "Drive",
  bus: "Bus",
  train: "Train",
  underground: "Underground",
  tram: "Tram"
};

/** A place shows as not logged from this long outside your blocks. */
export const UNLOGGED_PLACE_MINIMUM_SECONDS = 600;

export type LocationListRow =
  | { kind: "place"; key: string; atMs: number; place: TimelinePlace; fromMs: number; spanEndMs: number; unloggedSeconds: number; faint: boolean }
  | { kind: "open_trip"; key: string; atMs: number; startedAt: string; fromName: string | null; legs: TripLeg[]; mode: string | null };

type Interval = { startedAt: string; stoppedAt: string | null };

/** Seconds of [fromMs, toMs) none of the intervals covers. */
export function uncoveredSeconds(fromMs: number, toMs: number, intervals: readonly Interval[], nowMs: number) {
  const spans = intervals.map((interval) => [Date.parse(interval.startedAt), interval.stoppedAt ? Date.parse(interval.stoppedAt) : nowMs] as const)
    .map(([a, b]) => [Math.max(a, fromMs), Math.min(b, toMs)] as const).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let cursor = fromMs;
  for (const [a, b] of spans) {
    if (b <= cursor) continue;
    covered += b - Math.max(a, cursor);
    cursor = b;
  }
  return Math.max(0, Math.round((toMs - fromMs - covered) / 1000));
}

/**
 * The List's location rows for one day, newest first like the blocks. Unknown places not in a block
 * for ten minutes or more always show; Home, saved and learned places, and places you logged, show
 * faint only with `showAll`. Superseded and ignored items never show.
 */
export function locationListRows(timeline: LocationTimeline | null, entries: readonly Interval[], options: { nowMs: number; showAll: boolean }) {
  if (!timeline) return [];
  const dayStartMs = Date.parse(timeline.dayStart);
  const dayEndMs = Date.parse(timeline.dayEnd);
  const names = new Map(timeline.items.flatMap((item) => item.kind === "place" ? [[item.id, item.name] as const] : []));
  const rows: LocationListRow[] = [];
  for (const item of timeline.items) {
    if (item.kind !== "place" || item.status === "ignored") continue;
    const fromMs = Math.max(Date.parse(item.startedAt), dayStartMs);
    const spanEndMs = Math.min(item.stoppedAt ? Date.parse(item.stoppedAt) : options.nowMs, dayEndMs, options.nowMs);
    if (!(spanEndMs > fromMs)) continue;
    const unloggedSeconds = uncoveredSeconds(fromMs, spanEndMs, entries, options.nowMs);
    const known = item.matchKind === "saved" || item.matchKind === "learned";
    // A place you are still at counts up to now.
    const unlogged = unloggedSeconds >= UNLOGGED_PLACE_MINIMUM_SECONDS;
    if (!known && unlogged) {
      rows.push({ kind: "place", key: `place-${item.id}`, atMs: Date.parse(item.startedAt), place: item, fromMs, spanEndMs, unloggedSeconds, faint: false });
    } else if (options.showAll) {
      rows.push({ kind: "place", key: `place-${item.id}`, atMs: Date.parse(item.startedAt), place: item, fromMs, spanEndMs, unloggedSeconds, faint: true });
    }
  }
  if (timeline.openTrip) {
    rows.push({ kind: "open_trip", key: "open-trip", atMs: Date.parse(timeline.openTrip.startedAt), startedAt: timeline.openTrip.startedAt,
      fromName: names.get(timeline.openTrip.fromId) ?? null, legs: timeline.openTrip.legs, mode: timeline.openTrip.mode });
  }
  return rows.sort((a, b) => b.atMs - a.atMs || a.key.localeCompare(b.key));
}

/** The trip each block was made from, for its legs, with its route in place names ("Home → Unknown place"). */
export function tripsByBlockId(timeline: LocationTimeline | null) {
  const names = new Map((timeline?.items ?? []).flatMap((item) => item.kind === "place" ? [[item.id, item.name] as const] : []));
  const trips = new Map<string, TimelineTrip & { route: string }>();
  for (const item of timeline?.items ?? []) {
    if (item.kind !== "trip" || !item.legs.length) continue;
    const route = `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}`;
    for (const id of item.blockIds) trips.set(id, { ...item, route });
  }
  return trips;
}

/** Whether the day has anything location shows (a "Show Home and every place" switch is worth offering). */
export function hasLocationPlaces(timeline: LocationTimeline | null) {
  return Boolean(timeline?.items.some((item) => item.kind === "place"));
}

/** "Underground or train?" for an unsure leg with a runner-up; the mode alone otherwise. */
export function legModeLabel(leg: Pick<TripLeg, "mode" | "confidence" | "runnerUp">) {
  const label = LEG_MODE_LABEL[leg.mode];
  if (leg.confidence !== "unsure") return label;
  return leg.runnerUp ? `${label} or ${LEG_MODE_LABEL[leg.runnerUp].toLowerCase()}?` : `${label}?`;
}

/** A leg's detail line: distance, how it was seen, and how sure. */
export function legDetail(leg: TripLeg) {
  const km = leg.distanceMeters == null ? null : leg.distanceMeters >= 10_000
    ? `${Math.round(leg.distanceMeters / 1000)} km` : `${(leg.distanceMeters / 1000).toFixed(1)} km`;
  const how = leg.unobserved
    ? leg.mode === "underground" ? "no GPS underground, guessed from the gap" : "no GPS for this leg"
    : null;
  return [km, how, leg.confidence === "likely" ? "likely" : null].filter(Boolean).join(" · ");
}
