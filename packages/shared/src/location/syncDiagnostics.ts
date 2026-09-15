/** Coordinate-free observation only. Never spread an untrusted response into diagnostics. */
export const LOCATION_SYNC_PHASES = ["acquire", "begin", "configure", "receipt_read", "mutation_lock", "owner_lock", "canonical_read", "review_lock", "effect", "receipt_write", "commit", "rollback", "unknown"] as const;
export const LOCATION_SYNC_STAGES = ["validation", "evidence_cleanup", "summary_write", "bulk_evidence_write", "evidence_read", "catalogue_read", "engine", "segment_persistence", "lineage", "semantics"] as const;
const CODES = ["ok", "session_cookie_missing", "session_invalid", "session_expired", "session_revoked", "insufficient_scope", "integration_token_invalid", "location_processing_busy", "invalid_evidence_time", "invalid_semantic_mode_acknowledgement", "location_sync_failed", "partial_acknowledgement"] as const;
const REASONS = ["none", "authentication_required", "operation_timeout", "query_cancelled", "service_unavailable", "lock_unavailable", "transport_failure", "response_unavailable", "unknown"] as const;
export type LocationSyncEndpoint = "evidence" | "replay";
export type LocationSyncStage = typeof LOCATION_SYNC_STAGES[number];
export type LocationSyncDiagnostics = {
  endpoint: LocationSyncEndpoint;
  httpStatus: number | null;
  code: typeof CODES[number];
  reason: typeof REASONS[number];
  phase: typeof LOCATION_SYNC_PHASES[number];
  locationStage?: LocationSyncStage;
  sqlState?: string;
  requestId?: string;
  retryAfterMs?: number;
  /** Server time, distinct from clientElapsedMs on a completed attempt. */
  durationMs?: number;
};
function member<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}
export function boundedLocationDuration(value: unknown, cap = 86_400_000): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= cap ? value : undefined;
}
export function parseLocationSyncDiagnostics(input: unknown, endpoint: LocationSyncEndpoint, status: unknown): LocationSyncDiagnostics {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const result: LocationSyncDiagnostics = {
    endpoint,
    httpStatus: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    code: member(CODES, value.code) ?? "location_sync_failed",
    reason: member(REASONS, value.reason) ?? "unknown",
    phase: member(LOCATION_SYNC_PHASES, value.phase) ?? "unknown"
  };
  const stage = member(LOCATION_SYNC_STAGES, value.locationStage);
  // A last service stage does not describe acquisition, lock or commit failures.
  if (stage && (result.phase === "effect" || result.phase === "unknown")) result.locationStage = stage;
  if (typeof value.sqlState === "string" && /^[0-9A-Z]{5}$/.test(value.sqlState)) result.sqlState = value.sqlState;
  if (typeof value.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId)) result.requestId = value.requestId;
  const retry = boundedLocationDuration(value.retryAfterMs, 3_600_000);
  const duration = boundedLocationDuration(value.durationMs);
  if (retry !== undefined) result.retryAfterMs = retry;
  if (duration !== undefined) result.durationMs = duration;
  return result;
}
export type LocationSyncAttempt = {
  outcome: "success" | "failed" | "partial";
  attemptedAt: string;
  completedAt: string;
  clientElapsedMs: number;
  lastSuccessAt?: string;
  details: LocationSyncDiagnostics;
};
/** Revalidate persisted records before displaying or exporting them. */
export function parseLocationSyncAttempt(input: unknown, endpoint: LocationSyncEndpoint): LocationSyncAttempt | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  const iso = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x));
  if (!iso(v.attemptedAt) || !iso(v.completedAt) || Date.parse(v.completedAt) < Date.parse(v.attemptedAt)) return null;
  if (v.outcome !== "success" && v.outcome !== "failed" && v.outcome !== "partial") return null;
  const elapsed = boundedLocationDuration(v.clientElapsedMs);
  if (elapsed === undefined || !v.details || typeof v.details !== "object") return null;
  const details = v.details as Record<string, unknown>;
  if (details.endpoint !== endpoint) return null;
  return { ...(iso(v.lastSuccessAt) ? {lastSuccessAt:v.lastSuccessAt} : {}), outcome: v.outcome, attemptedAt: v.attemptedAt, completedAt: v.completedAt, clientElapsedMs: elapsed,
    details: parseLocationSyncDiagnostics(details, endpoint, details.httpStatus) };
}
