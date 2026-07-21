import { describe, expect, it } from "vitest";
import type { CommuteSegment, StaySegment } from "@dayframe/shared";
import { locationSemanticDisposition } from "./location-semantic-policy";

const trustedStay: StaySegment = {
  kind: "stay",
  clientSegmentId: "stay-saved",
  algorithmVersion: "location-v2.0",
  status: "finalised",
  startedAt: "2026-07-21T18:00:00.000Z",
  stoppedAt: "2026-07-21T19:00:00.000Z",
  placeId: "00000000-0000-4000-8000-000000000100",
  learnedPlaceId: null,
  placeMatchKind: "saved",
  candidatePlaceIds: [],
  sampleCount: 4,
  continuityStatus: "continuous",
  confidence: "medium_high",
  evidenceIds: ["evidence-1", "evidence-2"]
};

const commute: CommuteSegment = {
  kind: "commute",
  clientSegmentId: "commute-1",
  algorithmVersion: "location-v2.0",
  status: "finalised",
  startedAt: "2026-07-21T19:00:00.000Z",
  stoppedAt: "2026-07-21T19:20:00.000Z",
  fromStaySegmentId: "stay-a",
  toStaySegmentId: "stay-b",
  routeSampleCount: 3,
  gapDurationSeconds: 1_200,
  continuityStatus: "continuous",
  confidence: "medium_high",
  evidenceIds: ["route-1", "route-2", "route-3"]
};

describe("locationSemanticDisposition", () => {
  it("keeps every segment review-first in v2_review", () => {
    expect(locationSemanticDisposition("v2_review", trustedStay)).toEqual({
      action: "review",
      reason: "review_mode"
    });
  });

  it("auto-confirms a strong completed stay at a saved place in v2_enabled", () => {
    expect(locationSemanticDisposition("v2_enabled", trustedStay)).toEqual({
      action: "auto_confirm",
      reason: "enabled_trusted_stay"
    });
  });

  it("allows an accepted learned-place stay and a different-place boundary", () => {
    expect(locationSemanticDisposition("v2_enabled", {
      ...trustedStay,
      placeId: null,
      learnedPlaceId: "00000000-0000-4000-8000-000000000200",
      placeMatchKind: "learned",
      continuityStatus: "broken_by_other_place"
    })).toMatchObject({ action: "auto_confirm" });
  });

  it.each([
    [{ ...trustedStay, placeMatchKind: "unknown", placeId: null }, "untrusted_place"],
    [{ ...trustedStay, placeMatchKind: "ambiguous", placeId: null }, "untrusted_place"],
    [{ ...trustedStay, confidence: "medium" }, "insufficient_confidence"],
    [{ ...trustedStay, continuityStatus: "uncertain_gap" }, "uncertain_boundary"]
  ] as const)("keeps unsafe stays in Review", (segment, reason) => {
    expect(locationSemanticDisposition("v2_enabled", segment as StaySegment)).toEqual({
      action: "review",
      reason
    });
  });

  it("keeps commutes review-first even with strong endpoints", () => {
    expect(locationSemanticDisposition("v2_enabled", commute)).toEqual({
      action: "review",
      reason: "commute_review_first"
    });
  });
});
