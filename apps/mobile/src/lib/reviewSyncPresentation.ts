import type { ReviewSyncDiagnostics } from "./reviewSyncStore";

export function reviewSyncStatusCopy(diagnostics: ReviewSyncDiagnostics) {
  if (diagnostics.needsAttentionCount > 0) {
    // Plain words (UIA-023), and only what is known: an attention item may be a refusal or a
    // delivery whose outcome Dayframe couldn't confirm, so it "needs checking", never "didn't save".
    const issueCopy = `${diagnostics.needsAttentionCount} ${
      diagnostics.needsAttentionCount === 1 ? "change needs" : "changes need"
    } checking`;
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
