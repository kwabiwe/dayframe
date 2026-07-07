import { describe, expect, it } from "vitest";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  hasReviewNeededActivityForRange,
  hasSuggestedTimeWindow,
  isOpenReviewItem,
  isReviewNeededEntry,
  reviewItemDurationSeconds
} from "./review";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

describe("mobile review helpers", () => {
  it("classifies only needs_review entries as review-needed", () => {
    expect(isReviewNeededEntry({ reviewStatus: "needs_review" })).toBe(true);
    expect(isReviewNeededEntry({ reviewStatus: "confirmed" })).toBe(false);
    expect(isReviewNeededEntry({ reviewStatus: "accepted" })).toBe(false);
  });

  it("classifies only open review items as visible suggestions", () => {
    expect(isOpenReviewItem({ status: "open" })).toBe(true);
    expect(isOpenReviewItem({ status: "accepted" })).toBe(false);
    expect(isOpenReviewItem({ status: "ignored" })).toBe(false);
  });

  it("requires a valid suggested start and stop before building an editable draft", () => {
    const item = reviewItem({
      suggestedStartedAt: "2026-07-07T09:00:00.000Z",
      suggestedStoppedAt: "2026-07-07T10:30:00.000Z"
    });

    expect(hasSuggestedTimeWindow(item)).toBe(true);
    expect(reviewItemDurationSeconds(item, Date.now())).toBe(5400);
    expect(buildReviewItemDraftEntry(item, [category()], Date.now())).toEqual(
      expect.objectContaining({
        id: "review-1",
        categoryId: "cat-1",
        categoryName: "Workout",
        categoryColor: "teal",
        description: "Morning walk",
        reviewStatus: "needs_review",
        durationSeconds: 5400
      })
    );
  });

  it("does not build an editable draft for incomplete suggested time", () => {
    expect(buildReviewItemDraftEntry(reviewItem({ suggestedStoppedAt: null }), [category()], Date.now())).toBeNull();
  });

  it("detects review-needed activity inside a report range", () => {
    const rangeStart = new Date("2026-07-07T00:00:00.000Z");
    const rangeEnd = new Date("2026-07-08T00:00:00.000Z");

    expect(
      hasReviewNeededActivityForRange({
        entries: [
          timeEntry({
            reviewStatus: "needs_review",
            startedAt: "2026-07-07T12:00:00.000Z",
            stoppedAt: "2026-07-07T12:30:00.000Z"
          })
        ],
        now: Date.parse("2026-07-07T13:00:00.000Z"),
        rangeEnd,
        rangeStart,
        reviewItems: []
      })
    ).toBe(true);

    expect(
      hasReviewNeededActivityForRange({
        entries: [timeEntry({ reviewStatus: "confirmed" })],
        now: Date.parse("2026-07-07T13:00:00.000Z"),
        rangeEnd,
        rangeStart,
        reviewItems: [reviewItem()]
      })
    ).toBe(true);
  });

  it("keeps changed review UI wording category-first", () => {
    const copy = Object.values(REVIEW_COPY);

    expect(copy).toEqual(expect.arrayContaining([
      "Needs review",
      "Suggested activity",
      "Confirm",
      "Edit",
      "Dismiss"
    ]));
    expect(copy.join(" ")).not.toMatch(/\b(projects?|clients?|tags?)\b/i);
  });
});

function category(): MobileBootstrap["categories"][number] {
  return {
    id: "cat-1",
    name: "Workout",
    color: "teal",
    isPinned: true
  };
}

function reviewItem(overrides: Partial<MobileReviewItem> = {}): MobileReviewItem {
  return {
    id: "review-1",
    type: "suggestion",
    title: "Morning walk",
    eventSource: "health_workout",
    eventType: "health_workout_import",
    categoryName: "Workout",
    placeName: null,
    suggestedCategoryId: "cat-1",
    suggestedPlaceId: null,
    suggestedStartedAt: "2026-07-07T09:00:00.000Z",
    suggestedStoppedAt: "2026-07-07T10:00:00.000Z",
    confidence: "medium_high",
    status: "open",
    notes: null,
    createdAt: "2026-07-07T10:05:00.000Z",
    ...overrides
  };
}

function timeEntry(overrides: Partial<MobileTimeEntry> = {}): MobileTimeEntry {
  return {
    id: "entry-1",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "cat-1",
    categoryName: "Workout",
    categoryColor: "teal",
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Workout",
    startedAt: "2026-07-07T08:00:00.000Z",
    stoppedAt: "2026-07-07T08:30:00.000Z",
    durationSeconds: 1800,
    ...overrides
  };
}
