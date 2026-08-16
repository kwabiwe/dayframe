import type { ReviewSyncDiagnostics } from "./reviewSyncStore";

export function shouldOfferReviewSyncRetry(diagnostics: ReviewSyncDiagnostics) {
  return diagnostics.retryWaitCount > 0;
}

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
  if (diagnostics.waitingCount > 0) {
    return `${diagnostics.waitingCount} Review ${
      diagnostics.waitingCount === 1 ? "change" : "changes"
    } waiting to sync`;
  }
  return null;
}
