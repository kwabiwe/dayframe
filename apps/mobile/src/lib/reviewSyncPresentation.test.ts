import { describe, expect, it } from "vitest";
import type { ReviewSyncDiagnostics } from "./reviewSyncStore";
import {
  reviewSyncStatusCopy,
  shouldOfferReviewSyncRetry
} from "./reviewSyncPresentation";

function diagnostics(
  overrides: Partial<ReviewSyncDiagnostics> = {}
): ReviewSyncDiagnostics {
  return {
    pendingCount: 0,
    retryWaitCount: 0,
    authenticationRequiredCount: 0,
    needsAttentionCount: 0,
    acknowledgedCount: 0,
    waitingCount: 0,
    oldestQueuedAt: null,
    lastSuccessfulSyncAt: null,
    nextRetryAt: null,
    lastError: null,
    lastCachedAt: null,
    ...overrides
  };
}

describe("Review sync presentation", () => {
  it("does not offer retry while a saved mutation is pending or in flight", () => {
    const state = diagnostics({ pendingCount: 1, waitingCount: 1 });

    expect(reviewSyncStatusCopy(state)).toBe("1 Review change waiting to sync");
    expect(shouldOfferReviewSyncRetry(state)).toBe(false);
  });

  it("offers retry only after a retryable failure enters backoff", () => {
    const state = diagnostics({ retryWaitCount: 1, waitingCount: 1 });

    expect(shouldOfferReviewSyncRetry(state)).toBe(true);
  });

  it("keeps authentication and permanent issues on their dedicated actions", () => {
    expect(shouldOfferReviewSyncRetry(diagnostics({
      authenticationRequiredCount: 1,
      waitingCount: 1
    }))).toBe(false);
    expect(shouldOfferReviewSyncRetry(diagnostics({
      needsAttentionCount: 1
    }))).toBe(false);
  });
});
