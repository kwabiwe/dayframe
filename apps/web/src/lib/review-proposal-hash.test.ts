import { describe, expect, it } from "vitest";
import { reviewProposalHash } from "./review-proposal-hash";

const proposal = {
  reviewItemId: "00000000-0000-4000-8000-000000000001",
  eventId: "00000000-0000-4000-8000-000000000002",
  locationSegmentId: null,
  sourceKind: "generic" as const,
  title: "Morning walk",
  categoryId: "00000000-0000-4000-8000-000000000003",
  placeId: null,
  startedAt: "2026-09-12T08:00:00.000Z",
  stoppedAt: "2026-09-12T08:30:00.000Z",
  confidence: "medium",
  eventSource: "healthkit",
  eventType: "workout",
  semanticRevision: "2026-09-12T08:31:00.000Z"
};

describe("reviewProposalHash", () => {
  it("is stable across equivalent Date serialisation", () => {
    expect(reviewProposalHash(proposal)).toBe(reviewProposalHash({
      ...proposal,
      startedAt: new Date(proposal.startedAt),
      stoppedAt: new Date(proposal.stoppedAt)
    }));
  });

  it("changes for a mutation-relevant proposal revision", () => {
    expect(reviewProposalHash(proposal)).not.toBe(reviewProposalHash({
      ...proposal,
      stoppedAt: "2026-09-12T08:31:00.000Z"
    }));
  });
});
