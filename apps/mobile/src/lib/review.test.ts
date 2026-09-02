import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCATION_EVIDENCE_LOADING_FEEDBACK_DELAY_MS,
  REVIEW_COPY,
  CLOSED_REVIEW_MENU_STATE,
  buildReviewItemDraftEntry,
  canRunReviewMenuAction,
  countReviewNeededActivityForRange,
  hasReviewNeededActivityForRange,
  hasSuggestedTimeWindow,
  hideTombstonedReviewItems,
  isCalendarPreviewReviewItem,
  isCurrentReviewEditPresentation,
  isOneOffLocationReviewItem,
  isOpenReviewItem,
  isReviewNeededEntry,
  locationReviewReasonCopy,
  removeReviewItemOptimistically,
  reduceReviewMenuState,
  restoreReviewItemOptimistically,
  reviewActionOrder,
  reviewConfidencePresentation,
  reviewConfirmLabel,
  reviewItemCategoryLabel,
  reviewItemDurationSeconds,
  scheduleLocationEvidenceLoadingFeedback
} from "./review";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

describe("mobile review helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays cold evidence feedback without flashing it for warm hydration", async () => {
    vi.useFakeTimers();
    const warmFeedback = vi.fn();
    const cancelWarmFeedback = scheduleLocationEvidenceLoadingFeedback(warmFeedback);

    await vi.advanceTimersByTimeAsync(
      LOCATION_EVIDENCE_LOADING_FEEDBACK_DELAY_MS - 1
    );
    cancelWarmFeedback();
    await vi.advanceTimersByTimeAsync(1);
    expect(warmFeedback).not.toHaveBeenCalled();

    const coldFeedback = vi.fn();
    const cancelColdFeedback = scheduleLocationEvidenceLoadingFeedback(coldFeedback);
    await vi.advanceTimersByTimeAsync(
      LOCATION_EVIDENCE_LOADING_FEEDBACK_DELAY_MS
    );
    expect(coldFeedback).toHaveBeenCalledOnce();
    cancelColdFeedback();
  });

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

  it("defaults a legacy no-category commute draft to the existing Commute category", () => {
    expect(
      buildReviewItemDraftEntry(
        reviewItem({
          categoryName: null,
          eventSource: "location_learning",
          eventType: "commute_detected",
          suggestedCategoryId: null,
          title: "Possible journey"
        }),
        [{ id: "cat-commute", name: "cOmMuTe", color: "sky", isPinned: false }],
        Date.now()
      )
    ).toEqual(
      expect.objectContaining({
        categoryId: "cat-commute",
        categoryName: "cOmMuTe",
        categoryColor: "sky",
        description: null
      })
    );
  });

  it("does not overwrite an explicit non-Commute category in a commute draft", () => {
    expect(
      buildReviewItemDraftEntry(
        reviewItem({
          categoryName: "Travel",
          eventSource: "location_learning",
          eventType: "commute_detected",
          suggestedCategoryId: null
        }),
        [
          { id: "cat-commute", name: "Commute", color: "sky", isPinned: false },
          { id: "cat-travel", name: "travel", color: "teal", isPinned: false }
        ],
        Date.now()
      )
    ).toEqual(
      expect.objectContaining({
        categoryId: "cat-travel",
        categoryName: "Travel",
        categoryColor: "teal"
      })
    );
  });

  it("uses semantic category and confirmation labels", () => {
    const commute = reviewItem({
      categoryName: null,
      eventSource: "location_learning",
      eventType: "commute_detected"
    });
    const visit = reviewItem({
      eventSource: "location_learning",
      eventType: "unknown_stay"
    });

    expect(reviewItemCategoryLabel(commute)).toBe("Commute");
    expect(reviewConfirmLabel(commute)).toBe("Confirm commute");
    expect(reviewConfirmLabel(visit)).toBe("Confirm visit");
    expect(reviewConfirmLabel(reviewItem())).toBe("Confirm activity");
  });

  it("maps confidence to an accessible five-step indicator", () => {
    expect(reviewConfidencePresentation("high")).toEqual({ label: "High", score: 5 });
    expect(reviewConfidencePresentation("medium_high")).toEqual({
      label: "Medium high",
      score: 4
    });
    expect(reviewConfidencePresentation("medium")).toEqual({ label: "Medium", score: 3 });
    expect(reviewConfidencePresentation("low")).toEqual({ label: "Low", score: 2 });
    expect(reviewConfidencePresentation("hint")).toEqual({ label: "Hint", score: 1 });
    expect(reviewConfidencePresentation("unexpected")).toEqual({
      label: "Unknown",
      score: 1
    });
  });

  it("explains why location suggestions still need Review", () => {
    const commute = reviewItem({
      eventSource: "location_learning",
      eventType: "commute_detected",
      rawPayload: { semanticReason: "existing_review_preserved" }
    });

    expect(locationReviewReasonCopy(commute)).toBe(
      "Already awaiting your decision before automatic logging was enabled"
    );
    expect(locationReviewReasonCopy(commute, 1)).toBe(
      "Already awaiting your decision before automatic logging was enabled"
    );
    expect(locationReviewReasonCopy({
      ...commute,
      rawPayload: { semanticReason: "insufficient_route_evidence" }
    })).toBe("Needs review · route evidence is limited");
    expect(locationReviewReasonCopy({
      ...commute,
      rawPayload: { semanticReason: "untrusted_commute_endpoints" }
    })).toBe("Needs review · start or end place isn’t saved");
  });

  it("orders evidence, confirm and overflow without peer edit/dismiss actions", () => {
    const commute = reviewItem({
      eventSource: "location_learning",
      eventType: "commute_detected",
      rawPayload: {
        algorithmVersion: "location-v2.0",
        clientSegmentId: "segment-1"
      }
    });

    expect(reviewActionOrder(commute)).toEqual(["view_evidence", "confirm", "overflow"]);
    expect(reviewActionOrder(reviewItem())).toEqual(["confirm", "overflow"]);
  });

  it("keeps one menu active, blocks disabled and duplicate actions, and closes stale state", () => {
    const firstOpen = reduceReviewMenuState(CLOSED_REVIEW_MENU_STATE, {
      type: "toggle",
      itemId: "review-1",
      disabled: false
    });
    expect(firstOpen.openItemId).toBe("review-1");
    expect(
      reduceReviewMenuState(firstOpen, {
        type: "toggle",
        itemId: "review-2",
        disabled: false
      })
    ).toBe(firstOpen);
    expect(
      reduceReviewMenuState(firstOpen, {
        type: "toggle",
        itemId: "review-2",
        disabled: true
      })
    ).toBe(firstOpen);

    const resolving = reduceReviewMenuState(firstOpen, {
      type: "begin_action",
      action: "edit",
      itemId: "review-1",
      token: 1
    });
    expect(resolving).toEqual({
      openItemId: null,
      closingItemId: "review-1",
      pendingAction: {
        action: "edit",
        itemId: "review-1",
        token: 1
      }
    });
    expect(canRunReviewMenuAction(resolving, "review-1")).toBe(false);
    expect(
      reduceReviewMenuState(resolving, {
        type: "begin_action",
        action: "dismiss",
        itemId: "review-1",
        token: 2
      })
    ).toBe(resolving);
    expect(
      reduceReviewMenuState(resolving, {
        type: "toggle",
        itemId: "review-2",
        disabled: false
      })
    ).toBe(resolving);

    const modalClosed = reduceReviewMenuState(resolving, {
      type: "menu_closed",
      itemId: "review-1"
    });
    expect(modalClosed.closingItemId).toBeNull();
    expect(modalClosed.pendingAction).toEqual(resolving.pendingAction);
    expect(
      reduceReviewMenuState(modalClosed, {
        type: "finish_action",
        itemId: "review-1",
        token: 2
      })
    ).toBe(modalClosed);
    expect(
      reduceReviewMenuState(modalClosed, {
        type: "finish_action",
        itemId: "review-1",
        token: 1
      }).pendingAction
    ).toBeNull();
    expect(
      reduceReviewMenuState(resolving, {
        type: "reconcile",
        openItemIds: ["review-2"]
      }).pendingAction
    ).toBeNull();
    expect(
      reduceReviewMenuState(resolving, { type: "reset" })
    ).toEqual({
      openItemId: null,
      closingItemId: "review-1",
      pendingAction: null
    });
  });

  it("closes before replacement and keeps a closing modal owned until completion", () => {
    const firstOpen = reduceReviewMenuState(CLOSED_REVIEW_MENU_STATE, {
      type: "toggle",
      itemId: "review-1",
      disabled: false
    });
    const closing = reduceReviewMenuState(firstOpen, { type: "close" });
    expect(closing).toEqual({
      openItemId: null,
      closingItemId: "review-1",
      pendingAction: null
    });
    expect(
      reduceReviewMenuState(closing, {
        type: "toggle",
        itemId: "review-2",
        disabled: false
      })
    ).toBe(closing);
    const closed = reduceReviewMenuState(closing, {
      type: "menu_closed",
      itemId: "review-1"
    });
    expect(
      reduceReviewMenuState(closed, {
        type: "toggle",
        itemId: "review-2",
        disabled: false
      }).openItemId
    ).toBe("review-2");
  });

  it("removes, tombstones and restores Review items at their captured position", () => {
    const first = reviewItem({ id: "review-1" });
    const second = reviewItem({ id: "review-2" });
    const third = reviewItem({ id: "review-3" });
    const fourth = reviewItem({ id: "review-4" });
    const original = bootstrap([first, second, third]);
    const optimistic = removeReviewItemOptimistically(original, second.id);

    expect(optimistic?.data.reviewItems.map((item) => item.id)).toEqual([
      "review-1",
      "review-3"
    ]);
    expect(
      hideTombstonedReviewItems(original, ["review-2"]).reviewItems.map(
        (item) => item.id
      )
    ).toEqual(["review-1", "review-3"]);

    const newerState = bootstrap([first, third, fourth]);
    expect(
      restoreReviewItemOptimistically(
        newerState,
        optimistic!.removal
      ).reviewItems.map((item) => item.id)
    ).toEqual(["review-1", "review-2", "review-3", "review-4"]);
    expect(
      restoreReviewItemOptimistically(
        original,
        optimistic!.removal
      )
    ).toBe(original);
  });

  it("restores concurrent removals in original order regardless of failure order", () => {
    const first = reviewItem({ id: "review-1" });
    const second = reviewItem({ id: "review-2" });
    const third = reviewItem({ id: "review-3" });
    const fourth = reviewItem({ id: "review-4" });
    const original = bootstrap([first, second, third, fourth]);
    const firstRemoval = removeReviewItemOptimistically(original, second.id)!;
    const secondRemoval = removeReviewItemOptimistically(
      firstRemoval.data,
      third.id
    )!;

    const firstFailureFirst = restoreReviewItemOptimistically(
      restoreReviewItemOptimistically(
        secondRemoval.data,
        firstRemoval.removal
      ),
      secondRemoval.removal
    );
    const secondFailureFirst = restoreReviewItemOptimistically(
      restoreReviewItemOptimistically(
        secondRemoval.data,
        secondRemoval.removal
      ),
      firstRemoval.removal
    );

    expect(firstFailureFirst.reviewItems.map((item) => item.id)).toEqual([
      "review-1",
      "review-2",
      "review-3",
      "review-4"
    ]);
    expect(secondFailureFirst.reviewItems.map((item) => item.id)).toEqual([
      "review-1",
      "review-2",
      "review-3",
      "review-4"
    ]);
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
      "Edit details",
      "Dismiss suggestion"
    ]));
    expect(copy.join(" ")).not.toMatch(/\b(projects?|clients?|tags?)\b/i);
  });

  it("rejects a stale Review edit-presentation callback after rapid open/cancel/reopen", () => {
    // Simulates review.tsx's monotonic editPresentationSequence: begin(1), begin(2)
    // (a rapid cancel-then-reopen), then a delayed onPresented/onCancel callback
    // for presentation 1 arrives after presentation 2 is already current.
    let currentPresentationId: number | null = null;

    currentPresentationId = 1;
    expect(isCurrentReviewEditPresentation(currentPresentationId, 1)).toBe(true);

    currentPresentationId = 2;
    expect(isCurrentReviewEditPresentation(currentPresentationId, 1)).toBe(false);
    expect(isCurrentReviewEditPresentation(currentPresentationId, 2)).toBe(true);

    currentPresentationId = null;
    expect(isCurrentReviewEditPresentation(currentPresentationId, 2)).toBe(false);
    expect(isCurrentReviewEditPresentation(currentPresentationId, 0)).toBe(false);
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

function bootstrap(reviewItems: MobileReviewItem[]): MobileBootstrap {
  return {
    user: {
      id: "user-1",
      email: "review@example.com",
      name: "Review Tester"
    },
    workspace: { id: "workspace-1", name: "Personal" },
    activeEntry: null,
    projects: [],
    categories: [category()],
    entries: [],
    places: [],
    reviewItems
  };
}
