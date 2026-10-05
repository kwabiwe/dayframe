import type { LocationEngineConfig } from "./config";
import type { MotionActivity, MotionConfidence } from "./types";

/** One Core Motion activity record: the activity that began at `startMs`, with its confidence. */
export type MotionRecord = { startMs: number; activity: MotionActivity; confidence: MotionConfidence };
/**
 * Evidence to record: a transition, or (`continuation`) a note that the last
 * transition's activity was still current when the history was queried at `startMs`.
 */
export type MotionTransition = MotionRecord & { continuation?: true };

/**
 * What the app remembers between Core Motion history queries, per capture owner.
 * `lastRecordStartMs` is the latest record seen; `last` is the activity run in
 * progress at the last query and whether a continuation has confirmed it.
 */
export type MotionCaptureCursor = {
  lastRecordStartMs: number | null;
  last: { atMs: number; activity: MotionActivity; confidence: MotionConfidence; confirmed: boolean } | null;
};

export const EMPTY_MOTION_CAPTURE_CURSOR: MotionCaptureCursor = { lastRecordStartMs: null, last: null };

/**
 * Each query re-reads this much history before the latest record it saw, so a
 * record iOS files late is still recorded; evidence IDs make re-reads idempotent.
 */
export const MOTION_CAPTURE_LOOKBACK_MS = 15 * 60_000;

/** Where the next history query starts: the lookback before the latest record seen, never before the floor. */
export function motionQueryStartMs(cursor: MotionCaptureCursor, floorMs: number) {
  return Math.max(floorMs, (cursor.lastRecordStartMs ?? floorMs) - MOTION_CAPTURE_LOOKBACK_MS);
}

/** Core Motion reports several flags at once; one activity describes the record. In a car at a light, it is driving. */
export function dominantMotionActivity(flags: {
  stationary?: boolean; walking?: boolean; running?: boolean; cycling?: boolean; automotive?: boolean; unknown?: boolean;
}): MotionActivity {
  if (flags.automotive) return "automotive";
  if (flags.cycling) return "cycling";
  if (flags.running) return "running";
  if (flags.walking) return "walking";
  if (flags.stationary) return "stationary";
  return "unknown";
}

const CONFIDENCE_ORDER: Record<MotionConfidence, number> = { high: 0, medium: 1, low: 2 };
const ACTIVITY_ORDER: Record<MotionActivity, number> = {
  automotive: 0, cycling: 1, running: 2, walking: 3, stationary: 4, unknown: 5
};

/**
 * Turns the records one history query returned (from `motionQueryStartMs`)
 * into evidence transitions: every record, never before `floorMs` (capture
 * binding, seven-day history or a deletion); a record in progress at the floor
 * is dropped, not clipped. Records are never compressed against their
 * neighbours: a record filed late can change which record wins an instant or
 * what precedes another, so only the complete set lets the engine see what a
 * single read of the whole history would. Re-reading the lookback repeats
 * records with the same IDs, so nothing doubles. Records sharing an instant
 * resolve as the engine does (most confident, then driving first).
 * Once per activity run, the first query more than `motionStillBridgeMs` after
 * it began adds a continuation at `coveredToMs`, so the engine knows the history
 * covered that long (a stop is confirmed only by stillness that lasted). A
 * continuation is coverage, not a transition.
 */
export function motionTransitionsFromRecords(
  records: readonly MotionRecord[],
  cursor: MotionCaptureCursor,
  coveredToMs: number,
  floorMs: number,
  config: Pick<LocationEngineConfig, "motionStillBridgeMs">
): { transitions: MotionTransition[]; cursor: MotionCaptureCursor } {
  const ordered = records.filter((record) => Number.isFinite(record.startMs) && record.startMs <= coveredToMs)
    .sort((a, b) => a.startMs - b.startMs || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity])
    .filter((record, index, all) => index === 0 || record.startMs !== all[index - 1].startMs);
  const transitions: MotionTransition[] = ordered.filter((record) => record.startMs >= floorMs);
  // The run in progress: where the trailing records' activity and confidence began.
  let runStartMs: number | null = null;
  ordered.forEach((record, index) => {
    const previous = ordered[index - 1];
    if (!previous || previous.activity !== record.activity || previous.confidence !== record.confidence) runStartMs = record.startMs;
  });
  const latest = ordered.at(-1);
  let last = cursor.last;
  if (latest && runStartMs != null && runStartMs >= floorMs) {
    const sameRun = last?.atMs === runStartMs && last.activity === latest.activity && last.confidence === latest.confidence;
    last = sameRun ? last : { atMs: runStartMs, activity: latest.activity, confidence: latest.confidence, confirmed: false };
  }
  if (last && !last.confirmed && coveredToMs - last.atMs > config.motionStillBridgeMs) {
    transitions.push({ startMs: coveredToMs, activity: last.activity, confidence: last.confidence, continuation: true });
    last = { ...last, confirmed: true };
  }
  const lastRecordStartMs = latest && (cursor.lastRecordStartMs == null || latest.startMs > cursor.lastRecordStartMs)
    ? latest.startMs : cursor.lastRecordStartMs;
  return { transitions, cursor: { lastRecordStartMs, last } };
}

/** Stable per device: the same transition delivered twice is one piece of evidence. */
export function motionEvidenceId(record: MotionTransition) {
  return `motion-${record.startMs}-${record.activity}-${record.confidence}${record.continuation ? "-continued" : ""}`;
}
