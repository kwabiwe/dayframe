import { describe, expect, it } from "vitest";
import { initialEvidenceDescription } from "./LocationReviewPanel";

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
