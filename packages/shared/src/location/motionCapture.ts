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
  /** The latest time recorded evidence says the history covers (a new record's or a continuation's). */
  coveredToMs?: number | null;
  /** Set after a truncated page: the next query resumes exactly here, with no lookback, until it catches up. */
  resumeFromMs?: number | null;
  last: { atMs: number; activity: MotionActivity; confidence: MotionConfidence; confirmed: boolean } | null;
};

export const EMPTY_MOTION_CAPTURE_CURSOR: MotionCaptureCursor = { lastRecordStartMs: null, last: null };

/**
 * Each query re-reads this much history before the latest record it saw, so a
 * record iOS files late is still recorded; evidence IDs make re-reads idempotent.
 */
export const MOTION_CAPTURE_LOOKBACK_MS = 15 * 60_000;

/**
 * Where the next history query starts: after a truncated page, exactly where
 * that page ended (paging forward always progresses; the boundary record is
 * read again and deduplicated by ID); otherwise the lookback before the latest
 * record seen. Never before the floor.
 */
export function motionQueryStartMs(cursor: MotionCaptureCursor, floorMs: number) {
  if (cursor.resumeFromMs != null) return Math.max(floorMs, cursor.resumeFromMs);
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
 * When a query brings no new record yet extends coverage more than
 * `motionStillBridgeMs` past the latest coverage already recorded, it adds a
 * continuation at `coveredToMs`, so the engine knows the history covered that
 * long (a stop is confirmed only by stillness that lasted). A continuation is
 * coverage, not a transition; re-read records keep their first delivery's
 * coverage in the journal, so they never advance it.
 */
export function motionTransitionsFromRecords(
  records: readonly MotionRecord[],
  cursor: MotionCaptureCursor,
  coveredToMs: number,
  floorMs: number,
  config: Pick<LocationEngineConfig, "motionStillBridgeMs">,
  truncated = false
): { transitions: MotionTransition[]; cursor: MotionCaptureCursor } {
  const ordered = records.filter((record) => Number.isFinite(record.startMs) && record.startMs <= coveredToMs)
    .sort((a, b) => a.startMs - b.startMs || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity])
    .filter((record, index, all) => index === 0 || record.startMs !== all[index - 1].startMs);
  const transitions: MotionTransition[] = ordered.filter((record) => record.startMs >= floorMs);
  const latest = ordered.at(-1);
  const fresh = transitions.some((record) => cursor.lastRecordStartMs == null || record.startMs > cursor.lastRecordStartMs);
  let last = cursor.last;
  if (latest && latest.startMs >= floorMs) {
    last = { atMs: latest.startMs, activity: latest.activity, confidence: latest.confidence, confirmed: false };
  }
  let recordedCoverageMs = fresh ? coveredToMs : cursor.coveredToMs ?? null;
  if (!fresh && last && coveredToMs - Math.max(recordedCoverageMs ?? -Infinity, last.atMs) > config.motionStillBridgeMs) {
    transitions.push({ startMs: coveredToMs, activity: last.activity, confidence: last.confidence, continuation: true });
    recordedCoverageMs = coveredToMs;
  }
  const lastRecordStartMs = latest && (cursor.lastRecordStartMs == null || latest.startMs > cursor.lastRecordStartMs)
    ? latest.startMs : cursor.lastRecordStartMs;
  return { transitions, cursor: { lastRecordStartMs, coveredToMs: recordedCoverageMs,
    resumeFromMs: truncated && latest ? latest.startMs : null, last } };
}

/** Stable per device: the same transition delivered twice is one piece of evidence. */
export function motionEvidenceId(record: MotionTransition) {
  return `motion-${record.startMs}-${record.activity}-${record.confidence}${record.continuation ? "-continued" : ""}`;
}
