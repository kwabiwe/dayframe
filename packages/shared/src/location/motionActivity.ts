import type { LocationEngineConfig } from "./config";
import type {
  ClassifiedEvidence,
  LocationEvidence,
  MotionActivity,
  MotionConfidence,
  MotionTravelMode,
  StaySegment
} from "./types";

/**
 * Motion & Fitness (Core Motion) activity as journey evidence. Each
 * `motion_activity` item says which activity began at its time; it lasts until
 * the next one. Motion never places the device and never forms a stay: it only
 * times journeys between stays the location evidence already found, and shows
 * movement where GPS was silent. Only medium- and high-confidence activity
 * counts as moving or still; low confidence and `unknown` are indeterminate.
 */
export type MotionInterval = { fromMs: number; toMs: number; activity: MotionActivity; confidence: MotionConfidence };

export type MotionBlock = {
  startMs: number;
  endMs: number;
  movingMs: number;
  byMode: Partial<Record<MotionTravelMode, number>>;
  /** Core Motion reported stillness right before the block, with coverage before that. */
  onsetObserved: boolean;
  /** Core Motion reported stillness right after the block, covered long enough that movement did not resume. */
  stopObserved: boolean;
};

export type MotionTimeline = {
  intervals: MotionInterval[];
  coverageFromMs: number;
  /** The latest time Core Motion's history is known to cover: the last query (receipt) or transition. */
  coverageToMs: number;
  /** Blocks with at least `motionMinimumBlockMovingMs` of movement. */
  blocks: MotionBlock[];
};

const TRAVEL_MODES: readonly MotionTravelMode[] = ["automotive", "cycling", "running", "walking"];
const CONFIDENCE_ORDER: Record<MotionConfidence, number> = { high: 0, medium: 1, low: 2 };
const ACTIVITY_ORDER: Record<MotionActivity, number> = {
  automotive: 0, cycling: 1, running: 2, walking: 3, stationary: 4, unknown: 5
};

export function isMotionEvidence(evidence: Pick<LocationEvidence, "kind">) {
  return evidence.kind === "motion_activity";
}

function travelMode(interval: MotionInterval): MotionTravelMode | null {
  if (interval.confidence === "low") return null;
  return (TRAVEL_MODES as readonly string[]).includes(interval.activity) ? interval.activity as MotionTravelMode : null;
}

/** Builds the timeline from accepted evidence, ignoring everything but motion activity. */
export function buildMotionTimeline(
  evidence: readonly ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAtMs: number
): MotionTimeline | null {
  // A continuation only says the history was queried then: it extends coverage.
  let coveredToMs = Number.NEGATIVE_INFINITY;
  const transitions = evidence.flatMap(({ evidence: item }) => {
    if (!isMotionEvidence(item)) return [];
    const atMs = Date.parse(item.occurredAt);
    const activity = item.metadata?.motionActivity;
    const confidence = item.metadata?.motionConfidence;
    if (!activity || !confidence || !Number.isFinite(atMs) || atMs > processingAtMs) return [];
    const receivedAtMs = Date.parse(item.receivedAt);
    coveredToMs = Math.max(coveredToMs, atMs, Number.isFinite(receivedAtMs) ? receivedAtMs : atMs);
    if (item.metadata?.motionContinuation) return [];
    return [{ atMs, activity, confidence, id: item.clientEvidenceId }];
  }).sort((a, b) => a.atMs - b.atMs || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
    ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity] || a.id.localeCompare(b.id));
  // One activity per instant: the most confident wins, deterministically.
  const unique = transitions.filter((transition, index) => index === 0 || transition.atMs !== transitions[index - 1].atMs);
  if (!unique.length) return null;
  const coverageFromMs = unique[0].atMs;
  const coverageToMs = Math.min(processingAtMs, coveredToMs);
  const intervals: MotionInterval[] = unique.flatMap((transition, index) => {
    const toMs = index + 1 < unique.length ? unique[index + 1].atMs : coverageToMs;
    return toMs > transition.atMs
      ? [{ fromMs: transition.atMs, toMs, activity: transition.activity, confidence: transition.confidence }]
      : [];
  });
  const bridge = config.motionStillBridgeMs;
  type Run = Omit<MotionBlock, "onsetObserved" | "stopObserved">;
  // Runs of uninterrupted movement (walking straight into driving is one run).
  const runs: Run[] = [];
  for (const interval of intervals) {
    const mode = travelMode(interval);
    if (!mode) continue;
    const current = runs.at(-1);
    const duration = interval.toMs - interval.fromMs;
    if (current && interval.fromMs === current.endMs) {
      current.endMs = interval.toMs;
      current.movingMs += duration;
      current.byMode[mode] = (current.byMode[mode] ?? 0) + duration;
    } else {
      runs.push({ startMs: interval.fromMs, endMs: interval.toMs, movingMs: duration, byMode: { [mode]: duration } });
    }
  }
  // Brief stillness joins two substantial runs (waiting to cross, an unknown
  // spell mid-drive). A brief burst (crossing a room just before leaving) is
  // never joined to a journey: it would move the journey's start or end.
  const raw: Run[] = [];
  let previousRun: Run | null = null;
  for (const run of runs) {
    const current = raw.at(-1);
    if (current && previousRun && run.startMs - current.endMs <= bridge &&
      previousRun.movingMs >= config.motionMinimumBlockMovingMs && run.movingMs >= config.motionMinimumBlockMovingMs) {
      current.endMs = run.endMs;
      current.movingMs += run.movingMs;
      for (const [mode, ms] of Object.entries(run.byMode) as Array<[MotionTravelMode, number]>) {
        current.byMode[mode] = (current.byMode[mode] ?? 0) + ms;
      }
    } else {
      raw.push({ ...run, byMode: { ...run.byMode } });
    }
    previousRun = run;
  }
  const blocks = raw.filter((block) => block.movingMs >= config.motionMinimumBlockMovingMs).map((block) => {
    const before = intervals.find((interval) => interval.toMs === block.startMs);
    const after = intervals.find((interval) => interval.fromMs === block.endMs);
    return {
      ...block,
      onsetObserved: before?.activity === "stationary" && block.startMs - coverageFromMs > bridge,
      stopObserved: after?.activity === "stationary" && coverageToMs - block.endMs > bridge
    };
  });
  return { intervals, coverageFromMs, coverageToMs, blocks };
}

function overlapping(timeline: MotionTimeline, lowerMs: number, upperMs: number) {
  return timeline.blocks.filter((block) => block.startMs <= upperMs && block.endMs >= lowerMs);
}

/**
 * When the device left a place whose last observation is `lowerMs` and first
 * evidence away is `upperMs`: the start of the only moving block in that
 * window, if Core Motion saw it begin from stillness after `lowerMs`. Core
 * Motion can notice the departure a little after the first fix away, so blocks
 * up to `motionBoundaryToleranceMs` later are candidates too: a walk around the
 * place during a long silence is never mistaken for the departure.
 */
export function motionDepartureMs(timeline: MotionTimeline | null, lowerMs: number, upperMs: number, config: LocationEngineConfig) {
  if (!timeline || !(upperMs > lowerMs)) return null;
  const blocks = overlapping(timeline, lowerMs, upperMs + config.motionBoundaryToleranceMs);
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  return block.onsetObserved && block.startMs >= lowerMs && block.startMs <= upperMs ? block.startMs : null;
}

/**
 * When the device stopped after its last route observation `lowerMs` and
 * before the destination's first observation `upperMs`: the end of the only
 * moving block in that window, if Core Motion saw stillness follow it. Blocks
 * ending up to `motionBoundaryToleranceMs` before `lowerMs` are candidates
 * too, so a walk at the destination is never mistaken for the arrival.
 */
export function motionArrivalMs(timeline: MotionTimeline | null, lowerMs: number, upperMs: number, config: LocationEngineConfig) {
  if (!timeline || !(upperMs > lowerMs)) return null;
  const blocks = overlapping(timeline, lowerMs - config.motionBoundaryToleranceMs, upperMs);
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  return block.stopObserved && block.endMs >= lowerMs && block.endMs <= upperMs ? block.endMs : null;
}

/**
 * The observed start of the moving block in progress at `atMs`, when that
 * block began from stillness no earlier than `notBeforeMs` and no more than
 * `motionBoundaryToleranceMs` before `atMs`. A geofence exit fires some way
 * from the place, part-way through the departure it reports.
 */
export function motionDepartureBefore(timeline: MotionTimeline | null, atMs: number, notBeforeMs: number, config: LocationEngineConfig) {
  const block = timeline?.blocks.find((candidate) => candidate.startMs <= atMs && candidate.endMs >= atMs);
  return block?.onsetObserved && block.startMs >= notBeforeMs && block.startMs < atMs &&
    atMs - block.startMs <= config.motionBoundaryToleranceMs ? block.startMs : null;
}

/** The fastest mode a block was travelled in for at least `motionMinimumModeMs`, fastest first. */
export function blockFastestMode(block: MotionBlock, config: LocationEngineConfig): MotionTravelMode | null {
  return TRAVEL_MODES.find((mode) => (block.byMode[mode] ?? 0) >= config.motionMinimumModeMs) ?? null;
}

function maximumSpeedMps(mode: MotionTravelMode, config: LocationEngineConfig) {
  switch (mode) {
    case "walking": return config.motionMaximumWalkingSpeedMps;
    case "running": return config.motionMaximumRunningSpeedMps;
    case "cycling": return config.motionMaximumCyclingSpeedMps;
    case "automotive": return config.motionMaximumAutomotiveSpeedMps;
  }
}

/**
 * The single journey Core Motion saw between two stays: the only moving block
 * overlapping the window, beginning and ending in observed stillness no more
 * than `motionBoundaryToleranceMs` beyond it, whose fastest sustained mode
 * could cover the endpoints' separation in its time. Two or more blocks mean an unobserved
 * stop may lie between them, so none is returned.
 */
export function motionJourneyBlock(
  timeline: MotionTimeline | null,
  lowerMs: number,
  upperMs: number,
  straightLineMeters: number,
  config: LocationEngineConfig
) {
  if (!timeline || !(upperMs > lowerMs)) return null;
  const blocks = overlapping(timeline, lowerMs, upperMs);
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  if (!block.onsetObserved || !block.stopObserved || block.startMs < lowerMs - config.motionBoundaryToleranceMs ||
    block.endMs > upperMs + config.motionBoundaryToleranceMs) return null;
  const seconds = (block.endMs - block.startMs) / 1_000;
  const mode = blockFastestMode(block, config);
  return mode && straightLineMeters / seconds <= maximumSpeedMps(mode, config) ? { block, mode } : null;
}

/** The fastest mode sustained through a fair share of a journey's movement, when movement covers enough of it. */
export function motionTravelMode(timeline: MotionTimeline | null, startMs: number, stopMs: number, config: LocationEngineConfig) {
  if (!timeline || !(stopMs > startMs)) return null;
  const byMode = new Map<MotionTravelMode, number>();
  let moving = 0;
  for (const interval of timeline.intervals) {
    const mode = travelMode(interval);
    const overlap = Math.min(interval.toMs, stopMs) - Math.max(interval.fromMs, startMs);
    if (!mode || overlap <= 0) continue;
    moving += overlap;
    byMode.set(mode, (byMode.get(mode) ?? 0) + overlap);
  }
  if (moving < config.motionTravelModeMinimumCoverage * (stopMs - startMs)) return null;
  return TRAVEL_MODES.find((mode) => (byMode.get(mode) ?? 0) >= config.motionMinimumModeMs &&
    (byMode.get(mode) ?? 0) >= config.motionTravelModeMinimumShare * moving) ?? null;
}

/**
 * Ends stays when Core Motion saw the device start moving, within the stay's
 * existing departure bounds (last observation there to first evidence away).
 * Bounds never change, so automatic eligibility cannot; a stay is never
 * shortened below a dwell threshold it met, and stay IDs do not depend on times.
 */
export function refineStayDeparturesWithMotion(
  stays: StaySegment[],
  timeline: MotionTimeline | null,
  config: LocationEngineConfig
): StaySegment[] {
  if (!timeline) return stays;
  const thresholds = [config.savedPlaceMinimumDwellMs, config.unknownStayCandidateDwellMs, config.unknownStayReviewDwellMs];
  return stays.map((stay, index) => {
    if (!stay.stoppedAt || !stay.stopLowerBoundAt || !stay.stopUpperBoundAt) return stay;
    const departedMs = motionDepartureMs(timeline, Date.parse(stay.stopLowerBoundAt), Date.parse(stay.stopUpperBoundAt), config);
    const startedMs = Date.parse(stay.startedAt);
    const nextStartedMs = index + 1 < stays.length ? Date.parse(stays[index + 1].startedAt) : Number.POSITIVE_INFINITY;
    if (departedMs == null || departedMs <= startedMs || departedMs > nextStartedMs ||
      departedMs === Date.parse(stay.stoppedAt)) return stay;
    const before = Date.parse(stay.stoppedAt) - startedMs;
    const after = departedMs - startedMs;
    if (thresholds.some((threshold) => before >= threshold && after < threshold)) return stay;
    return { ...stay, stoppedAt: new Date(departedMs).toISOString() };
  });
}
