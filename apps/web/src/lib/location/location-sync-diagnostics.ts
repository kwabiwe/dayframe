import { randomUUID } from "node:crypto";
import { parseLocationSyncDiagnostics, type LocationSyncEndpoint, type LocationSyncStage } from "@dayframe/shared";
import { syncFailureMetadata, type SyncTimingEvent } from "../sync-transaction";

export type LocationTimingStage = SyncTimingEvent["stage"] |
  "request_setup" | "request_auth" | "request_body" | "owner_lock" | "evidence_read" | "catalogue_read" |
  "engine_computation" | "protected_replacement_checks" | "obsolete_segment_handling" |
  "stay_persistence" | "commute_persistence" | "lineage_deletion" | "lineage_insertion" |
  "semantic_review_persistence";
export type LocationTimingCount = "evidenceRows" | "staySegments" | "commuteSegments" |
  "lineageLinksPrepared" | "lineageChunksStarted" | "lineageChunksCompleted" | "protectedSegments";
export type LocationTimingEvent = {
  stage: LocationTimingStage;
  state: "started" | "completed";
  remainingMs?: number;
};
const LOCATION_TIMING_STAGES = new Set<LocationTimingStage>([
  "request_setup", "request_auth", "request_body", "connection_acquisition", "transaction_configuration", "owner_lock",
  "evidence_read", "catalogue_read", "engine_computation", "protected_replacement_checks",
  "obsolete_segment_handling", "stay_persistence", "commute_persistence", "lineage_deletion",
  "lineage_insertion", "semantic_review_persistence", "transaction_commit"
]);
const LOCATION_TIMING_COUNTS = new Set<LocationTimingCount>([
  "evidenceRows", "staySegments", "commuteSegments", "lineageLinksPrepared",
  "lineageChunksStarted", "lineageChunksCompleted", "protectedSegments"
]);
export type LocationObservation = {
  onLocationStage?: (stage: LocationSyncStage) => void;
  onLocationTiming?: (event: LocationTimingEvent) => void;
  onLocationCount?: (name: LocationTimingCount, value: number) => void;
  remainingOperationMs?: () => number;
};
export function observeLocationStage(observation: LocationObservation, stage: LocationSyncStage) {
  try { observation.onLocationStage?.(stage); } catch { /* Observation cannot alter transaction outcome. */ }
}
export function observeLocationTiming(
  observation: LocationObservation,
  stage: LocationTimingStage,
  state: LocationTimingEvent["state"]
) {
  try {
    observation.onLocationTiming?.({ stage, state, remainingMs: observation.remainingOperationMs?.() });
  } catch { /* Observation cannot alter transaction outcome. */ }
}
export function observeLocationCount(observation: LocationObservation, name: LocationTimingCount, value: number) {
  try { observation.onLocationCount?.(name, value); } catch { /* Observation cannot alter transaction outcome. */ }
}

/** One request-local completion, with no session, payload, SQL text or exception text. */
export function locationRequestDiagnostics(endpoint: LocationSyncEndpoint, startedAt: number) {
  const requestId = randomUUID();
  let locationStage: LocationSyncStage = "validation";
  let completed = false;
  const timings = new Map<LocationTimingStage, {
    startedAt: number;
    elapsedMs?: number;
    remainingMsAtStart?: number;
    remainingMsAfter?: number;
  }>();
  const counts = new Map<LocationTimingCount, number>();
  const now = () => {
    try { return Date.now(); } catch { return startedAt; }
  };
  const onLocationTiming = (event: LocationTimingEvent) => {
    if (completed || !LOCATION_TIMING_STAGES.has(event.stage)) return;
    const at = now();
    const current = timings.get(event.stage);
    if (event.state === "started") {
      if (!current) timings.set(event.stage, { startedAt: at, remainingMsAtStart: event.remainingMs });
      return;
    }
    if (!current || current.elapsedMs != null) return;
    current.elapsedMs = Math.max(0, Math.round(at - current.startedAt));
    current.remainingMsAfter = event.remainingMs;
  };
  return {
    onLocationStage(stage: LocationSyncStage) { locationStage = stage; },
    onLocationTiming,
    onSyncTiming(event: SyncTimingEvent) { onLocationTiming(event); },
    onLocationCount(name: LocationTimingCount, value: number) {
      if (!completed && LOCATION_TIMING_COUNTS.has(name) && Number.isFinite(value)) {
        counts.set(name, Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value))));
      }
    },
    finish(response: Response, error?: unknown, failure?: Record<string, unknown>) {
      const durationMs = Math.max(0, Math.round(now() - startedAt));
      const authRejected = response.status === 401 || response.status === 403;
      const details = parseLocationSyncDiagnostics({
        ...(error ? syncFailureMetadata(error) : {}), ...failure,
        ...(response.ok ? {code:"ok", reason:"none", phase:"commit"} : {}),
        ...(authRejected ? {code:(error as {code?:string})?.code ?? (response.status === 403 ? "insufficient_scope" : "session_invalid"), reason:"authentication_required", phase:"unknown"} : {}),
        requestId, durationMs, locationStage
      }, endpoint, response.status);
      response.headers.set("X-Dayframe-Request-Id", requestId);
      response.headers.set("X-Dayframe-Duration-Ms", String(durationMs));
      let result = response;
      if (!response.ok && failure) {
        result = new Response(JSON.stringify({ error: failure.error, ...details }), { status: response.status, headers: response.headers });
      }
      if (!completed) {
        completed = true;
        const finishedAt = now();
        const timing = {
          stages: Object.fromEntries([...timings].map(([stage, value]) => [stage, {
            elapsedMs: value.elapsedMs ?? Math.max(0, Math.round(finishedAt - value.startedAt)),
            completed: value.elapsedMs != null,
            ...(value.remainingMsAtStart == null ? {} : {
              remainingMsAtStart: Math.max(0, Math.round(value.remainingMsAtStart))
            }),
            ...(value.remainingMsAfter == null ? {} : {
              remainingMsAfter: Math.max(0, Math.round(value.remainingMsAfter))
            })
          }])),
          counts: Object.fromEntries(counts)
        };
        try {
          console.info("location_sync", JSON.stringify({
            outcome: authRejected ? "authentication_rejected" : response.ok ? "success" : "failed",
            ...details,
            timing
          }));
        }
        catch { /* A committed operation must never become a retry because logging failed. */ }
      }
      return result;
    }
  };
}
