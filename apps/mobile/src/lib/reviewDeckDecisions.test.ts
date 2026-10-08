import { describe, expect, it } from "vitest";
import {
  recordReviewDeckEvidenceDecision,
  reviewDeckDecisionForAction,
  takeReviewDeckEvidenceDecisions
} from "./reviewDeckDecisions";

describe("review deck evidence decisions", () => {
  it("classifies evidence actions as logged, skipped or neither", () => {
    expect(reviewDeckDecisionForAction("confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("save_place_and_confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("ignore_once_location")).toBe(false);
    expect(reviewDeckDecisionForAction("split")).toBeNull();
    expect(reviewDeckDecisionForAction("change_place")).toBeNull();
  });

  it("hands decisions to the deck once", () => {
    recordReviewDeckEvidenceDecision("a", "confirm");
    recordReviewDeckEvidenceDecision("b", "merge");
    recordReviewDeckEvidenceDecision("c", "ignore_once");
    expect(takeReviewDeckEvidenceDecisions()).toEqual([
      { itemId: "a", logged: true },
      { itemId: "c", logged: false }
    ]);
    expect(takeReviewDeckEvidenceDecisions()).toEqual([]);
  });
});
