import { describe, expect, it } from "vitest";
import { LocationReviewEvidenceDtoSchema } from "./evidenceDto";

describe("Location Review arrival presentation contract", () => {
  it("defaults older cached DTOs without the explicit flag to existing copy", () => {
    const segment = LocationReviewEvidenceDtoSchema.shape.segment.parse({
      id: "stay-1",
      kind: "stay",
      status: "finalised",
      startedAt: "2026-09-27T10:28:03.000Z",
      stoppedAt: "2026-09-27T10:51:38.000Z",
      confidence: "medium",
      continuityStatus: "supported_by_visit",
      algorithmVersion: "location-v2.0",
      evidenceCount: 1,
      rejectedEvidenceCount: 0
    });
    expect(segment.approximateArrival).toBe(false);
  });
});
