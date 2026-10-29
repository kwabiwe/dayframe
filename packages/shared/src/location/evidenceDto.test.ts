import { describe, expect, it } from "vitest";
import { LocationReviewEvidenceDtoSchema, evidenceSheetCaption } from "./evidenceDto";

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

describe("the place and trip sheets' map line (owner feedback, 29 Oct 2026)", () => {
  const evidence = (evidenceCount: number, evidenceExpired = false) => ({ segment: { evidenceCount }, evidenceExpired }) as never;
  it("says at most how many readings, never the silences, and nothing for a saved place", () => {
    expect(evidenceSheetCaption(evidence(14), { knownPlace: false })).toBe("Based on 14 readings");
    expect(evidenceSheetCaption(evidence(1), { knownPlace: false })).toBe("Based on 1 reading");
    expect(evidenceSheetCaption(evidence(14), { knownPlace: true })).toBeNull();
    expect(evidenceSheetCaption(evidence(0), { knownPlace: false })).toBeNull();
    expect(evidenceSheetCaption(evidence(14, true), { knownPlace: false })).toBeNull();
    expect(evidenceSheetCaption(evidence(14), { knownPlace: false })).not.toMatch(/No readings|Stopped|\d:\d\d/);
  });
});
