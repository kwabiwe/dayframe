import { randomUUID } from "node:crypto";
import { parseLocationSyncDiagnostics, type LocationSyncEndpoint, type LocationSyncStage } from "@dayframe/shared";
import { syncFailureMetadata } from "../sync-transaction";

export type LocationObservation = { onLocationStage?: (stage: LocationSyncStage) => void };
export function observeLocationStage(observation: LocationObservation, stage: LocationSyncStage) {
  try { observation.onLocationStage?.(stage); } catch { /* Observation cannot alter transaction outcome. */ }
}

/** One request-local completion, with no session, payload, SQL text or exception text. */
export function locationRequestDiagnostics(endpoint: LocationSyncEndpoint, startedAt: number) {
  const requestId = randomUUID();
  let locationStage: LocationSyncStage = "validation";
  let completed = false;
  return {
    onLocationStage(stage: LocationSyncStage) { locationStage = stage; },
    finish(response: Response, error?: unknown, failure?: Record<string, unknown>) {
      const durationMs = Math.max(0, Math.round(Date.now() - startedAt));
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
        try { console.info("location_sync", { outcome: authRejected ? "authentication_rejected" : response.ok ? "success" : "failed", ...details }); }
        catch { /* A committed operation must never become a retry because logging failed. */ }
      }
      return result;
    }
  };
}
