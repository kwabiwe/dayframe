import type { LocationEngineConfig } from "./config";
import { distanceMeters } from "./geo";
import { credibleSpeedResolver } from "./commute";
import { buildMotionTimeline, isMotionEvidence, motionLegLabels, type MotionTimeline } from "./motionActivity";
import { nearestStation, type StationKind } from "./stations";
import type { ClassifiedEvidence, CommuteSegment, MotionTravelMode, OpenTrip, TripLeg, TripLegMode } from "./types";

/**
 * Legs of a trip, part 1 (location v4 §8, build step 6): walk, run, cycle and drive. Change points are
 * a Core Motion class change held for `tripLegMinimumMs` of observed time, a speed regime change in
 * credible readings, and stillness of `tripStopMinimumMs` or more (a change or a wait, which separates
 * legs of different modes and is never a leg). Indeterminate time joins the leg beside it but never
 * counts towards a hold. Legs shorter than `tripLegMinimumMs` merge into the longer moving neighbour
 * (across stops; the earlier on a tie), shortest first, unless they are walks of
 * `tripChangeWalkMinimumMs` or more between two vehicle legs. A stop between two legs of one mode joins
 * that leg.
 *
 * Part 2 (build step 7): a silence of `tripUnseenLegMinimumMs` or more between genuine fixes
 * `tripUnseenLegMinimumMeters` apart at 5–25 m/s, with readings better than cell-only accuracy no more
 * often than one per `tripUnseenSparseReadingIntervalMs` in between, and a station (Underground or rail)
 * near both ends, is a leg of its own: the Underground (sure between Underground stations), a train (likely,
 * between rail stations), else unsure Underground with train as runner-up. Without stations at both ends the
 * gap joins the leg around it: a gap alone never guesses a mode (card A, 24 Oct). A vehicle
 * leg with a sustained train speed and few stops is a train: sure between rail stations, and without
 * them, at a median above UK motorway limits, unsure with car as runner-up (a fast drive matches it).
 * A vehicle leg between Underground stations is the Underground, and a slower one between metro or
 * tram stops a tram; each end is witnessed by its own fix inside the leg. Deterministic and replayable;
 * genuine location fixes (and the times of broad ones), Core Motion and the bundled stations only.
 */

type Label = MotionTravelMode | "still" | "unseen";
type GapStations = "underground" | "rail" | "mixed";
type SpeedClass = "still" | "foot" | "mid" | "vehicle";
type Slice = {
  fromMs: number;
  toMs: number;
  /** Null when nothing labels the slice (indeterminate). */
  label: Label | null;
  /** Core Motion's own report for the slice, never a carried label. */
  reported: Label | null;
  /** Whether the label was seen (reported by Core Motion, or backed by a speed in its range), not only carried: only seen time holds a change. */
  seen: boolean;
};
/** A run of slices [first, last] with one label; `observedMs` leaves indeterminate slices out. */
type Run = { label: Label; first: number; last: number; observedMs: number; prev: Run | null; next: Run | null; alive: boolean };

const VEHICLE: ReadonlySet<Label> = new Set(["automotive", "cycling", "unseen"]);
/** How long one reading's speed speaks for the time after it. */
const SPEED_HOLD_MS = 120_000;
/** A leg's end is witnessed by a fix this close to it, inside the leg. */
const ENDPOINT_WINDOW_MS = 120_000;
/** A credible speed under this is stillness, for counting a train's stops. */
const STOP_SPEED_MPS = 1.5;

function speedClass(speed: number, config: LocationEngineConfig): SpeedClass {
  if (speed < config.tripStillSpeedMps) return "still";
  if (speed <= config.tripFootMaximumSpeedMps) return "foot";
  if (speed < config.tripVehicleMinimumSpeedMps) return "mid";
  return "vehicle";
}

function sliceLabel(motion: Label | null, speed: SpeedClass | null): Label | null {
  // A vehicle's speed outvotes walking or stillness: iOS reports both while riding smooth trains.
  if (speed === "vehicle" && (motion === null || motion === "walking" || motion === "running" || motion === "still")) return "automotive";
  if (motion) return motion;
  switch (speed) {
    case "foot": return "walking";
    case "mid": return "automotive";
    case "still": return "still";
    default: return null;
  }
}

/** Whether a speed regime supports a label: a moving mode's own range, or stillness for a stop. */
function speedSupports(label: Label, speed: SpeedClass): boolean {
  if (label === "unseen") return false;
  return label === "still" ? speed === "still" : speedFits(label, speed);
}

/** Whether a reading's speed fits a leg's mode, for its confidence. */
function speedFits(mode: MotionTravelMode, speed: SpeedClass): boolean {
  switch (mode) {
    case "walking": case "running": return speed === "foot";
    case "cycling": return speed === "mid" || speed === "foot";
    case "automotive": return speed === "mid" || speed === "vehicle";
  }
}

/** A genuine location fix with an accurate position: the only readings a leg's distance uses. */
export function genuineLegFix(item: ClassifiedEvidence, config: LocationEngineConfig) {
  const { kind, isSimulated, latitude, longitude, horizontalAccuracyMeters } = item.evidence;
  return (kind === "standard_location" || kind === "significant_change") && isSimulated !== true &&
    latitude != null && longitude != null && horizontalAccuracyMeters != null &&
    horizontalAccuracyMeters <= config.highQualityHorizontalAccuracyMeters;
}

/** A binary min-heap of runs by observed time, then by position; entries made stale by a merge are skipped on pop. */
class RunHeap {
  private items: Array<{ run: Run; key: number; order: number }> = [];
  get size() {
    return this.items.length;
  }
  push(run: Run) {
    this.items.push({ run, key: run.observedMs, order: run.first });
    for (let index = this.items.length - 1; index > 0;) {
      const parent = (index - 1) >> 1;
      if (this.less(parent, index)) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      for (let index = 0; ;) {
        const left = index * 2 + 1;
        let smallest = index;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (left + 1 < this.items.length && this.less(left + 1, smallest)) smallest = left + 1;
        if (smallest === index) break;
        [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
  private less(a: number, b: number) {
    const x = this.items[a];
    const y = this.items[b];
    return x.key < y.key || x.key === y.key && x.order < y.order;
  }
}

export function deriveTripLegs({
  startMs,
  endMs,
  timeline,
  readings,
  speedOf,
  config,
  broadReadingTimes = []
}: {
  startMs: number;
  endMs: number;
  timeline: MotionTimeline | null;
  /** The trip's own location readings, in time order. */
  readings: readonly ClassifiedEvidence[];
  /** A reading's speed when it is credible (native from any copy, else an accurate fix's implied speed), or null. */
  speedOf: (item: ClassifiedEvidence) => number | null;
  config: LocationEngineConfig;
  /** When genuine readings too broad to accept but better than cell-only were taken (epoch ms): each one breaks a silence. */
  broadReadingTimes?: readonly number[];
}): TripLeg[] {
  if (!(endMs > startMs)) return [];
  const labels = timeline ? motionLegLabels(timeline).filter((item) => item.toMs > startMs && item.fromMs < endMs) : [];
  const timed = readings.map((item) => ({ item, atMs: Date.parse(item.evidence.occurredAt) }))
    .filter(({ atMs }) => atMs >= startMs && atMs <= endMs);
  const speeds = timed.flatMap(({ item, atMs }) => {
    const speed = speedOf(item);
    return speed != null && Number.isFinite(speed) && speed >= 0 ? [{ atMs, speed: speedClass(speed, config) }] : [];
  });
  const fixes = timed.filter(({ item }) => genuineLegFix(item, config))
    .map(({ item, atMs }) => ({ atMs, point: { latitude: item.evidence.latitude!, longitude: item.evidence.longitude! } }));
  // Genuine accepted readings better than cell-only accuracy (design §8). A run between distant fixes
  // stays a silence while they are sparse: underground, station Wi-Fi gives a reading of 70–130 m now and
  // then (one to three in 5–24 minutes in the owner's week), where a drive gives one every minute. A
  // reading too broad to accept but better than cell-only (200–500 m) breaks it outright (Codex r4 on #563).
  const observedTimes = timed.filter(({ item }) => {
    const { kind, isSimulated, latitude, longitude, horizontalAccuracyMeters } = item.evidence;
    return (kind === "standard_location" || kind === "significant_change") && isSimulated !== true &&
      latitude != null && longitude != null && horizontalAccuracyMeters != null &&
      horizontalAccuracyMeters < config.tripUnseenObservedAccuracyMeters;
  }).map(({ atMs }) => atMs).sort((a, b) => a - b);
  const broadTimes = broadReadingTimes.filter((atMs) => atMs >= startMs && atMs <= endMs).sort((a, b) => a - b);
  let observedFrom = 0;
  let broadFrom = 0;
  const near = (point: { latitude: number; longitude: number }, kinds: readonly StationKind[]) =>
    config.tripStationsEnabled && nearestStation(point, kinds, config.tripStationRadiusMeters) != null;
  /** What a silence's two anchors are near: Underground stations, rail stations, one of each, or no station at one end. */
  const gapStations = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): GapStations | null =>
    near(a, ["underground"]) && near(b, ["underground"]) ? "underground"
      : near(a, ["rail"]) && near(b, ["rail"]) ? "rail"
        : near(a, ["underground", "rail"]) && near(b, ["underground", "rail"]) ? "mixed" : null;
  // Unseen stretches: nothing much observed between two distant genuine fixes, at train or Underground speed.
  const unseen = fixes.slice(1).flatMap((next, index) => {
    const before = fixes[index];
    while (observedFrom < observedTimes.length && observedTimes[observedFrom] <= before.atMs) observedFrom += 1;
    let inside = 0;
    while (observedFrom + inside < observedTimes.length && observedTimes[observedFrom + inside] < next.atMs) inside += 1;
    if (inside * config.tripUnseenSparseReadingIntervalMs > next.atMs - before.atMs) return [];
    while (broadFrom < broadTimes.length && broadTimes[broadFrom] <= before.atMs) broadFrom += 1;
    if (broadFrom < broadTimes.length && broadTimes[broadFrom] < next.atMs) return [];
    const gapMs = next.atMs - before.atMs;
    const meters = distanceMeters(before.point, next.point);
    const mps = meters / (gapMs / 1_000);
    // Underground or train only with a station near both ends (card A, 24 Oct: a 1.8 km silence between
    // two drives read "Underground or train?"): otherwise the gap joins the leg around it.
    const stations = gapMs >= config.tripUnseenLegMinimumMs && meters >= config.tripUnseenLegMinimumMeters &&
      mps >= config.tripUnseenLegMinimumSpeedMps && mps <= config.tripUnseenLegMaximumSpeedMps
      ? gapStations(before.point, next.point) : null;
    return stations ? [{ fromMs: before.atMs, toMs: next.atMs, stations }] : [];
  });
  // Elementary slices between every change of any input.
  const cuts = [...new Set([startMs, endMs, ...labels.flatMap((item) => [item.fromMs, item.toMs]),
    ...speeds.flatMap(({ atMs }) => [atMs, atMs + SPEED_HOLD_MS]), ...unseen.flatMap((item) => [item.fromMs, item.toMs])])]
    .filter((at) => at >= startMs && at <= endMs).sort((a, b) => a - b);
  const slices: Slice[] = [];
  let labelIndex = 0;
  let speedIndex = -1;
  for (let index = 1; index < cuts.length; index += 1) {
    const fromMs = cuts[index - 1];
    const toMs = cuts[index];
    const midMs = (fromMs + toMs) / 2;
    while (labelIndex < labels.length && labels[labelIndex].toMs <= midMs) labelIndex += 1;
    const motion = labelIndex < labels.length && labels[labelIndex].fromMs <= midMs ? labels[labelIndex] : null;
    while (speedIndex + 1 < speeds.length && speeds[speedIndex + 1].atMs <= midMs) speedIndex += 1;
    const speed = speedIndex >= 0 && midMs - speeds[speedIndex].atMs <= SPEED_HOLD_MS ? speeds[speedIndex].speed : null;
    const reported = motion && !motion.carried ? motion.label : null;
    // A silence between distant fixes is its own leg; the gap itself is what was seen.
    const silent = unseen.some((item) => item.fromMs <= midMs && midMs < item.toMs);
    const label = silent ? "unseen" : sliceLabel(motion?.label ?? null, speed);
    // Seen: Core Motion reported it, or a speed whose regime fits it (a speed that contradicts a carried label never holds it).
    slices.push({ fromMs, toMs, label, reported,
      seen: silent || reported != null || label != null && speed != null && speedSupports(label, speed) });
  }
  const sliceMs = (slice: Slice) => slice.toMs - slice.fromMs;

  // Runs of one label, linked in time order. Indeterminate slices join the run before them (the first
  // run takes any at the start); only seen time (not a carried label) adds to a run's observed time.
  let head: Run | null = null;
  let tail: Run | null = null;
  for (const [index, slice] of slices.entries()) {
    const seenMs = slice.label && slice.seen ? sliceMs(slice) : 0;
    if (tail && (!slice.label || slice.label === tail.label)) {
      tail.last = index;
      tail.observedMs += seenMs;
    } else if (slice.label) {
      const run: Run = { label: slice.label, first: tail ? index : 0, last: index, observedMs: seenMs, prev: tail, next: null, alive: true };
      if (tail) tail.next = run;
      else head = run;
      tail = run;
    }
  }
  if (!head) return [];

  /** Joins a run's next neighbour into it when they share a label; returns the run. */
  const joinNext = (run: Run) => {
    const next = run.next;
    if (!next || next.label !== run.label) return run;
    run.last = next.last;
    run.observedMs += next.observedMs;
    run.next = next.next;
    if (next.next) next.next.prev = run;
    else tail = run;
    next.alive = false;
    return run;
  };
  /** Gives a run a new label and joins it with same-label neighbours; returns the survivor. */
  const relabel = (run: Run, label: Label) => {
    run.label = label;
    const survivor = run.prev && run.prev.label === label ? joinNext(run.prev) : run;
    return joinNext(survivor);
  };
  /** Joins a run with a same-label moving run across one stop on either side; the stop never holds the mode. */
  const joinAcrossStops = (start: Run) => {
    let run = start;
    if (run.prev?.label === "still" && run.prev.prev?.label === run.label) {
      run.prev.observedMs = 0;
      run = relabel(run.prev, run.label);
    }
    if (run.next?.label === "still" && run.next.next?.label === run.label) {
      run.next.observedMs = 0;
      run = relabel(run.next, run.label);
    }
    return run;
  };
  const movingBefore = (run: Run) => {
    let other = run.prev;
    while (other && other.label === "still") other = other.prev;
    return other;
  };
  const movingAfter = (run: Run) => {
    let other = run.next;
    while (other && other.label === "still") other = other.next;
    return other;
  };

  // Brief stillness (waiting to cross, a light) is part of the moving time beside it.
  for (let run: Run | null = head; run; run = run.next) {
    if (run.label !== "still" || run.observedMs >= config.tripStopMinimumMs) continue;
    const neighbour = run.prev && run.prev.label !== "still" ? run.prev : run.next && run.next.label !== "still" ? run.next : null;
    if (!neighbour) continue;
    // The pause is part of the leg's time, but never part of the moving time that holds its mode.
    run.observedMs = 0;
    run = relabel(run, neighbour.label);
  }

  // A stop between two runs of one mode does not change the mode (a car at lights): join them before any
  // short-run decision, so their seen time together holds the mode; the stop's time never does (Codex r6 on #562).
  for (let run: Run | null = head; run; run = run.next) {
    if (run.label === "still" && run.prev && run.next && run.prev.label === run.next.label) {
      run.observedMs = 0;
      run = relabel(run, run.prev.label);
    }
  }

  // Short moving runs join their longer moving neighbour, across stops, shortest first. A walk that
  // lasts `tripChangeWalkMinimumMs` between two vehicle legs (a change of train, a walk to the bus) stays.
  const heap = new RunHeap();
  const shortMoving = (run: Run) => run.alive && run.label !== "still" && run.observedMs < config.tripLegMinimumMs;
  let runCount = 0;
  for (let run: Run | null = head; run; run = run.next) {
    runCount += 1;
    if (shortMoving(run)) heap.push(run);
  }
  // Every merge joins the short run into its neighbour, across any stop between them, so each one removes
  // at least one moving run (at most runCount merges, each pushing at most three runs): the cap is never
  // reached and only guards against a mistake. Relabelling without joining could swap two modes back and
  // forth across stops (Codex r5 on #562).
  for (let guard = runCount * 8; heap.size && guard > 0; guard -= 1) {
    const { run, key } = heap.pop();
    if (!shortMoving(run) || key !== run.observedMs) continue;
    const before = movingBefore(run);
    const after = movingAfter(run);
    const isWalk = run.label === "walking" || run.label === "running";
    if (isWalk && run.observedMs >= config.tripChangeWalkMinimumMs && before && after &&
      VEHICLE.has(before.label) && VEHICLE.has(after.label)) continue;
    const into = before && after ? (after.observedMs > before.observedMs ? after : before) : before ?? after;
    // Already its neighbour's mode across a stop: the stop pass below joins them.
    if (!into || into.label === run.label) continue;
    const survivor = joinAcrossStops(relabel(run, into.label));
    if (shortMoving(survivor)) heap.push(survivor);
    // A neighbour's change can end another short run's change-walk exemption.
    for (const other of [movingBefore(survivor), movingAfter(survivor)]) if (other && shortMoving(other)) heap.push(other);
  }

  // A stop between two legs of one mode does not change the leg (a car at lights, a walk past a wait).
  for (let run: Run | null = head; run; run = run.next) {
    if (run.label === "still" && run.prev && run.next && run.prev.label === run.next.label) run = relabel(run, run.prev.label);
  }

  const moving: Run[] = [];
  for (let run: Run | null = head; run; run = run.next) if (run.label !== "still") moving.push(run);
  if (!moving.length) return [];
  const rawSpeeds = timed.flatMap(({ item, atMs }) => {
    const speed = speedOf(item);
    return speed != null && Number.isFinite(speed) && speed >= 0 ? [{ atMs, speed }] : [];
  });
  /**
   * A leg's two end witnesses: a genuine fix inside the leg within `ENDPOINT_WINDOW_MS` (at most a quarter
   * of the leg) of its start, and another within that of its end. Fixes outside the leg (an adjacent walk's)
   * or in its middle never prove where it began or ended.
   */
  const endPoints = (fromMs: number, toMs: number) => {
    const window = Math.min(ENDPOINT_WINDOW_MS, (toMs - fromMs) / 4);
    let start: (typeof fixes)[number] | null = null;
    let end: (typeof fixes)[number] | null = null;
    for (const fix of fixes) {
      if (fix.atMs >= fromMs && fix.atMs <= fromMs + window && (!start || fix.atMs < start.atMs)) start = fix;
      if (fix.atMs <= toMs && fix.atMs >= toMs - window && (!end || fix.atMs > end.atMs)) end = fix;
    }
    return start && end && start !== end ? { from: start.point, to: end.point } : null;
  };
  const bothAt = (fromMs: number, toMs: number, kinds: readonly StationKind[]) => {
    if (!config.tripStationsEnabled) return false;
    const ends = endPoints(fromMs, toMs);
    return Boolean(ends && nearestStation(ends.from, kinds, config.tripStationRadiusMeters) &&
      nearestStation(ends.to, kinds, config.tripStationRadiusMeters));
  };
  /** Distance along the genuine accurate fixes in [fromMs, toMs], through every gap's two anchors; null with fewer than two. */
  const pathMeters = (fromMs: number, toMs: number) => {
    const points = fixes.filter(({ atMs }) => atMs >= fromMs && atMs <= toMs).map(({ point }) => point);
    return points.length >= 2 ? Math.round(points.slice(1).reduce((sum, point, at) => sum + distanceMeters(points[at], point), 0)) : null;
  };
  return mergeSameModeLegs(moving.map((run, index): TripLeg => {
    // Stillness at the trip's ends belongs to the first or last leg, whose times are the trip's own.
    const fromMs = index === 0 ? startMs : slices[run.first].fromMs;
    const toMs = index === moving.length - 1 ? endMs : slices[run.last].toMs;
    const startedAt = new Date(fromMs).toISOString();
    const stoppedAt = new Date(toMs).toISOString();
    if (run.label === "unseen") {
      const gapFromMs = slices[run.first].fromMs;
      const gapToMs = slices[run.last].toMs;
      // Unseen runs merged across a stop keep every gap's anchors in their distance.
      const distance = pathMeters(gapFromMs, gapToMs);
      // Each silence by its own two anchors (Codex r1 on #590): all between Underground stations, the
      // Underground; all between rail stations, a train; otherwise either.
      const kinds = new Set(unseen.filter((gap) => gap.fromMs < gapToMs && gap.toMs > gapFromMs).map((gap) => gap.stations));
      if (kinds.size === 1 && kinds.has("underground")) {
        return { startedAt, stoppedAt, mode: "underground", confidence: "sure", unobserved: true, distanceMeters: distance };
      }
      if (kinds.size === 1 && kinds.has("rail")) {
        return { startedAt, stoppedAt, mode: "train", confidence: "likely", unobserved: true, distanceMeters: distance };
      }
      return { startedAt, stoppedAt, mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: distance };
    }
    const mode = run.label as MotionTravelMode;
    let covered = 0;
    let agreeing = 0;
    for (let at = run.first; at <= run.last; at += 1) {
      covered += sliceMs(slices[at]);
      if (slices[at].reported === mode) agreeing += sliceMs(slices[at]);
    }
    const motionAgrees = agreeing > 0 && agreeing * 2 >= covered;
    const inLeg = speeds.filter(({ atMs }) => atMs >= fromMs && atMs < toMs);
    const speedAgrees = inLeg.length > 0 && inLeg.filter(({ speed }) => speedFits(mode, speed)).length * 2 >= inLeg.length;
    const confidence: TripLeg["confidence"] = motionAgrees && speedAgrees ? "sure" : motionAgrees || speedAgrees ? "likely" : "unsure";
    const meters = pathMeters(fromMs, toMs);
    if (mode === "automotive") {
      // Every credible reading of the leg, its arrival included, in time order.
      const legSpeeds = rawSpeeds.filter(({ atMs }) => atMs >= fromMs && atMs <= toMs);
      const sorted = legSpeeds.map(({ speed }) => speed).sort((a, b) => a - b);
      const median = sorted.length ? sorted[sorted.length >> 1] : null;
      const fastTimes = legSpeeds.filter(({ speed }) => speed >= config.tripTrainMinimumSpeedMps).map(({ atMs }) => atMs);
      // Sustained: enough readings, half of them at train speed, spread over at least half the leg.
      const sustained = legSpeeds.length >= config.tripTrainSustainedMinimumReadings && fastTimes.length >= 2 &&
        fastTimes.length * 2 >= legSpeeds.length && (fastTimes.at(-1)! - fastTimes[0]) * 2 >= toMs - fromMs &&
        sorted.at(-1)! <= config.tripTrainMaximumSpeedMps;
      // Few stops: the stretches of stillness inside the leg are on average far apart (not a bus's).
      let stops = 0;
      for (let at = 1; at < legSpeeds.length - 1; at += 1) {
        if (legSpeeds[at].speed < STOP_SPEED_MPS && legSpeeds[at - 1].speed >= STOP_SPEED_MPS) stops += 1;
      }
      const spanMeters = meters ?? (median == null ? 0 : median * (toMs - fromMs) / 1_000);
      const trainLike = sustained && (stops === 0 || spanMeters / stops >= config.tripTrainMinimumStopSpacingMeters);
      const atRail = trainLike && bothAt(fromMs, toMs, ["rail"]);
      // Without stations at both ends, a sustained speed above UK motorway limits is a train, but one a
      // fast drive can match: unsure, with car as the runner-up, for the person to settle.
      const speedOnlyTrain = !atRail && trainLike && median != null && legSpeeds.length >= config.tripTrainSpeedOnlyMinimumReadings &&
        median >= config.tripTrainSpeedOnlyMinimumMps;
      const atUnderground = !atRail && !speedOnlyTrain && bothAt(fromMs, toMs, ["underground"]);
      const transit: TripLegMode | null = atRail || speedOnlyTrain ? "train"
        : atUnderground ? "underground"
          : median != null && median <= config.tripTramMaximumSpeedMps && bothAt(fromMs, toMs, ["metro"]) ? "tram" : null;
      if (speedOnlyTrain) return { startedAt, stoppedAt, mode: "train", confidence: "unsure", runnerUp: "automotive", distanceMeters: meters };
      if (transit) return { startedAt, stoppedAt, mode: transit, confidence: atRail || atUnderground ? "sure" : "likely", distanceMeters: meters };
    }
    return { startedAt, stoppedAt, mode, confidence, distanceMeters: meters };
  }));
}

/**
 * Consecutive legs of one mode are one leg (card A, owner feedback 25 Oct: "Underground 52m", not four
 * Underground rows): a silence and a ride between Underground stations, or a train either side of a wait.
 * The merged leg keeps the confidence (and runner-up) of the part that lasted longest, the earlier on a tie,
 * is unobserved only when every part was, and adds up the parts' known distances. A part the person set
 * makes the leg theirs: sure, set by you, with no runner-up.
 */
export function mergeSameModeLegs(legs: readonly TripLeg[]): TripLeg[] {
  const merged: TripLeg[] = [];
  let longestMs = 0;
  for (const leg of legs) {
    const previous = merged.at(-1);
    const legMs = Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt);
    if (!previous || previous.mode !== leg.mode) {
      merged.push({ ...leg });
      longestMs = legMs;
      continue;
    }
    const { runnerUp: _runnerUp, unobserved: _unobserved, setByYou: _setByYou, ...rest } = previous;
    const lead = legMs > longestMs ? leg : previous;
    const yours = previous.setByYou || leg.setByYou;
    const distances = [previous.distanceMeters, leg.distanceMeters].filter((value): value is number => value != null);
    merged[merged.length - 1] = {
      ...rest,
      stoppedAt: leg.stoppedAt,
      confidence: yours ? "sure" : lead.confidence,
      ...(yours ? { setByYou: true as const } : lead.runnerUp ? { runnerUp: lead.runnerUp } : {}),
      ...(previous.unobserved && leg.unobserved ? { unobserved: true as const } : {}),
      distanceMeters: distances.length ? distances.reduce((sum, value) => sum + value, 0) : null
    };
    longestMs = Math.max(longestMs, legMs);
  }
  return merged;
}

/**
 * Every journey with its legs, from its own readings and Core Motion over its final times: the trip
 * itself and the legs it replaced (`legs`, restored when protected history blocks the trip), so each
 * one replay can persist carries legs. Pass the run's motion timeline when it is already built.
 */
export function withTripLegs(
  commutes: readonly CommuteSegment[],
  evidenceWithMotion: readonly ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAt: string,
  timeline?: MotionTimeline | null,
  broadReadingTimes: readonly number[] = []
): CommuteSegment[] {
  if (!commutes.length) return [];
  const accepted = evidenceWithMotion.filter((item) => !isMotionEvidence(item.evidence));
  const motion = timeline !== undefined ? timeline
    : accepted.length === evidenceWithMotion.length ? null : buildMotionTimeline([...evidenceWithMotion], config, Date.parse(processingAt));
  const speedOf = credibleSpeedResolver(accepted, config);
  const byId = new Map(accepted.map((item) => [item.evidence.clientEvidenceId, item]));
  const annotate = (commute: CommuteSegment): CommuteSegment => {
    const tripLegs = deriveTripLegs({
      startMs: Date.parse(commute.startedAt), endMs: Date.parse(commute.stoppedAt), timeline: motion, speedOf, config, broadReadingTimes,
      readings: commute.evidenceIds.flatMap((id) => byId.get(id) ?? [])
        .sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt))
    });
    const { tripLegs: _previous, ...rest } = commute;
    return {
      ...rest,
      ...(tripLegs.length ? { tripLegs } : {}),
      ...(commute.legs ? { legs: commute.legs.map(annotate) } : {})
    };
  };
  return commutes.map(annotate);
}

/** The journey in progress with its legs so far, from its readings and Core Motion up to its latest observation. */
export function openTripWithLegs(
  trip: OpenTrip | null,
  evidenceWithMotion: readonly ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAt: string,
  timeline?: MotionTimeline | null,
  broadReadingTimes: readonly number[] = []
): OpenTrip | null {
  if (!trip) return null;
  const accepted = evidenceWithMotion.filter((item) => !isMotionEvidence(item.evidence));
  const motion = timeline !== undefined ? timeline
    : accepted.length === evidenceWithMotion.length ? null : buildMotionTimeline([...evidenceWithMotion], config, Date.parse(processingAt));
  const byId = new Map(accepted.map((item) => [item.evidence.clientEvidenceId, item]));
  const tripLegs = deriveTripLegs({
    startMs: Date.parse(trip.startedAt), endMs: Date.parse(trip.lastObservedAt), timeline: motion,
    speedOf: credibleSpeedResolver(accepted, config), config, broadReadingTimes,
    readings: trip.evidenceIds.flatMap((id) => byId.get(id) ?? [])
      .sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt))
  });
  const { tripLegs: _previous, ...rest } = trip;
  return tripLegs.length ? { ...rest, tripLegs } : rest;
}
