import { describe, expect, it } from "vitest";
import { initialEvidenceDescription, typedMarker } from "./LocationReviewPanel";

const evidence = (kind: "stay" | "commute", title: string) => ({ segment: { kind }, display: { title } }) as never;

describe("Location evidence editor starting name (PRD D19, Codex r1 on #456)", () => {
  it("starts a Move and an unnamed stay empty, and a named stay with its place", () => {
    expect(initialEvidenceDescription(evidence("commute", "Trip"))).toBe("");
    expect(initialEvidenceDescription(evidence("commute", "Commute"))).toBe("");
    expect(initialEvidenceDescription(evidence("stay", "Unknown place"))).toBe("");
    expect(initialEvidenceDescription(evidence("stay", "Near saved places"))).toBe("");
    expect(initialEvidenceDescription(evidence("stay", "Peak Gym"))).toBe("Peak Gym");
  });
});

describe("typed-name marker (Codex r3 on #456)", () => {
  it("marks only a name the person changed", () => {
    expect(typedMarker("Trip", true)).toEqual({ descriptionTyped: true });
    expect(typedMarker("Peak Gym", false)).toEqual({});
    expect(typedMarker("  ", true)).toEqual({});
  });
});
