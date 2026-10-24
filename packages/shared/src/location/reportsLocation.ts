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

/** As `notLoggedPlaceSeconds`, with when the latest counted place started (in the range), for "Check them". */
export function notLoggedPlaces(places: readonly Interval[], entries: readonly Interval[], range: { start: string; end: string },
  nowMs: number): { seconds: number; latestStartedAt: string | null } {
  const fromMs = Date.parse(range.start);
  const toMs = Date.parse(range.end);
  const blocks = entries.flatMap((entry) => {
    const span = clip(entry, fromMs, toMs, nowMs);
    return span ? [span] : [];
  }).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let latestMs: number | null = null;
  for (const place of places) {
    const span = clip(place, fromMs, toMs, nowMs);
    if (!span) continue;
    let covered = 0;
    let cursor = span[0];
    for (const [a, b] of blocks) {
      if (b <= cursor || a >= span[1]) continue;
      covered += Math.min(b, span[1]) - Math.max(a, cursor);
      cursor = Math.min(b, span[1]);
    }
    const uncovered = Math.round((span[1] - span[0] - covered) / 1000);
    if (uncovered < NOT_LOGGED_PLACE_MINIMUM_SECONDS) continue;
    total += uncovered;
    if (latestMs === null || span[0] > latestMs) latestMs = span[0];
  }
  return { seconds: total, latestStartedAt: latestMs === null ? null : new Date(latestMs).toISOString() };
}
