import type { ReviewSyncDiagnostics } from "./reviewSyncStore";

export function reviewSyncStatusCopy(diagnostics: ReviewSyncDiagnostics) {
  if (diagnostics.needsAttentionCount > 0) {
    const issueCopy = `${diagnostics.needsAttentionCount} Review ${
      diagnostics.needsAttentionCount === 1 ? "change needs" : "changes need"
    } attention`;
    return diagnostics.waitingCount > 0
      ? `${issueCopy} · ${diagnostics.waitingCount} waiting to sync`
      : issueCopy;
  }
  if (diagnostics.authenticationRequiredCount > 0) {
    const count = diagnostics.authenticationRequiredCount;
    return `${count} ${
      count === 1 ? "change" : "changes"
    } saved on this iPhone · sign in to sync`;
  }
  // Pending and retryable Review work is durable background state. It should
  // not turn the Review screen into a sync console or invite retries that can
  // collide with the request already completing on the server.
  return null;
}
