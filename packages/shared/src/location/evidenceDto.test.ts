import { describe, expect, it } from "vitest";
import { hasApproximateStayArrival, type LocationReviewEvidenceDto } from "./evidenceDto";

describe("Location Review arrival copy", () => {
  it("uses widened or unavailable stay bounds, never commute or exact bounds", () => {
    const evidence = {
      segment: {
        kind: "stay",
        startUncertainty: {
          lower: "2026-09-27T10:27:44.000Z",
          upper: "2026-09-27T10:51:38.000Z"
        }
      }
    } as LocationReviewEvidenceDto;
    expect(hasApproximateStayArrival(evidence)).toBe(true);
    expect(hasApproximateStayArrival({
      ...evidence,
      segment: { ...evidence.segment, startUncertainty: { ...evidence.segment.startUncertainty!, upper: null } }
    })).toBe(true);
    expect(hasApproximateStayArrival({
      ...evidence,
      segment: { ...evidence.segment, startUncertainty: {
        lower: evidence.segment.startUncertainty!.lower,
        upper: evidence.segment.startUncertainty!.lower
      } }
    })).toBe(false);
    expect(hasApproximateStayArrival({
      ...evidence,
      segment: { ...evidence.segment, kind: "commute" }
    })).toBe(false);
  });
});
