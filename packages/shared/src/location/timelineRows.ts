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

/**
 * Something to check (location v4 step 14): an open suggestion, placed on the day's row it is about. Its
 * segment is the timeline item it names (`clientSegmentId`), or none (Apple Health, and anything else).
 */
export type ListCheck = { id: string; segmentId: string | null; startedAt: string | null; stoppedAt: string | null };

/**
 * Whether a check with its own times falls in a window: the rule a check's own row uses for its day, shared
 * with every count of checks (location v4 step 14), so a count always matches what the List shows. A check
 * without a start has no row of its own (it can only sit on its place's row) and falls in no window.
 */
export function listCheckOverlaps(check: Pick<ListCheck, "startedAt" | "stoppedAt">, fromMs: number, toMs: number) {
  const atMs = check.startedAt ? Date.parse(check.startedAt) : NaN;
  if (!Number.isFinite(atMs)) return false;
  const endMs = check.stoppedAt ? Date.parse(check.stoppedAt) : atMs + 1;
  return atMs < toMs && endMs > fromMs;
}

export type LocationListRow =
  | { kind: "place"; key: string; atMs: number; place: TimelinePlace; fromMs: number; spanEndMs: number; unloggedSeconds: number; faint: boolean;
      /** Open suggestions about this place, each a "?" on its row. */
      checkIds: string[] }
  | { kind: "open_trip"; key: string; atMs: number; startedAt: string; fromName: string | null; legs: TripLeg[]; mode: string | null }
  /** A "?" with no place row: a trip not yet in a block (with its route and legs), Apple Health, or anything else. */
  | { kind: "check"; key: string; atMs: number; checkId: string; startedAt: string | null; stoppedAt: string | null;
      trip: (TimelineTrip & { route: string }) | null };

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
export function locationListRows(timeline: LocationTimeline | null, entries: readonly Interval[],
  options: { nowMs: number; showAll: boolean; checks?: readonly ListCheck[];
    /**
     * Owner, 28 Oct 2026 (concern 2): a place whose time your blocks cover is never a row,
     * even with "Show all places"; the block's place line stands for it. A place with a "?" still shows.
     */
    hideCovered?: boolean }) {
  if (!timeline) return [];
  // A check about a place shows on its row (which then always shows); any other check is a row of its own.
  const placeIds = new Set(timeline.items.flatMap((item) => item.kind === "place" ? [item.id] : []));
  const checksByPlace = new Map<string, string[]>();
  for (const check of options.checks ?? []) {
    if (check.segmentId && placeIds.has(check.segmentId)) checksByPlace.set(check.segmentId, [...checksByPlace.get(check.segmentId) ?? [], check.id]);
  }
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
    const checkIds = checksByPlace.get(item.id) ?? [];
    if ((!known && unlogged) || checkIds.length) {
      rows.push({ kind: "place", key: `place-${item.id}`, atMs: Date.parse(item.startedAt), place: item, fromMs, spanEndMs, unloggedSeconds,
        faint: false, checkIds });
    } else if (options.showAll && !(options.hideCovered && unloggedSeconds < 60)) {
      rows.push({ kind: "place", key: `place-${item.id}`, atMs: Date.parse(item.startedAt), place: item, fromMs, spanEndMs, unloggedSeconds,
        faint: true, checkIds });
    }
  }
  // Every other check is a row of its own at its time, with its trip's route and legs when it is about one.
  const trips = new Map(timeline.items.flatMap((item) => item.kind === "trip"
    ? [[item.id, { ...item, route: `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}` }] as const] : []));
  for (const check of options.checks ?? []) {
    if (check.segmentId && placeIds.has(check.segmentId)) continue;
    const trip = check.segmentId ? trips.get(check.segmentId) ?? null : null;
    const startedAt = trip?.startedAt ?? check.startedAt;
    const atMs = startedAt ? Date.parse(startedAt) : NaN;
    // Only checks on this day.
    if (!listCheckOverlaps({ startedAt, stoppedAt: check.stoppedAt }, dayStartMs, dayEndMs)) continue;
    rows.push({ kind: "check", key: `check-${check.id}`, atMs, checkId: check.id, startedAt, stoppedAt: trip?.stoppedAt ?? check.stoppedAt, trip });
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

/**
 * Owner, 28 Oct 2026 (concern 4): a "?" asks for 7 days — today and the 6 days before.
 * The badge, the chips and the reminder count only these; an older one stops asking (no dot, not counted) and
 * its place stays an ordinary row you can still correct. Nothing is answered for you.
 */
export const CHECK_ASKING_DAYS = 7;

/** The start of the asking window: local midnight of the day 6 days before `todayStartMs`'s day. */
export function checkAskingStartMs(todayStartMs: number) {
  const start = new Date(todayStartMs);
  start.setDate(start.getDate() - (CHECK_ASKING_DAYS - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/** Whether a check still asks: it ends (or, without an end, starts) inside the asking window. */
export function checkStillAsks(check: Pick<ListCheck, "startedAt" | "stoppedAt">, askingStartMs: number) {
  const endMs = Date.parse(check.stoppedAt ?? check.startedAt ?? "");
  return Number.isFinite(endMs) && endMs > askingStartMs;
}

/** Checks in the order the badge and "N to check" step through them: oldest first, across days. */
export function checksOldestFirst<T extends Pick<ListCheck, "id" | "startedAt">>(checks: readonly T[]) {
  return [...checks].sort((a, b) => (Date.parse(a.startedAt ?? "") || 0) - (Date.parse(b.startedAt ?? "") || 0) || a.id.localeCompare(b.id));
}
