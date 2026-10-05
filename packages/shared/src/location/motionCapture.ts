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
 * `lastRecordStartMs` is where the next query resumes; `last` is the activity
 * most recently recorded as evidence and whether a later query confirmed it.
 */
export type MotionCaptureCursor = {
  lastRecordStartMs: number | null;
  last: { atMs: number; activity: MotionActivity; confidence: MotionConfidence; confirmed: boolean } | null;
};

export const EMPTY_MOTION_CAPTURE_CURSOR: MotionCaptureCursor = { lastRecordStartMs: null, last: null };

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

/**
 * Turns the records one history query returned into evidence transitions: one
 * per change of activity or confidence, never before `floorMs` (capture
 * binding, seven-day history or a deletion) and never repeating records an
 * earlier query covered. Once per activity, the first query at least
 * `motionStillBridgeMs` after it began adds a continuation at the query time,
 * so the engine knows the history covered that long (a stop is confirmed only
 * by stillness that lasted). A continuation is coverage, not a transition:
 * iOS can file a record that began before the query only later.
 */
export function motionTransitionsFromRecords(
  records: readonly MotionRecord[],
  cursor: MotionCaptureCursor,
  queriedAtMs: number,
  floorMs: number,
  config: Pick<LocationEngineConfig, "motionStillBridgeMs">
): { transitions: MotionTransition[]; cursor: MotionCaptureCursor } {
  const transitions: MotionTransition[] = [];
  let { lastRecordStartMs, last } = cursor;
  const ordered = [...records].filter((record) => Number.isFinite(record.startMs) && record.startMs <= queriedAtMs)
    .sort((a, b) => a.startMs - b.startMs);
  for (const record of ordered) {
    if (lastRecordStartMs != null && record.startMs <= lastRecordStartMs) continue;
    lastRecordStartMs = record.startMs;
    // A record in progress at the floor began before it; its start is not ours to record.
    if (record.startMs < floorMs) continue;
    if (last && last.activity === record.activity && last.confidence === record.confidence) continue;
    transitions.push(record);
    last = { atMs: record.startMs, activity: record.activity, confidence: record.confidence, confirmed: false };
  }
  if (last && !last.confirmed && queriedAtMs - last.atMs > config.motionStillBridgeMs) {
    transitions.push({ startMs: queriedAtMs, activity: last.activity, confidence: last.confidence, continuation: true });
    last = { ...last, confirmed: true };
  }
  return { transitions, cursor: { lastRecordStartMs, last } };
}

/** Stable per device: the same transition delivered twice is one piece of evidence. */
export function motionEvidenceId(record: MotionTransition) {
  return `motion-${record.startMs}-${record.activity}-${record.confidence}${record.continuation ? "-continued" : ""}`;
}
