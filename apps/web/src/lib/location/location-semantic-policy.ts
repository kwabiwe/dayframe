import type { LocationRolloutMode, LocationSegment } from "@dayframe/shared";

export type LocationSemanticDisposition = {
  action: "auto_confirm" | "review";
  reason:
    | "enabled_trusted_stay"
    | "review_mode"
    | "commute_review_first"
    | "untrusted_place"
    | "insufficient_confidence"
    | "uncertain_boundary";
};

const trustedContinuity = new Set([
  "continuous",
  "supported_by_visit",
  "broken_by_other_place"
]);

/**
 * V2 calls its strongest ordinary real-device result `medium_high`; `high` is
 * retained for forward-compatible evidence sources. Automatic writes remain
 * limited to completed, trusted-place stays with bounded continuity.
 */
export function locationSemanticDisposition(
  mode: LocationRolloutMode,
  segment: LocationSegment
): LocationSemanticDisposition {
  if (mode !== "v2_enabled") return { action: "review", reason: "review_mode" };
  if (segment.kind === "commute") return { action: "review", reason: "commute_review_first" };
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
