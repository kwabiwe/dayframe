import { describe, expect, it } from "vitest";
import {
  beginReviewDeckVisit,
  recordReviewDeckEvidenceDecision,
  reviewDeckDecisionForAction,
  takeReviewDeckEvidenceDecisions
} from "./reviewDeckDecisions";

describe("review deck evidence decisions", () => {
  it("classifies evidence actions as logged, skipped or neither", () => {
    expect(reviewDeckDecisionForAction("confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("save_place_and_confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("ignore_once_location")).toBe(false);
    expect(reviewDeckDecisionForAction("edit_and_confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("change_place_and_confirm")).toBe(true);
    expect(reviewDeckDecisionForAction("record_once")).toBe(true);
    expect(reviewDeckDecisionForAction("always_ignore_source")).toBe(false);
    expect(reviewDeckDecisionForAction("split")).toBeNull();
    expect(reviewDeckDecisionForAction("change_place")).toBeNull();
  });

  it("ignores decisions made while no deck is open", () => {
    recordReviewDeckEvidenceDecision("ribbon", "confirm");
    const end = beginReviewDeckVisit();
    expect(takeReviewDeckEvidenceDecisions()).toEqual([]);
    end();
  });

  it("hands decisions to the open deck once", () => {
    const end = beginReviewDeckVisit();
    recordReviewDeckEvidenceDecision("a", "confirm");
    recordReviewDeckEvidenceDecision("b", "merge");
    recordReviewDeckEvidenceDecision("c", "ignore_once");
    expect(takeReviewDeckEvidenceDecisions()).toEqual([
      { itemId: "a", logged: true },
      { itemId: "c", logged: false }
    ]);
    expect(takeReviewDeckEvidenceDecisions()).toEqual([]);
    end();
    recordReviewDeckEvidenceDecision("late", "confirm");
    expect(takeReviewDeckEvidenceDecisions()).toEqual([]);
  });
});
