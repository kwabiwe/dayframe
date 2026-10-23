import type { LocationEngineConfig } from "./config";
import { distanceMeters } from "./geo";
import { credibleSpeedResolver } from "./commute";
import { buildMotionTimeline, isMotionEvidence, motionLegLabels, type MotionTimeline } from "./motionActivity";
import type { ClassifiedEvidence, CommuteSegment, MotionTravelMode, OpenTrip, TripLeg } from "./types";

/**
 * Legs of a trip, part 1 (location v4 §8, build step 6): walk, run, cycle and drive. Change points are
 * a Core Motion class change held for `tripLegMinimumMs` of observed time, a speed regime change in
 * credible readings, and stillness of `tripStopMinimumMs` or more (a change or a wait, which separates
 * legs of different modes and is never a leg). Indeterminate time joins the leg beside it but never
 * counts towards a hold. Legs shorter than `tripLegMinimumMs` merge into the longer moving neighbour
 * (across stops; the earlier on a tie), shortest first, unless they are walks of
 * `tripChangeWalkMinimumMs` or more between two vehicle legs. A stop between two legs of one mode joins
 * that leg. Deterministic and replayable; genuine location fixes and Core Motion only.
 */

type Label = MotionTravelMode | "still";
type SpeedClass = "still" | "foot" | "mid" | "vehicle";
type Slice = {
  fromMs: number;
  toMs: number;
  /** Null when nothing labels the slice (indeterminate). */
  label: Label | null;
  /** Core Motion's own report for the slice, never a carried label. */
  reported: Label | null;
};
/** A run of slices [first, last] with one label; `observedMs` leaves indeterminate slices out. */
type Run = { label: Label; first: number; last: number; observedMs: number; prev: Run | null; next: Run | null; alive: boolean };

const VEHICLE: ReadonlySet<Label> = new Set(["automotive", "cycling"]);
/** How long one reading's speed speaks for the time after it. */
const SPEED_HOLD_MS = 120_000;

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
  config
}: {
  startMs: number;
  endMs: number;
  timeline: MotionTimeline | null;
  /** The trip's own location readings, in time order. */
  readings: readonly ClassifiedEvidence[];
  /** A reading's speed when it is credible (native from any copy, else an accurate fix's implied speed), or null. */
  speedOf: (item: ClassifiedEvidence) => number | null;
  config: LocationEngineConfig;
}): TripLeg[] {
  if (!(endMs > startMs)) return [];
  const labels = timeline ? motionLegLabels(timeline).filter((item) => item.toMs > startMs && item.fromMs < endMs) : [];
  const timed = readings.map((item) => ({ item, atMs: Date.parse(item.evidence.occurredAt) }))
    .filter(({ atMs }) => atMs >= startMs && atMs <= endMs);
  const speeds = timed.flatMap(({ item, atMs }) => {
    const speed = speedOf(item);
    return speed != null && Number.isFinite(speed) && speed >= 0 ? [{ atMs, speed: speedClass(speed, config) }] : [];
  });
  // Elementary slices between every change of either input.
  const cuts = [...new Set([startMs, endMs, ...labels.flatMap((item) => [item.fromMs, item.toMs]),
    ...speeds.flatMap(({ atMs }) => [atMs, atMs + SPEED_HOLD_MS])])]
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
    slices.push({ fromMs, toMs, label: sliceLabel(motion?.label ?? null, speed), reported: motion && !motion.carried ? motion.label : null });
  }
  const sliceMs = (slice: Slice) => slice.toMs - slice.fromMs;

  // Runs of one label, linked in time order. Indeterminate slices join the run before them (the first
  // run takes any at the start) without adding to its observed time.
  let head: Run | null = null;
  let tail: Run | null = null;
  for (const [index, slice] of slices.entries()) {
    if (tail && (!slice.label || slice.label === tail.label)) {
      tail.last = index;
      if (slice.label) tail.observedMs += sliceMs(slice);
    } else if (slice.label) {
      const run: Run = { label: slice.label, first: tail ? index : 0, last: index, observedMs: sliceMs(slice), prev: tail, next: null, alive: true };
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
    if (neighbour) run = relabel(run, neighbour.label);
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
  // Every merge relabels a run to a different label, so this ends; the cap only guards against a mistake.
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
    const survivor = relabel(run, into.label);
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
  const fixes = timed.filter(({ item }) => genuineLegFix(item, config))
    .map(({ item, atMs }) => ({ atMs, point: { latitude: item.evidence.latitude!, longitude: item.evidence.longitude! } }));
  return moving.map((run, index) => {
    const mode = run.label as MotionTravelMode;
    // Stillness at the trip's ends belongs to the first or last leg, whose times are the trip's own.
    const fromMs = index === 0 ? startMs : slices[run.first].fromMs;
    const toMs = index === moving.length - 1 ? endMs : slices[run.last].toMs;
    let covered = 0;
    let agreeing = 0;
    for (let at = run.first; at <= run.last; at += 1) {
      covered += sliceMs(slices[at]);
      if (slices[at].reported === mode) agreeing += sliceMs(slices[at]);
    }
    const motionAgrees = agreeing > 0 && agreeing * 2 >= covered;
    const inLeg = speeds.filter(({ atMs }) => atMs >= fromMs && atMs < toMs);
    const speedAgrees = inLeg.length > 0 && inLeg.filter(({ speed }) => speedFits(mode, speed)).length * 2 >= inLeg.length;
    const points = fixes.filter(({ atMs }) => atMs >= fromMs && atMs <= toMs).map(({ point }) => point);
    const distance = points.length >= 2
      ? points.slice(1).reduce((sum, point, at) => sum + distanceMeters(points[at], point), 0) : null;
    return {
      startedAt: new Date(fromMs).toISOString(),
      stoppedAt: new Date(toMs).toISOString(),
      mode,
      confidence: motionAgrees && speedAgrees ? "sure" : motionAgrees || speedAgrees ? "likely" : "unsure",
      distanceMeters: distance == null ? null : Math.round(distance)
    } satisfies TripLeg;
  });
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
  timeline?: MotionTimeline | null
): CommuteSegment[] {
  if (!commutes.length) return [];
  const accepted = evidenceWithMotion.filter((item) => !isMotionEvidence(item.evidence));
  const motion = timeline !== undefined ? timeline
    : accepted.length === evidenceWithMotion.length ? null : buildMotionTimeline([...evidenceWithMotion], config, Date.parse(processingAt));
  const speedOf = credibleSpeedResolver(accepted, config);
  const byId = new Map(accepted.map((item) => [item.evidence.clientEvidenceId, item]));
  const annotate = (commute: CommuteSegment): CommuteSegment => {
    const tripLegs = deriveTripLegs({
      startMs: Date.parse(commute.startedAt), endMs: Date.parse(commute.stoppedAt), timeline: motion, speedOf, config,
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
  timeline?: MotionTimeline | null
): OpenTrip | null {
  if (!trip) return null;
  const accepted = evidenceWithMotion.filter((item) => !isMotionEvidence(item.evidence));
  const motion = timeline !== undefined ? timeline
    : accepted.length === evidenceWithMotion.length ? null : buildMotionTimeline([...evidenceWithMotion], config, Date.parse(processingAt));
  const byId = new Map(accepted.map((item) => [item.evidence.clientEvidenceId, item]));
  const tripLegs = deriveTripLegs({
    startMs: Date.parse(trip.startedAt), endMs: Date.parse(trip.lastObservedAt), timeline: motion,
    speedOf: credibleSpeedResolver(accepted, config), config,
    readings: trip.evidenceIds.flatMap((id) => byId.get(id) ?? [])
      .sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt))
  });
  const { tripLegs: _previous, ...rest } = trip;
  return tripLegs.length ? { ...rest, tripLegs } : rest;
}
