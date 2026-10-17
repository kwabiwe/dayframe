import type { AutoMoveFallback } from "./location-auto-moves";
import { assessAutomaticLocation, type LocationAutomaticLoggingReason, type LocationSegment } from "@dayframe/shared";

/**
 * Why a stay at a place with "Log automatically" on (PRD D17) became a Review card instead of a block
 * (location v3 bug 8). Stored as the card's `semanticReason`; older apps word an unknown reason with
 * their generic location line.
 */
export type AutoLogFallbackReason =
  /** Below the trusted-stay checks: confidence, continuity or a start/end bound over five minutes. */
  | "auto_log_uncertain"
  /** Overlaps a block or a running timer. */
  | "auto_log_overlap"
  /** Another visit here in this time was logged automatically already (its block since edited or deleted). */
  | "auto_log_logged_before"
  /** Already offered in Review (this card, or an earlier one for this visit): decided once. */
  | "auto_log_offered_before";

/** Log automatically is off for this saved place. */
export const AUTO_LOG_OFF_REASON = "auto_log_off";

/** The stay matched more than one saved place, so none is suggested. */
export const AMBIGUOUS_PLACE_REASON = "ambiguous_place";

/** A policy rejection of a stay at a Log automatically place, as the reason its card shows. */
export function autoLogPolicyFallback(reason: LocationAutomaticLoggingReason): AutoLogFallbackReason | LocationAutomaticLoggingReason {
  // Evidence still arriving says so in its own words; everything else the trusted-stay checks reject
  // is "less certain than usual".
  return reason === "segment_not_finalised" ? reason : "auto_log_uncertain";
}

/**
 * The reason a production `v2_review` card stores, replacing the blanket "review_mode" (which every
 * client worded as "automatic location logging is not enabled", untrue for a place with Log
 * automatically on). Stays: the Log automatically fallback, else "Log automatically is off for this
 * place", else near more than one saved place, else the place isn't saved. Journeys: why the automatic journey rules would not log it,
 * else "review_mode" (journeys are not logged automatically in Review mode).
 */
export function reviewModeSemanticReason(
  segment: LocationSegment,
  trusted: { autoLog?: boolean | null } | null,
  fallback: AutoLogFallbackReason | LocationAutomaticLoggingReason | AutoMoveFallback | undefined
): string {
  if (fallback) return fallback;
  if (segment.kind === "stay") {
    if (trusted) return trusted.autoLog ? "review_mode" : AUTO_LOG_OFF_REASON;
    // Near more than one saved place is not a new place (Codex r1 on #450).
    return segment.placeMatchKind === "ambiguous" ? AMBIGUOUS_PLACE_REASON : "untrusted_place";
  }
  const automatic = assessAutomaticLocation("v2_enabled", segment);
  return automatic.action === "auto_confirm" ? "review_mode" : automatic.reason;
}
