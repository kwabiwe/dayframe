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
  /** Core Motion reported confident stillness right before the block, with coverage before that. */
  onsetObserved: boolean;
  /** Core Motion reported confident stillness right after the block, covered long enough that movement did not resume. */
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
  // Movement interrupted only by indeterminate activity (iOS's brief unknown
  // spells, as between walking to the car and driving) is one run. Brief
  // confident stillness joins two substantial runs (waiting to cross); a brief
  // burst beside stillness (crossing a room just before leaving) is never
  // joined to a journey: it would move the journey's start or end.
  const stillBetween = (fromMs: number, toMs: number) => intervals.some((interval) =>
    interval.fromMs < toMs && interval.toMs > fromMs && interval.activity === "stationary" && interval.confidence !== "low");
  // Two passes, so the movement on each side of stillness is judged whole:
  // first join interruptions of indeterminate activity alone, then bridge
  // brief stillness between two substantial joined pieces.
  const join = (pieces: Run[], canJoin: (left: Run, right: Run) => boolean) => {
    const joined: Run[] = [];
    let previous: Run | null = null;
    for (const piece of pieces) {
      const current = joined.at(-1);
      if (current && previous && piece.startMs - current.endMs <= bridge && canJoin(previous, piece)) {
        current.endMs = piece.endMs;
        current.movingMs += piece.movingMs;
        for (const [mode, ms] of Object.entries(piece.byMode) as Array<[MotionTravelMode, number]>) {
          current.byMode[mode] = (current.byMode[mode] ?? 0) + ms;
        }
      } else {
        joined.push({ ...piece, byMode: { ...piece.byMode } });
      }
      previous = piece;
    }
    return joined;
  };
  const pieces = join(runs, (left, right) => !stillBetween(left.endMs, right.startMs));
  const raw = join(pieces, (left, right) =>
    left.movingMs >= config.motionMinimumBlockMovingMs && right.movingMs >= config.motionMinimumBlockMovingMs);
  // Only confident stillness observes a boundary. iOS reports brief `unknown`
  // spells around most changes of activity and every few minutes while still,
  // so a boundary is observed when the `motionStillWindowMs` beside it is fully
  // covered, holds no movement, and holds at least `motionMinimumStillMs` of
  // medium- or high-confidence stillness.
  const stillBeside = (boundaryMs: number, direction: -1 | 1) => {
    const [fromMs, toMs] = direction < 0
      ? [boundaryMs - config.motionStillWindowMs, boundaryMs] : [boundaryMs, boundaryMs + config.motionStillWindowMs];
    if (fromMs < coverageFromMs || toMs > coverageToMs) return false;
    let stillMs = 0;
    for (const interval of intervals) {
      const overlap = Math.min(interval.toMs, toMs) - Math.max(interval.fromMs, fromMs);
      if (overlap <= 0) continue;
      if (travelMode(interval)) return false;
      if (interval.activity === "stationary" && interval.confidence !== "low") stillMs += overlap;
    }
    return stillMs >= config.motionMinimumStillMs;
  };
  const blocks = raw.filter((block) => block.movingMs >= config.motionMinimumBlockMovingMs).map((block) => ({
    ...block,
    onsetObserved: stillBeside(block.startMs, -1),
    stopObserved: stillBeside(block.endMs, 1)
  }));
  return { intervals, coverageFromMs, coverageToMs, blocks };
}

/** Blocks with movement inside the window; one that only touches it does not count. */
function overlapping(timeline: MotionTimeline, lowerMs: number, upperMs: number) {
  return timeline.blocks.filter((block) => block.startMs < upperMs && block.endMs > lowerMs);
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
 * The stay's end from location evidence alone, before any motion refinement:
 * journeys between stays qualify on it, so motion never revokes them.
 */
export function locationOnlyStayEnd(stay: StaySegment) {
  return stay.locationOnlyStoppedAt ?? stay.stoppedAt ?? null;
}

/**
 * Ends stays when Core Motion saw the device start moving, within the stay's
 * existing departure bounds (last observation there to first evidence away)
 * and strictly before the first location evidence the stay does not own, so a
 * journey after it always keeps a positive window before its route. Bounds
 * never change, so automatic eligibility cannot; a stay never crosses a dwell
 * threshold (saved floor, candidate, Review) in either direction, and stay IDs
 * do not depend on times.
 */
export function refineStayDeparturesWithMotion(
  stays: StaySegment[],
  timeline: MotionTimeline | null,
  config: LocationEngineConfig,
  locationEvidence: readonly ClassifiedEvidence[] = []
): StaySegment[] {
  if (!timeline) return stays;
  const thresholds = [config.savedPlaceMinimumDwellMs, config.unknownStayCandidateDwellMs, config.unknownStayReviewDwellMs];
  const times = locationEvidence.map(({ evidence }) => Date.parse(evidence.occurredAt));
  return stays.map((stay, index) => {
    if (!stay.stoppedAt || !stay.stopLowerBoundAt || !stay.stopUpperBoundAt) return stay;
    const lowerMs = Date.parse(stay.stopLowerBoundAt);
    const departedMs = motionDepartureMs(timeline, lowerMs, Date.parse(stay.stopUpperBoundAt), config);
    const startedMs = Date.parse(stay.startedAt);
    const nextStartedMs = index + 1 < stays.length ? Date.parse(stays[index + 1].startedAt) : Number.POSITIVE_INFINITY;
    const own = new Set(stay.evidenceIds);
    const firstAwayMs = Math.min(nextStartedMs, ...locationEvidence.flatMap((item, at) =>
      times[at] > lowerMs && !own.has(item.evidence.clientEvidenceId) && item.evidence.kind !== "geofence_state" ? [times[at]] : []));
    if (departedMs == null || departedMs <= startedMs || departedMs >= firstAwayMs ||
      departedMs === Date.parse(stay.stoppedAt)) return stay;
    const before = Date.parse(stay.stoppedAt) - startedMs;
    const after = departedMs - startedMs;
    if (thresholds.some((threshold) => (before >= threshold) !== (after >= threshold))) return stay;
    return { ...stay, stoppedAt: new Date(departedMs).toISOString(), locationOnlyStoppedAt: stay.stoppedAt };
  });
}
