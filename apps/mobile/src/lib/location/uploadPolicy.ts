export type LocationUploadDisposition = "success" | "shrink" | "reject" | "retry";

export const MAX_LOCATION_NATIVE_DRAIN_PASSES = 5;
export const MAX_LOCATION_UPLOAD_BATCHES_PER_SYNC = 5;
export const LOCATION_SERVER_REPLAY_INTERVAL_MS = 5 * 60 * 1000;

export function locationUploadDisposition(status: number): LocationUploadDisposition {
  if (status >= 200 && status < 300) return "success";
  if (status === 413) return "shrink";
  if (status === 400 || status === 422) return "reject";
  return "retry";
}

export function partitionAcknowledgedEvidence(allIds: string[], acknowledgedIds: string[]) {
  const acknowledged = new Set(acknowledgedIds);
  return {
    acknowledgedIds: allIds.filter((id) => acknowledged.has(id)),
    retryIds: allIds.filter((id) => !acknowledged.has(id))
  };
}

export function shouldRequestLocationReplay(input: {
  force: boolean;
  uploadedBatchCount: number;
  lastAttemptAt: string | null;
  now: number;
}) {
  if (input.force || input.uploadedBatchCount > 0 || !input.lastAttemptAt) return true;
  const lastAttempt = Date.parse(input.lastAttemptAt);
  return !Number.isFinite(lastAttempt) || input.now - lastAttempt >= LOCATION_SERVER_REPLAY_INTERVAL_MS;
}
