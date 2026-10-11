import type { ReviewSyncDiagnostics } from "./reviewSyncStore";

export function reviewSyncStatusCopy(diagnostics: ReviewSyncDiagnostics) {
  if (diagnostics.needsAttentionCount > 0) {
    // Outcome words (UIA-023): what happened, not queue state.
    const issueCopy = `${diagnostics.needsAttentionCount} ${
      diagnostics.needsAttentionCount === 1 ? "change" : "changes"
    } didn't save`;
    // Changes that need a sign-in aren't sending on their own: they get their own words.
    const signIn = diagnostics.authenticationRequiredCount;
    const sending = Math.max(0, diagnostics.waitingCount - signIn);
    return [
      issueCopy,
      signIn > 0 ? `${signIn} need${signIn === 1 ? "s" : ""} you to sign in` : null,
      sending > 0 ? `${sending} still sending` : null
    ].filter(Boolean).join(" · ");
  }
  if (diagnostics.authenticationRequiredCount > 0) {
    const count = diagnostics.authenticationRequiredCount;
    return `${count} ${
      count === 1 ? "change" : "changes"
    } saved on this iPhone · sign in to send`;
  }
  // Pending and retryable Review work is durable background state. It should
  // not turn the Review screen into a sync console or invite retries that can
  // collide with the request already completing on the server.
  return null;
}
