import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceSchema,
  dominantMotionActivity,
  motionEvidenceId,
  motionQueryStartMs,
  motionTransitionsFromRecords,
  type LocationEvidence
} from "@dayframe/shared";
import type { DayframeMotionActivityRecord } from "../../../modules/dayframe-motion-activity";
import {
  isLocationCaptureSnapshotCurrent,
  persistLocationEvidence,
  readMotionCaptureState,
  recordMotionCaptureFailure,
  type LocationAccountContext,
  type LocationCaptureSnapshot,
  type MotionCaptureState
} from "./store";

/** Core Motion keeps about a week of activity history. */
export const MOTION_HISTORY_MS = 7 * 86_400_000;

/**
 * Motion & Fitness records as Location evidence: one item per change of
 * activity or confidence, plus a continuation once an activity has lasted.
 * Never a position. `truncated` means the query returned its maximum, so the
 * history beyond the last record is not yet known.
 */
export function motionEvidenceFromRecords(
  records: readonly DayframeMotionActivityRecord[],
  state: MotionCaptureState,
  queriedAtMs: number,
  floorMs: number,
  context: Pick<LocationAccountContext, "deviceId" | "timeZone">,
  truncated = false
): { evidence: LocationEvidence[]; next: MotionCaptureState } {
  const mapped = records.flatMap((record) => Number.isFinite(record.startMs) &&
    (record.confidence === "low" || record.confidence === "medium" || record.confidence === "high")
    ? [{ startMs: record.startMs, activity: dominantMotionActivity(record), confidence: record.confidence }]
    : []);
  const coveredToMs = truncated && mapped.length ? Math.max(...mapped.map((record) => record.startMs)) : queriedAtMs;
  const { transitions, cursor } = motionTransitionsFromRecords(mapped, state.cursor, coveredToMs, floorMs, LOCATION_ENGINE_V2_CONFIG);
  // For motion, receipt is the time the history is known to cover: the engine
  // reads it as coverage, so a truncated page never claims more than it returned.
  const receivedAt = new Date(coveredToMs).toISOString();
  const evidence = transitions.flatMap((transition) => {
    const parsed = LocationEvidenceSchema.safeParse({
      clientEvidenceId: motionEvidenceId(transition), deviceId: context.deviceId,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind: "motion_activity",
      occurredAt: new Date(transition.startMs).toISOString(), endedAt: null, latitude: null, longitude: null,
      receivedAt, timeZone: context.timeZone,
      metadata: { motionActivity: transition.activity, motionConfidence: transition.confidence,
        ...(transition.continuation ? { motionContinuation: true } : {}) }
    });
    return parsed.success ? [parsed.data] : [];
  });
  return { evidence, next: { ...state, cursor } };
}

/**
 * Reads Core Motion's history since the owner's cursor and admits it through
 * the ordinary Location evidence path (binding, consent, retention, upload).
 * Call only inside the Location capture lane, after native signals are drained.
 */
export async function captureMotionActivityUnsafe(capture: LocationCaptureSnapshot) {
  if (!isLocationCaptureSnapshotCurrent(capture) || !capture.context || !capture.binding?.enabled) {
    return { status: "no_owner" as const, recordedCount: 0 };
  }
  const native = await import("../../../modules/dayframe-motion-activity");
  const status = native.getAuthorizationStatus();
  if (status !== "authorized") return { status, recordedCount: 0 };
  const state = await readMotionCaptureState(capture);
  if (!state || !isLocationCaptureSnapshotCurrent(capture)) return { status: "no_owner" as const, recordedCount: 0 };
  const nowMs = Date.now();
  const floorMs = Math.max(state.floorMs, nowMs - MOTION_HISTORY_MS);
  const fromMs = motionQueryStartMs(state.cursor, floorMs);
  if (!(fromMs < nowMs)) return { status, recordedCount: 0 };
  const records = await native.queryActivities(fromMs, nowMs, native.MAX_MOTION_RECORDS_PER_QUERY);
  if (!isLocationCaptureSnapshotCurrent(capture)) return { status: "no_owner" as const, recordedCount: 0 };
  const { evidence, next } = motionEvidenceFromRecords(records, state, nowMs, floorMs, capture.context,
    records.length >= native.MAX_MOTION_RECORDS_PER_QUERY);
  // Admission rejects the result if "Delete recent evidence" moved the floor while it was read.
  const result = await persistLocationEvidence(evidence, capture, { motionCapture: { next, readFloorMs: state.floorMs } });
  return { status, recordedCount: result.insertedCount };
}

/** Motion capture never fails a Location wake or sync: a failure is counted and retried next time. */
export async function captureMotionActivitySafelyUnsafe(capture: LocationCaptureSnapshot) {
  try {
    return await captureMotionActivityUnsafe(capture);
  } catch {
    await recordMotionCaptureFailure().catch(() => undefined);
    return { status: "failed" as const, recordedCount: 0 };
  }
}
