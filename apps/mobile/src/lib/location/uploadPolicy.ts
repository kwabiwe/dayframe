export type LocationUploadDisposition = "success" | "shrink" | "reject" | "retry";

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
