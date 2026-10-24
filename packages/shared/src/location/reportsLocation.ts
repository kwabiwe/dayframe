import { UNLOGGED_PLACE_MINIMUM_SECONDS } from "./timelineRows";
import type { MotionTravelMode, TripLeg } from "./types";

/** A leg's mode (walk to drive now; rail, Underground and tram with legs part 2). */
type TripLegMode = TripLeg["mode"];

/**
 * Reports › Getting around and the not-logged line (location v4 step 18, design §12, mock-up
 * #web-reports), shared by the web and the iPhone. Times only: never places or coordinates.
 */

/** A Getting around or Commute block, with the legs of the trip it was made from (none when it wasn't). */
export type GettingAroundBlock = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  legs: readonly TripLeg[] | null;
  /** The trip's one mode, when it had no legs. */
  travelMode: MotionTravelMode | null;
};

export type GettingAroundSummary = {
  /** Each block once, however many legs it has. */
  tripCount: number;
  totalSeconds: number;
  /** Time by leg mode, most first; "unknown" for blocks with neither legs nor a mode. */
  byMode: Array<{ mode: TripLegMode | "unknown"; seconds: number }>;
  /** Time inside the blocks between legs: waits, stops and changes. */
  stopsSeconds: number;
};

/** A place shows as not logged from this long outside your blocks, as Calendar › List counts it. */
export const NOT_LOGGED_PLACE_MINIMUM_SECONDS = UNLOGGED_PLACE_MINIMUM_SECONDS;

type Interval = { startedAt: string; stoppedAt: string | null };

const clip = (interval: Interval, fromMs: number, toMs: number, nowMs: number) => {
  const start = Math.max(Date.parse(interval.startedAt), fromMs);
  const end = Math.min(interval.stoppedAt ? Date.parse(interval.stoppedAt) : nowMs, toMs, nowMs);
  return end > start ? [start, end] as const : null;
};

/** Getting around in a range: each block's time split by its trip's legs, clipped to the block and the range. */
export function gettingAroundSummary(blocks: readonly GettingAroundBlock[], range: { start: string; end: string }, nowMs: number):
  GettingAroundSummary | null {
  const fromMs = Date.parse(range.start);
  const toMs = Date.parse(range.end);
  const byMode = new Map<TripLegMode | "unknown", number>();
  let tripCount = 0;
  let totalMs = 0;
  let stopsMs = 0;
  for (const block of blocks) {
    const span = clip(block, fromMs, toMs, nowMs);
    if (!span) continue;
    tripCount += 1;
    totalMs += span[1] - span[0];
    if (!block.legs?.length) {
      const mode = block.travelMode ?? "unknown";
      byMode.set(mode, (byMode.get(mode) ?? 0) + span[1] - span[0]);
      continue;
    }
    let legMs = 0;
    for (const leg of block.legs) {
      const part = clip(leg, span[0], span[1], nowMs);
      if (!part) continue;
      legMs += part[1] - part[0];
      byMode.set(leg.mode, (byMode.get(leg.mode) ?? 0) + part[1] - part[0]);
    }
    stopsMs += Math.max(0, span[1] - span[0] - legMs);
  }
  if (!tripCount) return null;
  return {
    tripCount,
    totalSeconds: Math.round(totalMs / 1000),
    byMode: [...byMode].map(([mode, ms]) => ({ mode, seconds: Math.round(ms / 1000) })).filter((row) => row.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds || a.mode.localeCompare(b.mode)),
    stopsSeconds: Math.round(stopsMs / 1000)
  };
}

/**
 * Time at places you haven't named that isn't in a block, in a range: each unknown place's uncovered
 * time, counted when it reaches `NOT_LOGGED_PLACE_MINIMUM_SECONDS` (as its List row shows). Not counted in
 * the report's totals or goals.
 */
export function notLoggedPlaceSeconds(places: readonly Interval[], entries: readonly Interval[], range: { start: string; end: string },
  nowMs: number) {
  return notLoggedPlaces(places, entries, range, nowMs).seconds;
}

/**
 * As `notLoggedPlaceSeconds`, with the latest of the report's `days` on which Calendar › List shows a
 * counted place as not logged (10+ minutes of its uncovered time inside that day), for "Check them"
 * (Codex r1/r2 on #569). Without days, or when no single day reaches the threshold, the day holding
 * the latest uncovered time.
 */
export function notLoggedPlaces(places: readonly Interval[], entries: readonly Interval[], range: { start: string; end: string },
  nowMs: number, days: ReadonlyArray<{ key: string; start: string; end: string }> = []): { seconds: number; latestDay: string | null } {
  const fromMs = Date.parse(range.start);
  const toMs = Date.parse(range.end);
  const blocks = entries.flatMap((entry) => {
    const span = clip(entry, fromMs, toMs, nowMs);
    return span ? [span] : [];
  }).sort((a, b) => a[0] - b[0]);
  const spans = days.map((day) => ({ key: day.key, start: Date.parse(day.start), end: Date.parse(day.end) }));
  const dayOf = (ms: number) => spans.find((day) => ms >= day.start && ms < day.end) ?? null;
  let total = 0;
  let latest: { key: string; start: number } | null = null;
  let latestPieceEnd: number | null = null;
  for (const place of places) {
    const span = clip(place, fromMs, toMs, nowMs);
    if (!span) continue;
    // The place's uncovered pieces, between the blocks that overlap it.
    const pieces: Array<[number, number]> = [];
    let cursor = span[0];
    for (const [a, b] of blocks) {
      if (b <= cursor || a >= span[1]) continue;
      if (a > cursor) pieces.push([cursor, Math.min(a, span[1])]);
      cursor = Math.max(cursor, Math.min(b, span[1]));
    }
    if (cursor < span[1]) pieces.push([cursor, span[1]]);
    const uncovered = Math.round(pieces.reduce((sum, [a, b]) => sum + b - a, 0) / 1000);
    if (uncovered < NOT_LOGGED_PLACE_MINIMUM_SECONDS) continue;
    total += uncovered;
    latestPieceEnd = Math.max(latestPieceEnd ?? 0, pieces[pieces.length - 1][1]);
    for (const day of spans) {
      const inDay = pieces.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, day.end) - Math.max(a, day.start)), 0) / 1000;
      if (inDay >= NOT_LOGGED_PLACE_MINIMUM_SECONDS && (!latest || day.start > latest.start)) latest = day;
    }
  }
  const fallback = latestPieceEnd === null ? null : dayOf(latestPieceEnd - 1)?.key ?? null;
  return { seconds: total, latestDay: latest?.key ?? fallback };
}
