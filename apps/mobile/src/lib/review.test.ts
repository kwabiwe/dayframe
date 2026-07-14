import { describe, expect, it } from "vitest";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  countReviewNeededActivityForRange,
  hasReviewNeededActivityForRange,
  hasSuggestedTimeWindow,
  isCalendarPreviewReviewItem,
  isOneOffLocationReviewItem,
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

  it("limits calendar review previews to commute candidates", () => {
    expect(isCalendarPreviewReviewItem({ eventType: "commute_detected" })).toBe(true);
    expect(isCalendarPreviewReviewItem({ eventType: "learned_place_visit" })).toBe(false);
    expect(isCalendarPreviewReviewItem({ eventType: "health_workout_import" })).toBe(false);
  });

  it("labels significant single stays as one-off location activity evidence", () => {
    const item = reviewItem({
      eventSource: "location_learning",
      eventType: "unknown_stay",
      rawPayload: { evidenceKind: "one_off_activity" }
    });
    expect(isOneOffLocationReviewItem(item)).toBe(true);
    expect(buildReviewItemDraftEntry(item, [category()], Date.now())).toEqual(
      expect.objectContaining({ description: null })
    );
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
    const now = Date.parse("2026-07-09T08:14:00.000Z");
    const incompleteSleep = reviewItem({
      title: "Sleep asleep rem",
      eventSource: "health_sleep",
      eventType: "health_sleep_import",
      suggestedStartedAt: "2026-06-07T00:41:00.000Z",
      suggestedStoppedAt: null
    });

    expect(reviewItemDurationSeconds(incompleteSleep, now)).toBe(0);
    expect(buildReviewItemDraftEntry(incompleteSleep, [category()], now)).toBeNull();
  });

  it("defaults stale Health review drafts to the Health category", () => {
    expect(
      buildReviewItemDraftEntry(
        reviewItem({
          categoryName: null,
          suggestedCategoryId: null
        }),
        [{ id: "cat-health", name: "Health", color: "moss", isPinned: true }],
        Date.now()
      )
    ).toEqual(
      expect.objectContaining({
        categoryId: "cat-health",
        categoryName: "Health",
        categoryColor: "moss"
      })
    );
  });

  it("defaults stale sleep review drafts to the Sleep category", () => {
    expect(
      buildReviewItemDraftEntry(
        reviewItem({
          categoryName: null,
          eventSource: "health_sleep",
          eventType: "health_sleep_import",
          suggestedCategoryId: null,
          title: "Sleep"
        }),
        [
          { id: "cat-health", name: "Health", color: "moss", isPinned: true },
          { id: "cat-sleep", name: "Sleep", color: "lime", isPinned: true }
        ],
        Date.now()
      )
    ).toEqual(
      expect.objectContaining({
        categoryId: "cat-sleep",
        categoryName: "Sleep",
        categoryColor: "lime"
      })
    );
  });

  it("does not turn detected visit titles into draft descriptions", () => {
    expect(
      buildReviewItemDraftEntry(
        reviewItem({
          title: "Near New London Road",
          eventSource: "location_learning",
          eventType: "learned_place_visit"
        }),
        [category()],
        Date.now()
      )
    ).toEqual(
      expect.objectContaining({
        description: null
      })
    );
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
    expect(
      countReviewNeededActivityForRange({
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
        reviewItems: [reviewItem()]
      })
    ).toBe(2);
  });

  it("does not treat incomplete review suggestions as running across later ranges", () => {
    const june7 = {
      rangeStart: new Date("2026-06-07T00:00:00.000Z"),
      rangeEnd: new Date("2026-06-08T00:00:00.000Z")
    };
    const july9 = {
      rangeStart: new Date("2026-07-09T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-10T00:00:00.000Z")
    };
    const item = reviewItem({
      suggestedStartedAt: "2026-06-07T00:41:00.000Z",
      suggestedStoppedAt: null
    });
    const now = Date.parse("2026-07-09T08:14:00.000Z");

    expect(
      hasReviewNeededActivityForRange({
        entries: [],
        now,
        reviewItems: [item],
        ...june7
      })
    ).toBe(true);
    expect(
      hasReviewNeededActivityForRange({
        entries: [],
        now,
        reviewItems: [item],
        ...july9
      })
    ).toBe(false);
  });

  it("keeps changed review UI wording category-first", () => {
    const copy = Object.values(REVIEW_COPY);

    expect(copy).toEqual(expect.arrayContaining([
      "Needs review",
      "Suggested time entry",
      "Detected visit",
      "Confirm",
      "Edit",
      "Ignore"
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
    rawPayload: null,
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
