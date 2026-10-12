import { describe, expect, it } from "vitest";
import {
  REVIEW_DECISION_PAYLOAD_KEY,
  REVIEW_SUGGESTED_TITLES_PAYLOAD_KEY,
  foldReviewText,
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

  it("folds Unicode case, compatibility forms and spacing before comparing (Codex r4)", () => {
    const same = [
      ["Visit Weißensee", "VISIT WEISSENSEE"],
      ["Visit ẞtraße", "visit sstrasse"],
      ["Café".normalize("NFC"), "CAFÉ".normalize("NFD")],
      ["Ｖｉｓｉｔ　Ｅｘａｍｐｌｅ", "visit example"],
      ["ﬁeld", "FIELD"],
      ["İzmir", "izmir"],
      ["ızmir", "IZMIR"],
      ["  Visit\tSample   Park ", "visit sample park"]
    ];
    for (const [left, right] of same) expect(foldReviewText(left)).toBe(foldReviewText(right));
    expect(foldReviewText("Café")).not.toBe(foldReviewText("Cafe"));
    expect(isOwnerAuthoredReviewDescription("VISIT WEISSENSEE", ["Visit Weißensee"])).toBe(false);
  });

  it("compares with the full suggested-title history, never a correction part's own title", () => {
    // A Dayframe suggestion: every recorded title (replay retitles) plus the current one.
    expect(reviewSuggestedTitles(["Visit Example Clinic", " ", 4], "Visit New Clinic"))
      .toEqual(["Visit Example Clinic", "Visit New Clinic"]);
    expect(reviewSuggestedTitles(undefined, "Visit Example Clinic")).toEqual(["Visit Example Clinic"]);
    // A correction part: only the chain's history; its own title may be the owner's words.
    expect(reviewSuggestedTitles(["Visit Example Clinic", "Visit Example Clinic"], "Football practice", { correction: true }))
      .toEqual(["Visit Example Clinic"]);
    // Correction events from before the history existed fall back to the title.
    expect(reviewSuggestedTitles([], "Visit Example Clinic", { correction: true })).toEqual(["Visit Example Clinic"]);
    // A stale editor confirming the old prefilled title after a replay retitle is not the owner's.
    expect(isOwnerAuthoredReviewDescription(
      "Visit Example Clinic",
      reviewSuggestedTitles(["Visit Example Clinic", "Visit New Clinic"], "Visit New Clinic")
    )).toBe(false);
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
