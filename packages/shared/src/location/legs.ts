import type { LocationEngineConfig } from "./config";
import { distanceMeters } from "./geo";
import { motionLegLabels, type MotionTimeline } from "./motionActivity";
import type { ClassifiedEvidence, MotionTravelMode, TripLeg } from "./types";

/**
 * Legs of a trip, part 1 (location v4 §8, build step 6): walk, run, cycle and drive. Change points are
 * a Core Motion class change held for `tripLegMinimumMs`, a speed regime change in credible readings,
 * and stillness of `tripStopMinimumMs` or more (a change or a wait, which separates legs and is never
 * a leg). Indeterminate time joins the leg beside it; legs shorter than `tripLegMinimumMs` merge into a
 * neighbour, unless they are walks of `tripChangeWalkMinimumMs` or more between two vehicle legs. A stop
 * between two legs of one mode joins that leg. Deterministic and replayable; location
 * evidence and Core Motion only.
 */

type Label = MotionTravelMode | "still";
type SpeedClass = "still" | "foot" | "mid" | "vehicle";
type Slice = { fromMs: number; toMs: number; label: Label | null; motion: Label | null; speed: SpeedClass | null };
type Run = { fromMs: number; toMs: number; label: Label; slices: Slice[] };

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
function speedFits(mode: MotionTravelMode, speed: SpeedClass) {
  switch (mode) {
    case "walking": case "running": return speed === "foot";
    case "cycling": return speed === "mid" || speed === "foot";
    case "automotive": return speed === "mid" || speed === "vehicle";
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
    const motion = labelIndex < labels.length && labels[labelIndex].fromMs <= midMs ? labels[labelIndex].label : null;
    while (speedIndex + 1 < speeds.length && speeds[speedIndex + 1].atMs <= midMs) speedIndex += 1;
    const speed = speedIndex >= 0 && midMs - speeds[speedIndex].atMs <= SPEED_HOLD_MS ? speeds[speedIndex].speed : null;
    slices.push({ fromMs, toMs, label: sliceLabel(motion, speed), motion, speed });
  }
  // Indeterminate time joins the labelled time before it (or, at the start, the first after it).
  const firstLabel = slices.find((slice) => slice.label)?.label;
  if (!firstLabel) return [];
  let previous: Label = firstLabel;
  let runs: Run[] = slices.map((slice) => {
    previous = slice.label ?? previous;
    return { fromMs: slice.fromMs, toMs: slice.toMs, label: previous, slices: [slice] };
  });
  const merge = (list: Run[]) => list.reduce<Run[]>((out, run) => {
    const last = out.at(-1);
    if (last && last.label === run.label) {
      last.toMs = run.toMs;
      last.slices.push(...run.slices);
    } else {
      out.push({ ...run, slices: [...run.slices] });
    }
    return out;
  }, []);
  const duration = (run: Run) => run.toMs - run.fromMs;
  // Brief stillness (waiting to cross, a light) is part of the leg around it.
  for (let changed = true; changed;) {
    changed = false;
    runs = merge(runs);
    const index = runs.findIndex((run) => run.label === "still" && duration(run) < config.tripStopMinimumMs &&
      runs.some((other) => other.label !== "still"));
    if (index >= 0) {
      runs[index].label = (runs[index - 1] ?? runs[index + 1]).label;
      changed = true;
    }
  }
  // Short moving runs join a neighbour: the longer moving one beside them. A walk between two vehicle
  // legs (a change of train, a walk to the bus) stays a leg.
  for (let changed = true; changed;) {
    changed = false;
    runs = merge(runs);
    const index = runs.findIndex((run, at) => {
      if (run.label === "still" || duration(run) >= config.tripLegMinimumMs) return false;
      const before = runs.slice(0, at).reverse().find((other) => other.label !== "still");
      const after = runs.slice(at + 1).find((other) => other.label !== "still");
      const isWalk = run.label === "walking" || run.label === "running";
      if (isWalk && duration(run) >= config.tripChangeWalkMinimumMs && before && after &&
        VEHICLE.has(before.label) && VEHICLE.has(after.label)) return false;
      return Boolean(runs[at - 1] && runs[at - 1].label !== "still" || runs[at + 1] && runs[at + 1].label !== "still");
    });
    if (index >= 0) {
      const before = runs[index - 1]?.label !== "still" ? runs[index - 1] : undefined;
      const after = runs[index + 1]?.label !== "still" ? runs[index + 1] : undefined;
      const into = before && after ? (duration(before) >= duration(after) ? before : after) : before ?? after!;
      runs[index].label = into.label;
      changed = true;
    }
  }
  runs = merge(runs);
  // A stop between two legs of one mode (a car at lights, a walk past a wait) does not change the leg:
  // the stillness joins it. Stillness only separates legs of different modes; at the trip's ends it
  // belongs to the first or last leg, whose times are the trip's own.
  runs = merge(runs.map((run, index) => run.label === "still" && runs[index - 1] && runs[index + 1] &&
    runs[index - 1].label === runs[index + 1].label ? { ...run, label: runs[index - 1].label } : run));
  const moving = runs.filter((run) => run.label !== "still");
  if (!moving.length) return [];
  moving[0].fromMs = startMs;
  moving.at(-1)!.toMs = endMs;
  return moving.map((run) => {
    const mode = run.label as MotionTravelMode;
    const covered = run.slices.reduce((sum, slice) => sum + (slice.toMs - slice.fromMs), 0);
    const motionAgrees = run.slices.reduce((sum, slice) => sum + (slice.motion === mode ? slice.toMs - slice.fromMs : 0), 0) >= covered / 2;
    const inLeg = speeds.filter(({ atMs }) => atMs >= run.fromMs && atMs < run.toMs);
    const speedAgrees = inLeg.length > 0 && inLeg.filter(({ speed }) => speedFits(mode, speed)).length * 2 >= inLeg.length;
    const points = timed.filter(({ atMs, item }) => atMs >= run.fromMs && atMs <= run.toMs && item.evidence.latitude != null &&
      item.evidence.longitude != null && item.evidence.horizontalAccuracyMeters != null &&
      item.evidence.horizontalAccuracyMeters <= config.highQualityHorizontalAccuracyMeters)
      .map(({ item }) => ({ latitude: item.evidence.latitude!, longitude: item.evidence.longitude! }));
    const distance = points.length >= 2
      ? points.slice(1).reduce((sum, point, index) => sum + distanceMeters(points[index], point), 0) : null;
    return {
      startedAt: new Date(run.fromMs).toISOString(),
      stoppedAt: new Date(run.toMs).toISOString(),
      mode,
      confidence: motionAgrees && speedAgrees ? "sure" : motionAgrees || speedAgrees ? "likely" : "unsure",
      distanceMeters: distance == null ? null : Math.round(distance)
    } satisfies TripLeg;
  });
}
