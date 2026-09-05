export type SyncLaneOutcome =
  | "complete"
  | "partial"
  | "backoff"
  | "server_busy"
  | "transport_failure"
  | "authentication_required"
  | "cancelled"
  | "needs_attention";
export type SyncLaneResult = {
  outcome: SyncLaneOutcome;
  remaining?: number | null;
  nextRetryAt?: string | null;
  reason?: string;
};
