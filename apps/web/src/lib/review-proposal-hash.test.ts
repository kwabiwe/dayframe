import { describe, expect, it } from "vitest";
import { type EffectiveReviewProposal, reviewProposalHash } from "./review-proposal-hash";

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

const location: EffectiveReviewProposal = { ...proposal, sourceKind: "location_v2", locationSegmentId: "segment-1" };
it("keeps a Location confirmation valid when replay changes only semanticRevision", () => {
  expect(reviewProposalHash({...location, semanticRevision:"2026-09-12T08:32:00.000Z"})).toBe(reviewProposalHash(location));
});
it.each([
  ["reviewItemId","other-review"], ["eventId","other-event"], ["locationSegmentId","other-segment"],
  ["sourceKind","generic"], ["title","Changed title"], ["categoryId","other-category"], ["placeId","other-place"],
  ["startedAt","2026-09-12T08:01:00.000Z"], ["stoppedAt","2026-09-12T08:31:00.000Z"],
  ["confidence","high"], ["eventSource","other-source"], ["eventType","other-type"]
])("retains Location %s in the effective fingerprint", (field,value) => {
  expect(reviewProposalHash({...location,[field]:value})).not.toBe(reviewProposalHash(location));
});
it("preserves generic revision protection", () => {
  expect(reviewProposalHash({...proposal,semanticRevision:"2026-09-12T08:32:00.000Z"})).not.toBe(reviewProposalHash(proposal));
});

it("keeps the frozen pre-correction generic fingerprint byte-for-byte", () => {
  expect(reviewProposalHash(proposal)).toBe("62cb93c0b3c677829e6d1bff41360fd2bfa51f75af4dbadfe429391b821fbbfb");
});
