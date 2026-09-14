import { describe, expect, it } from "vitest";
import type { ReviewPresentationResponse } from "@dayframe/shared";
import {
  mergeReviewBacklogPage,
  projectReviewBacklogPage
} from "./reviewBacklog";

const reviewId = "10000000-0000-4000-8000-000000000001";
const legacyId = "20000000-0000-4000-8000-000000000001";

describe("Review backlog pages", () => {
  it("keeps an exact global count while making the next page reachable", () => {
    const first = projectReviewBacklogPage(page({ nextCursor: "opaque-next" }));

    expect(first).toMatchObject({
      globalCount: 101,
      nextCursor: "opaque-next",
      recordsComplete: false,
      recordKeys: [`review:${reviewId}`, `legacy:${legacyId}`],
      reviewItemIds: [reviewId]
    });
    expect(first.legacyEntries).toMatchObject([{ id: legacyId, description: "Imported walk" }]);
  });

  it("does not append a page from a changed snapshot", () => {
    const first = projectReviewBacklogPage(page({ nextCursor: "opaque-next" }));
    const changed = projectReviewBacklogPage(page({ snapshotToken: "changed", nextCursor: null }));

    expect(mergeReviewBacklogPage(first, changed, false)).toBeNull();
  });

  it("deduplicates page identities and replaces a legacy editor record by its exact entry ID", () => {
    const first = projectReviewBacklogPage(page({ nextCursor: "opaque-next" }));
    const next = projectReviewBacklogPage(page({
      nextCursor: null,
      legacyDescription: "Corrected imported walk"
    }));

    const merged = mergeReviewBacklogPage(first, next, false);

    expect(merged?.recordKeys).toEqual([`review:${reviewId}`, `legacy:${legacyId}`]);
    expect(merged?.reviewItemIds).toEqual([reviewId]);
    expect(merged?.legacyEntries).toMatchObject([
      { id: legacyId, description: "Corrected imported walk" }
    ]);
    expect(merged?.recordsComplete).toBe(true);
  });
});

function page(input: {
  snapshotToken?: string;
  nextCursor: string | null;
  legacyDescription?: string;
}): ReviewPresentationResponse {
  return {
    version: 1,
    scope: { mode: "backlog", timeZone: "Europe/London" },
    snapshotToken: input.snapshotToken ?? "snapshot",
    capturedAt: "2026-09-12T12:00:00.000Z",
    nextCursor: input.nextCursor,
    completeness: {
      records: input.nextCursor === null,
      outstandingCounts: true,
      completedToday: false,
      partialReason: input.nextCursor ? "page" : null
    },
    outstanding: { globalCount: 101, todayCount: 1, openReviewItemIds: [reviewId] },
    records: [
      {
        kind: "review",
        reviewItemId: reviewId,
        eventId: null,
        locationSegmentId: null,
        sourceKind: "generic",
        eventSource: "healthkit",
        eventType: "workout",
        title: "Morning walk",
        category: { id: null, name: "Health", color: "moss" },
        place: { id: null, label: null },
        interval: { start: "2026-09-12T09:00:00.000Z", end: "2026-09-12T09:30:00.000Z" },
        confidence: "medium",
        status: "open",
        createdAt: "2026-09-12T09:31:00.000Z",
        updatedAt: "2026-09-12T09:31:00.000Z",
        proposalHash: "a".repeat(64),
        canonicalEntryIds: [],
        semanticRevision: null
      },
      {
        kind: "legacy_review_entry",
        entryId: legacyId,
        eventId: null,
        title: "Imported walk",
        category: { id: null, name: "Health", color: "moss" },
        place: { id: null, label: null },
        interval: { start: "2026-09-12T08:00:00.000Z", end: "2026-09-12T08:30:00.000Z" },
        confidence: "medium",
        status: "needs_review",
        updatedAt: "2026-09-12T08:31:00.000Z",
        linkedReviewItemId: null,
        editor: {
          projectId: null,
          projectName: null,
          projectColor: null,
          clientName: null,
          placeKind: null,
          source: "healthkit",
          description: input.legacyDescription ?? "Imported walk",
          durationSeconds: 1_800,
          tagNames: []
        }
      }
    ],
    links: [],
    lookup: { reviewItems: [], entries: [] }
  };
}
