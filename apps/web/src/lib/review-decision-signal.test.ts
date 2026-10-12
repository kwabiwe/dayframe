import { describe, expect, it } from "vitest";
import {
  REVIEW_DECISION_PAYLOAD_KEY,
  REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY,
  isOwnerAuthoredReviewDescription,
  reviewSuggestedTitles,
  withoutServerReviewDecision
} from "./review-decision-signal";

describe("owner-authored Review description signal (E1)", () => {
  it("counts only non-empty text that differs from every Dayframe suggestion", () => {
    const suggested = ["Visit Example Clinic"];
    expect(isOwnerAuthoredReviewDescription("Lunch with friends", suggested)).toBe(true);
    // Accepted as is, or edited back to the suggestion (case, spacing, Unicode form).
    expect(isOwnerAuthoredReviewDescription("Visit Example Clinic", suggested)).toBe(false);
    expect(isOwnerAuthoredReviewDescription("  visit   EXAMPLE clinic ", suggested)).toBe(false);
    expect(isOwnerAuthoredReviewDescription("Visit Example Clinic".normalize("NFD"), suggested)).toBe(false);
    // No description at all (a journey confirmed without one).
    expect(isOwnerAuthoredReviewDescription(null, suggested)).toBe(false);
    expect(isOwnerAuthoredReviewDescription("   ", suggested)).toBe(false);
    // A merge compares with every title along the chain.
    expect(isOwnerAuthoredReviewDescription("Visit Sample Park", ["Visit Example Clinic", "Visit Sample Park"])).toBe(false);
    // The owner's own words are not filtered further, even when they name a place.
    expect(isOwnerAuthoredReviewDescription("Dentist at Example Clinic", suggested)).toBe(true);
  });

  it("uses the correction chain's suggested titles, else the item's own title", () => {
    expect(reviewSuggestedTitles(["Visit Example Clinic", "Visit Example Clinic", " ", 4], "Football practice"))
      .toEqual(["Visit Example Clinic"]);
    expect(reviewSuggestedTitles(undefined, "Visit Example Clinic")).toEqual(["Visit Example Clinic"]);
    expect(reviewSuggestedTitles([], "Visit Example Clinic")).toEqual(["Visit Example Clinic"]);
  });

  it("strips both server-only keys from client payloads and leaves others untouched", () => {
    const untouched = { durationMinutes: 45 };
    expect(withoutServerReviewDecision(untouched)).toBe(untouched);
    expect(withoutServerReviewDecision({
      durationMinutes: 45,
      [REVIEW_DECISION_PAYLOAD_KEY]: { ownerAuthoredDescription: true },
      [REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY]: ["Anything"]
    })).toEqual({ durationMinutes: 45 });
  });
});
