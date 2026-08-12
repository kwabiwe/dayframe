import type { LocationRolloutMode, LocationSegment } from "@dayframe/shared";

export type LocationSemanticDisposition = {
  action: "auto_confirm" | "review";
  reason:
    | "enabled_trusted_commute"
    | "enabled_trusted_stay"
    | "review_mode"
    | "segment_not_finalised"
    | "untrusted_commute_endpoints"
    | "insufficient_route_evidence"
    | "untrusted_place"
    | "insufficient_confidence"
    | "uncertain_boundary";
};

const trustedContinuity = new Set([
  "continuous",
  "supported_by_visit",
  "broken_by_other_place"
]);

const trustedCommuteQualifications = new Set([
  "significant_endpoint_displacement",
  "same_place_meaningful_round_trip"
]);

/**
 * V2 calls its strongest ordinary real-device result `medium_high`; `high` is
 * retained for forward-compatible evidence sources. Automatic writes remain
 * limited to finalised trusted-place stays and route-backed saved-endpoint
 * commutes with bounded continuity.
 */
export function locationSemanticDisposition(
  mode: LocationRolloutMode,
  segment: LocationSegment
): LocationSemanticDisposition {
  if (mode !== "v2_enabled") return { action: "review", reason: "review_mode" };
  if (segment.status !== "finalised") {
    return { action: "review", reason: "segment_not_finalised" };
  }
  if (segment.kind === "commute") {
    if (!segment.fromPlaceId || !segment.toPlaceId) {
      return { action: "review", reason: "untrusted_commute_endpoints" };
    }
    if (segment.confidence !== "medium_high" && segment.confidence !== "high") {
      return { action: "review", reason: "insufficient_confidence" };
    }
    if (segment.continuityStatus !== "continuous") {
      return { action: "review", reason: "uncertain_boundary" };
    }
    if (
      segment.routeSampleCount < 2 ||
      !segment.qualificationReason ||
      !trustedCommuteQualifications.has(segment.qualificationReason)
    ) {
      return { action: "review", reason: "insufficient_route_evidence" };
    }
    return { action: "auto_confirm", reason: "enabled_trusted_commute" };
  }
  if (segment.placeMatchKind !== "saved" && segment.placeMatchKind !== "learned") {
    return { action: "review", reason: "untrusted_place" };
  }
  if (segment.confidence !== "medium_high" && segment.confidence !== "high") {
    return { action: "review", reason: "insufficient_confidence" };
  }
  if (!trustedContinuity.has(segment.continuityStatus)) {
    return { action: "review", reason: "uncertain_boundary" };
  }
  return { action: "auto_confirm", reason: "enabled_trusted_stay" };
}
