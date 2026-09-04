import { describe, expect, it } from "vitest";
import type { ReviewSyncDiagnostics } from "./reviewSyncStore";
import {
  reviewSyncStatusCopy
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
    reviewCacheHitCount: 0,
    reviewCacheMissCount: 0,
    lastReviewCacheAgeMs: null,
    evidenceCacheItemCount: 0,
    evidenceCacheBytes: 0,
    evidenceCacheHitCount: 0,
    evidenceCacheMissCount: 0,
    lastEvidenceCacheAgeMs: null,
    lastEvidencePayloadBytes: null,
    lastLocalMutationAction: null,
    lastLocalMutationCommitDurationMs: null,
    lastLocalMutationCommittedAt: null,
    ...overrides
  };
}

describe("Review sync presentation", () => {
  it("keeps pending and retryable work in the background", () => {
    const state = diagnostics({ pendingCount: 1, waitingCount: 1 });
    expect(reviewSyncStatusCopy(state)).toBeNull();
    expect(reviewSyncStatusCopy(diagnostics({ retryWaitCount: 1, waitingCount: 1 }))).toBeNull();
  });

  it("keeps authentication and permanent issues on their dedicated actions", () => {
    expect(reviewSyncStatusCopy(diagnostics({
      authenticationRequiredCount: 1,
      waitingCount: 1
    }))).toContain("sign in to sync");
    expect(reviewSyncStatusCopy(diagnostics({
      needsAttentionCount: 1
    }))).toContain("needs attention");
  });
});
