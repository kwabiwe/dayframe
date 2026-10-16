import { describe, expect, it } from "vitest";
import type { CommuteSegment, StaySegment } from "@dayframe/shared";
import { autoLogPolicyFallback, reviewModeSemanticReason } from "./review-mode-reason";

const stay = { kind: "stay", status: "finalised" } as StaySegment;

describe("review-mode card reasons (location v3 bug 8)", () => {
  it("keeps a Log automatically fallback over everything else", () => {
    for (const reason of ["auto_log_uncertain", "auto_log_overlap", "auto_log_logged_before", "auto_log_offered_before"] as const) {
      expect(reviewModeSemanticReason(stay, { autoLog: true }, reason)).toBe(reason);
    }
  });

  it("says when the place's switch is off, when the stay is near several saved places, and when the place isn't saved", () => {
    expect(reviewModeSemanticReason(stay, { autoLog: false }, undefined)).toBe("auto_log_off");
    expect(reviewModeSemanticReason(stay, { autoLog: null }, undefined)).toBe("auto_log_off");
    expect(reviewModeSemanticReason(stay, null, undefined)).toBe("untrusted_place");
    expect(reviewModeSemanticReason({ ...stay, placeMatchKind: "ambiguous" }, null, undefined)).toBe("ambiguous_place");
    expect(reviewModeSemanticReason({ ...stay, placeMatchKind: "unknown" }, null, undefined)).toBe("untrusted_place");
  });

  it("words policy rejections of a Log automatically stay as less certain, except evidence still arriving", () => {
    for (const reason of ["insufficient_confidence", "uncertain_boundary", "boundary_uncertainty_exceeded",
      "boundary_bounds_missing", "boundary_bounds_invalid", "untrusted_place"] as const) {
      expect(autoLogPolicyFallback(reason)).toBe("auto_log_uncertain");
    }
    expect(autoLogPolicyFallback("segment_not_finalised")).toBe("segment_not_finalised");
  });

  it("gives a journey the automatic rule that would keep it in Review, else review_mode", () => {
    const shortTrip = {
      kind: "commute", status: "finalised", startedAt: "2026-07-20T08:00:00.000Z", stoppedAt: "2026-07-20T08:01:00.000Z",
      fromPlaceId: "a", toPlaceId: "b", confidence: "medium_high", routeSampleCount: 5
    } as CommuteSegment;
    expect(reviewModeSemanticReason(shortTrip, null, undefined)).toBe("short_journey_review_only");
    const timeAway = { ...shortTrip, qualificationReason: "same_place_outing" } as CommuteSegment;
    expect(reviewModeSemanticReason(timeAway, null, undefined)).toBe("time_away_review_only");
    const notFinal = { ...shortTrip, status: "candidate" } as CommuteSegment;
    expect(reviewModeSemanticReason(notFinal, null, undefined)).toBe("segment_not_finalised");
  });
});
