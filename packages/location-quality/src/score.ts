import { COARSE_MODE, type AnswerKey, type FineMode, type KeyStay, type KeyTrip } from "./answerKey";
import type { QualitySegment } from "./segments";

/**
 * Scores engine segments against the answer key (location v4 design §13). Everything works in whole
 * minutes inside the scoring window; a minute belongs to an interval when the whole minute is inside it.
 */

/** Engine travel modes → answer-key modes. An engine Move without a mode scores as "none". */
export const ENGINE_FINE_MODE: Record<string, FineMode> = { walking: "walk", running: "walk", cycling: "cycle", automotive: "car" };
export const DAY_SCORE_WEIGHTS = { kind: 30, stays: 20, bounds: 15, trips: 15, mode: 20 } as const;
/** Stays and trips are scored from ten minutes; a boundary is right within five. */
export const MIN_SCORED_STAY_MINUTES = 10;
export const BOUNDARY_TOLERANCE_MINUTES = 5;
/** A boundary within two minutes of a gap filler is the answer key guessing, so it is not scored. */
export const FILLER_BOUNDARY_SECONDS = 120;
export const SPLIT_STAY_MIN_SECONDS = 1800;
export const SPLIT_OVERLAP_SECONDS = 300;
/** A Move is real travel when this share of it overlaps the key's trips. */
export const REAL_MOVE_SHARE = 0.3;

export type ScoreOptions = {
  /** Window start and end, epoch seconds. */
  from: number;
  to: number;
  /** The anonymous label of the Home place (e.g. "P4"), or null when there is none. */
  homePlace: string | null;
  /** Days are cut and times printed in this zone. */
  timeZone: string;
};

type Interval = { a: number; b: number };
type EngineStay = QualitySegment & Interval & { open: boolean };
type EngineMove = EngineStay;
type StayPair = [KeyStay, EngineStay];
export type Kind = "stay" | "travel" | "none";

export type DayComponents = { kind: number; stays: number; bounds: number; trips: number; mode: number };

export type DayResult = {
  label: string;
  score: number;
  components: DayComponents;
  minutes: number;
  covered: number;
  agree: number;
  confusion: Map<string, number>;
  keyStays: number;
  engineStays: number;
  stayMatched: number;
  phantomStays: number;
  splitStays: number;
  stayPrecision: number;
  stayStartErrors: number[];
  stayEndErrors: number[];
  home: [number, number];
  pairs: StayPair[];
  keyTrips: number;
  tripMatched: number;
  engineMoves: number;
  phantomMoves: number;
  movePrecision: number;
  realMoves: EngineMove[];
  phantomTravelMinutes: number;
  tripStartErrors: number[];
  tripEndErrors: number[];
  legs: [number, number];
  distancePairs: Array<{ engineRouteM: number; keyM: number; routeSamples: number; minutes: number }>;
  multiLegFound: number;
  multiLegTrips: number;
  travelMinutes: number;
  modeFine: number;
  modeCoarse: number;
  byMode: Array<[string, number]>;
  byModeRight: Map<string, number>;
};

export type Bar = { label: string; right: number; total: number; lowerBound: number };

export type QualityReport = {
  window: Interval;
  /** The Home place's label, or null when it is unknown (a saved run scored without --home-place). */
  homePlace: string | null;
  key: { stays: number; trips: number; legs: number; stayMinutes: number; travelMinutes: number; unsureMinutes: number };
  engine: { stays: number; moves: number };
  days: DayResult[];
  week: DayResult;
  bars: Bar[];
  detail: string[];
};

const overlap = (x: Interval, y: Interval) => Math.max(0, Math.min(x.b, y.b) - Math.max(x.a, y.a));
const size = (x: Interval) => x.b - x.a;

export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number.NaN;
}

export function p90(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] : Number.NaN;
}

/** The 90% (one-sided, z = 1.645) Wilson lower bound for k successes in n. */
export function wilsonLower(k: number, n: number, z = 1.645): number {
  if (n === 0) return 0;
  const p = k / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

const harmonic = (recall: number, precision: number) => (recall + precision ? (2 * recall * precision) / (recall + precision) : 0);

export function localDayLabel(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "2-digit", month: "short" });
  return (seconds: number) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(seconds * 1000)).map((part) => [part.type, part.value]));
    return `${parts.weekday} ${parts.day} ${parts.month}`;
  };
}

/** "15 13:05": day of month and local time, for detail lines. */
export function localDayTime(timeZone: string) {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (seconds: number) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(seconds * 1000)).map((part) => [part.type, part.value]));
    return `${parts.day} ${parts.hour}:${parts.minute}`;
  };
}

export function scoreRun(key: AnswerKey, segments: QualitySegment[], options: ScoreOptions): QualityReport {
  const { from: W0, to: W1 } = options;
  const minutesOf = (x: Interval): number[] => {
    const a = Math.max(x.a, W0);
    const b = Math.min(x.b, W1);
    const out: number[] = [];
    if (b > a) for (let m = Math.ceil(a / 60); m < Math.floor(b / 60); m += 1) out.push(m);
    return out;
  };
  const union = (intervals: Interval[]) => {
    const out = new Set<number>();
    for (const x of intervals) for (const m of minutesOf(x)) out.add(m);
    return out;
  };

  // ---------- answer key ----------
  const keyStayMinutes = union(key.stays);
  const unsureMinutes = union(key.fillers);
  for (const m of keyStayMinutes) unsureMinutes.delete(m);
  const keyModeAt = new Map<number, FineMode>();
  for (const activity of key.activities) {
    for (const m of minutesOf(activity)) if (!keyStayMinutes.has(m)) keyModeAt.set(m, activity.mode);
  }
  const keyTravelMinutes = union(key.trips);
  for (const m of keyStayMinutes) keyTravelMinutes.delete(m);

  // ---------- engine ----------
  const engineStays: EngineStay[] = [];
  const engineMoves: EngineMove[] = [];
  for (const segment of segments) {
    const a = Date.parse(segment.startedAt) / 1000;
    const b = segment.stoppedAt ? Date.parse(segment.stoppedAt) / 1000 : W1;
    if (b <= W0 || a >= W1) continue;
    const item = { ...segment, a, b, open: !segment.stoppedAt };
    (segment.kind === "stay" ? engineStays : engineMoves).push(item);
  }
  const engineStayMinutes = union(engineStays);
  const engineMoveMinutes = union(engineMoves);
  for (const m of engineStayMinutes) engineMoveMinutes.delete(m);
  const engineModeAt = new Map<number, string>();
  for (const move of engineMoves) {
    for (const m of minutesOf(move)) if (!engineStayMinutes.has(m)) engineModeAt.set(m, ENGINE_FINE_MODE[move.mode ?? ""] ?? "none");
  }

  const allMinutes: number[] = [];
  for (let m = Math.ceil(W0 / 60); m < Math.floor(W1 / 60); m += 1) allMinutes.push(m);
  const dayLabel = localDayLabel(options.timeZone);
  const dayTime = localDayTime(options.timeZone);

  const keyClass = (m: number): Kind => (keyStayMinutes.has(m) ? "stay" : keyTravelMinutes.has(m) ? "travel" : "none");
  const engineClass = (m: number): Kind => (engineStayMinutes.has(m) ? "stay" : engineMoveMinutes.has(m) ? "travel" : "none");
  const nearFiller = (at: number) =>
    key.fillers.some((filler) => Math.abs(filler.b - at) <= FILLER_BOUNDARY_SECONDS || Math.abs(filler.a - at) <= FILLER_BOUNDARY_SECONDS);
  /** At least half of the interval is time the key is sure about. */
  const mostlySure = (x: Interval) => {
    const ms = minutesOf(x);
    if (ms.length === 0) return !unsureMinutes.has(Math.floor((x.a + x.b) / 120));
    return ms.filter((m) => !unsureMinutes.has(m)).length >= 0.5 * ms.length;
  };
  /** The sure minutes of an interval; a lone placeholder minute when there are none, which no key stay holds. */
  const sureMinutes = (x: Interval) => {
    const ms = minutesOf(x).filter((m) => !unsureMinutes.has(m));
    return ms.length ? ms : [0];
  };

  /** Greedy one-to-one matching by overlap; a pair needs half of the shorter one. */
  const matchStays = (keyStays: KeyStay[], stays: EngineStay[]): StayPair[] => {
    const candidates: Array<[number, number, number]> = [];
    keyStays.forEach((x, i) => stays.forEach((y, j) => {
      const ov = overlap(x, y);
      if (ov > 0) candidates.push([ov, i, j]);
    }));
    candidates.sort((p, q) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2]);
    const usedKey = new Set<number>();
    const usedEngine = new Set<number>();
    const out: StayPair[] = [];
    for (const [ov, i, j] of candidates) {
      if (usedKey.has(i) || usedEngine.has(j)) continue;
      if (ov >= 0.5 * Math.min(size(keyStays[i]), size(stays[j]))) {
        usedKey.add(i);
        usedEngine.add(j);
        out.push([keyStays[i], stays[j]]);
      }
    }
    return out;
  };

  const evaluate = (dayMinutes: number[], label: string): DayResult => {
    // Minutes come in ascending order; no spread, so a long window cannot overflow the stack.
    const lo = dayMinutes[0] * 60;
    const hi = (dayMinutes[dayMinutes.length - 1] + 1) * 60;
    const inside = (x: Interval) => x.b > lo && x.a < hi && (x.a + x.b) / 2 >= lo && (x.a + x.b) / 2 < hi;

    // 1 coverage and kind agreement, over minutes the key is sure about
    const known = dayMinutes.filter((m) => keyClass(m) !== "none" && !unsureMinutes.has(m));
    const confusion = new Map<string, number>();
    for (const m of known) {
      const cell = `${keyClass(m)}/${engineClass(m)}`;
      confusion.set(cell, (confusion.get(cell) ?? 0) + 1);
    }
    const cell = (k: Kind, e: Kind) => confusion.get(`${k}/${e}`) ?? 0;
    const covered = known.filter((m) => engineClass(m) !== "none").length;
    const agree = cell("stay", "stay") + cell("travel", "travel");

    // 2 stays: recall over key stays of 10+ minutes; an engine stay is real when half of its sure time
    //   lies in key stays of any length
    const keyStays = key.stays.filter((x) => inside(x) && minutesOf(x).length >= MIN_SCORED_STAY_MINUTES);
    const allScoredStays = engineStays.filter((x) => inside(x) && minutesOf(x).length >= MIN_SCORED_STAY_MINUTES);
    const pairs = matchStays(keyStays, allScoredStays);
    const scoredStays = allScoredStays.filter(mostlySure);
    const realStays = scoredStays.filter((x) => {
      const sure = sureMinutes(x);
      return sure.filter((m) => keyStayMinutes.has(m)).length >= 0.5 * sure.length;
    });
    const splitStays = keyStays.filter((x) => size(x) >= SPLIT_STAY_MIN_SECONDS
      && engineStays.filter((y) => overlap(x, y) >= SPLIT_OVERLAP_SECONDS).length >= 2).length;
    const stayStartErrors: number[] = [];
    const stayEndErrors: number[] = [];
    for (const [x, y] of pairs) {
      if (x.a > W0 && y.a > W0 && !nearFiller(x.a)) stayStartErrors.push((y.a - x.a) / 60);
      if (x.b < W1 && !y.open && !nearFiller(x.b)) stayEndErrors.push((y.b - x.b) / 60);
    }
    const homes = pairs.filter(([x]) => x.home);
    const home: [number, number] = [homes.filter(([, y]) => y.place === options.homePlace).length, homes.length];

    // 3 trips: found when one Move overlaps half of the shorter of the two, or Moves cover half of it;
    //   a Move is real when 30% of it is key travel
    const keyTrips = key.trips.filter(inside);
    const scoredMoves = engineMoves.filter((x) => inside(x) && mostlySure(x));
    const found: KeyTrip[] = [];
    const tripStartErrors: number[] = [];
    const tripEndErrors: number[] = [];
    const distancePairs: DayResult["distancePairs"] = [];
    let legsRight = 0;
    for (const x of keyTrips) {
      let best: EngineMove | null = null;
      for (const y of engineMoves) if (!best || overlap(x, y) > overlap(x, best)) best = y;
      if (!best || overlap(x, best) <= 0) continue;
      const total = engineMoves.reduce((sum, y) => sum + overlap(x, y), 0);
      if (overlap(x, best) >= 0.5 * Math.min(size(x), size(best)) || total >= 0.5 * size(x)) {
        found.push(x);
        if (x.a > W0) tripStartErrors.push((best.a - x.a) / 60);
        if (x.b < W1) tripEndErrors.push((best.b - x.b) / 60);
        // The engine gives one leg per Move today.
        if (x.legs.length === 1) legsRight += 1;
        if (x.legs.length === 1 && x.legs[0].mode === "car" && best.routeM && x.legs[0].dist > 500) {
          distancePairs.push({ engineRouteM: best.routeM, keyM: x.legs[0].dist, routeSamples: best.routeSamples || 0, minutes: size(best) / 60 });
        }
      }
    }
    const realMoves = scoredMoves.filter((y) => key.allTrips.reduce((sum, x) => sum + overlap(y, x), 0) >= REAL_MOVE_SHARE * size(y));
    const stayPrecision = scoredStays.length ? realStays.length / scoredStays.length : 1;
    const movePrecision = scoredMoves.length ? realMoves.length / scoredMoves.length : 1;

    // 4 mode, per key travel minute
    const travel = dayMinutes.filter((m) => keyModeAt.has(m) && keyTravelMinutes.has(m));
    const modeFine = travel.filter((m) => engineModeAt.get(m) === keyModeAt.get(m)).length;
    const modeCoarse = travel.filter((m) => COARSE_MODE[engineModeAt.get(m) ?? "none"] === COARSE_MODE[keyModeAt.get(m)!]).length;
    const byModeCount = new Map<string, number>();
    const byModeRight = new Map<string, number>();
    for (const m of travel) {
      const mode = keyModeAt.get(m)!;
      byModeCount.set(mode, (byModeCount.get(mode) ?? 0) + 1);
      if (engineModeAt.get(m) === mode) byModeRight.set(mode, (byModeRight.get(mode) ?? 0) + 1);
    }
    const byMode = [...byModeCount.entries()].sort((p, q) => q[1] - p[1]);

    // 5 day score
    const within = [...stayStartErrors, ...stayEndErrors].map((v) => Math.abs(v) <= BOUNDARY_TOLERANCE_MINUTES);
    const components: DayComponents = {
      kind: known.length ? agree / known.length : 1,
      stays: harmonic(keyStays.length ? pairs.length / keyStays.length : 1, stayPrecision),
      bounds: within.length ? within.filter(Boolean).length / within.length : 1,
      trips: harmonic(keyTrips.length ? found.length / keyTrips.length : 1, movePrecision),
      mode: travel.length ? modeFine / travel.length : 1
    };
    const score = (Object.keys(DAY_SCORE_WEIGHTS) as Array<keyof DayComponents>)
      .reduce((sum, name) => sum + DAY_SCORE_WEIGHTS[name] * components[name], 0);

    return {
      label, score, components, minutes: known.length, covered, agree, confusion,
      keyStays: keyStays.length, engineStays: scoredStays.length, stayMatched: pairs.length,
      phantomStays: scoredStays.length - realStays.length, splitStays, stayPrecision, stayStartErrors, stayEndErrors, home, pairs,
      keyTrips: keyTrips.length, tripMatched: found.length, engineMoves: scoredMoves.length,
      phantomMoves: scoredMoves.length - realMoves.length, movePrecision, realMoves,
      phantomTravelMinutes: dayMinutes.filter((m) => keyStayMinutes.has(m) && engineMoveMinutes.has(m)).length,
      tripStartErrors, tripEndErrors, legs: [legsRight, found.length], distancePairs,
      multiLegFound: found.filter((x) => x.legs.length > 1).length,
      multiLegTrips: keyTrips.filter((x) => x.legs.length > 1).length,
      travelMinutes: travel.length, modeFine, modeCoarse, byMode, byModeRight
    };
  };

  // Every time zone's midnight falls on a quarter hour, so one label per quarter hour is exact.
  const dayBuckets = new Map<string, number[]>();
  let quarter = Number.NaN;
  let label = "";
  for (const m of allMinutes) {
    if (Math.floor(m / 15) !== quarter) {
      quarter = Math.floor(m / 15);
      label = dayLabel(quarter * 15 * 60);
    }
    const bucket = dayBuckets.get(label);
    if (bucket) bucket.push(m);
    else dayBuckets.set(label, [m]);
  }
  const days = [...dayBuckets.entries()].map(([label, ms]) => evaluate(ms, label));
  const week = evaluate(allMinutes, "week");

  // ---------- bars (events in the window; Wilson 90% lower bound) ----------
  const boundsOk = week.pairs.filter(([x, y]) =>
    (Math.abs(y.a - x.a) <= BOUNDARY_TOLERANCE_MINUTES * 60 || nearFiller(x.a))
    && (y.open || x.b >= W1 || nearFiller(x.b) || Math.abs(y.b - x.b) <= BOUNDARY_TOLERANCE_MINUTES * 60));
  const bar = (label: string, right: number, total: number): Bar => ({ label, right, total, lowerBound: wilsonLower(right, total) });
  const saved = week.pairs.filter(([, y]) => y.match === "saved");
  const unknown = week.pairs.filter(([, y]) => y.match !== "saved");
  const moves = engineMoves.filter(mostlySure);
  const real = new Set(week.realMoves);
  const knownEnds = (y: EngineMove) => y.from !== null && y.from !== "-" && y.to !== null && y.to !== "-";
  const betweenKnown = moves.filter(knownEnds);
  const unknownEnd = moves.filter((y) => !knownEnds(y));
  const bars = [
    bar("saved-place stays with both ends ≤5 min", saved.filter((p) => boundsOk.includes(p)).length, saved.length),
    bar("unknown-place stays with both ends ≤5 min", unknown.filter((p) => boundsOk.includes(p)).length, unknown.length),
    bar("Moves that are real travel", week.realMoves.length, moves.length),
    bar("Moves between known places that are real", betweenKnown.filter((y) => real.has(y)).length, betweenKnown.length),
    bar("Moves with an unknown end that are real", unknownEnd.filter((y) => real.has(y)).length, unknownEnd.length)
  ];

  // ---------- detail: what to look at (times and labels only) ----------
  const span = (x: Interval) => `${dayTime(x.a)}–${dayTime(x.b).slice(3)}`;
  const detail: string[] = [];
  for (const y of moves.filter((move) => !real.has(move))) {
    const tripOverlap = key.trips.reduce((sum, x) => sum + overlap(y, x), 0) / 60;
    detail.push(`phantom Move ${span(y)} ${y.from}>${y.to} ${y.reason} ${y.confidence} mode=${y.mode} gt-overlap=${tripOverlap.toFixed(1)} min`);
  }
  const sureStays = engineStays.filter((y) => minutesOf(y).length >= MIN_SCORED_STAY_MINUTES && mostlySure(y));
  const matched = new Set(week.pairs.map(([, y]) => y));
  for (const y of sureStays) if (!matched.has(y)) detail.push(`unmatched engine stay ${span(y)} ${y.match}:${y.place}`);
  for (const pair of week.pairs) {
    if (!boundsOk.includes(pair)) detail.push(`boundary miss: Google ${span(pair[0])} engine ${span(pair[1])} ${pair[1].match}:${pair[1].place}`);
  }
  const matchedKey = new Set(week.pairs.map(([x]) => x));
  for (const x of key.stays) {
    if (minutesOf(x).length >= MIN_SCORED_STAY_MINUTES && !matchedKey.has(x)) detail.push(`missed Google stay ${span(x)}`);
  }
  for (const y of sureStays) {
    const sure = sureMinutes(y);
    const inStays = sure.filter((m) => keyStayMinutes.has(m)).length;
    if (inStays < 0.5 * sure.length) detail.push(`phantom stay ${span(y)} ${y.match}:${y.place} overlap ${inStays}/${sure.length}`);
  }
  for (const y of moves) if (y.mode === null) detail.push(`no-mode move ${span(y)}`);

  return {
    window: { a: W0, b: W1 },
    homePlace: options.homePlace,
    key: {
      stays: key.stays.length,
      trips: key.trips.length,
      legs: key.trips.reduce((sum, trip) => sum + trip.legs.length, 0),
      stayMinutes: keyStayMinutes.size,
      travelMinutes: keyTravelMinutes.size,
      unsureMinutes: unsureMinutes.size
    },
    engine: { stays: engineStays.length, moves: engineMoves.length },
    days,
    week,
    bars,
    detail
  };
}
