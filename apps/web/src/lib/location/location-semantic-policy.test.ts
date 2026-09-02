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
  startLowerBoundAt: "2026-07-21T18:00:00.000Z",
  startUpperBoundAt: "2026-07-21T18:00:00.000Z",
  stopLowerBoundAt: "2026-07-21T19:00:00.000Z",
  stopUpperBoundAt: "2026-07-21T19:00:00.000Z",
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
  startLowerBoundAt: "2026-07-21T19:00:00.000Z",
  startUpperBoundAt: "2026-07-21T19:00:00.000Z",
  stopLowerBoundAt: "2026-07-21T19:20:00.000Z",
  stopUpperBoundAt: "2026-07-21T19:20:00.000Z",
  fromStaySegmentId: "stay-a",
  toStaySegmentId: "stay-b",
  routeSampleCount: 3,
  gapDurationSeconds: 1_200,
  maximumObservationGapSeconds: 300,
  continuityStatus: "continuous",
  confidence: "medium_high",
  fromPlaceId: "00000000-0000-4000-8000-000000000300",
  toPlaceId: "00000000-0000-4000-8000-000000000400",
  qualificationReason: "significant_endpoint_displacement",
  evidenceIds: ["route-1", "route-2", "route-3"]
};

describe("locationSemanticDisposition", () => {
  it("keeps every segment review-first in v2_review", () => {
    expect(locationSemanticDisposition("v2_review", trustedStay)).toMatchObject({
      action: "review",
      reason: "review_mode"
    });
  });

  it("auto-confirms a strong completed stay at a saved place in v2_enabled", () => {
    expect(locationSemanticDisposition("v2_enabled", trustedStay)).toMatchObject({
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
    [{ ...trustedStay, continuityStatus: "manual" }, "uncertain_boundary"]
  ] as const)("keeps unsafe stays in Review", (segment, reason) => {
    expect(locationSemanticDisposition("v2_enabled", segment as StaySegment)).toMatchObject({
      action: "review",
      reason
    });
  });

  it("auto-confirms a route-backed medium-high commute between saved endpoints", () => {
    expect(locationSemanticDisposition("v2_enabled", commute)).toMatchObject({
      action: "auto_confirm",
      reason: "enabled_trusted_commute"
    });
  });

  it("allows an evidence-backed saved-place round trip", () => {
    expect(locationSemanticDisposition("v2_enabled", {
      ...commute,
      toPlaceId: commute.fromPlaceId,
      qualificationReason: "same_place_meaningful_round_trip"
    })).toMatchObject({
      action: "auto_confirm",
      reason: "enabled_trusted_commute"
    });
  });

  it.each([
    [{ ...commute, status: "closed" }, "segment_not_finalised"],
    [{ ...commute, fromPlaceId: null }, "untrusted_commute_endpoints"],
    [{ ...commute, confidence: "low" }, "insufficient_confidence"],
    [{ ...commute, continuityStatus: "manual" }, "uncertain_boundary"],
    [{ ...commute, routeSampleCount: 1 }, "insufficient_route_evidence"],
    [{ ...commute, qualificationReason: "endpoint_only_significant_distance" }, "insufficient_route_evidence"]
  ] as const)("keeps unsafe commutes in Review", (segment, reason) => {
    expect(locationSemanticDisposition("v2_enabled", segment as CommuteSegment)).toMatchObject({
      action: "review",
      reason
    });
  });
});
