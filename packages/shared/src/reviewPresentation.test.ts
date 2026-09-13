import { describe, expect, it } from "vitest";
import {
  ReviewPresentationRequestSchema,
  ReviewPresentationSnapshotSchema,
  ReviewProposalPresentationSchema
} from "./reviewPresentation";

const windowRequest = {
  version: 1 as const,
  mode: "window" as const,
  timeZone: "Europe/London",
  window: {
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z"
  },
  today: {
    start: "2026-03-01T00:00:00.000Z",
    end: "2026-03-02T00:00:00.000Z"
  }
};

describe("ReviewPresentationRequestSchema", () => {
  it("accepts a bounded local-day window and applies the page default", () => {
    expect(ReviewPresentationRequestSchema.parse(windowRequest)).toMatchObject({
      ...windowRequest,
      limit: 100
    });
  });

  it("rejects non-IANA zones and bounds that do not align to local midnight", () => {
    expect(ReviewPresentationRequestSchema.safeParse({
      ...windowRequest,
      timeZone: "London"
    }).success).toBe(false);
    expect(ReviewPresentationRequestSchema.safeParse({
      ...windowRequest,
      today: {
        start: "2026-03-01T00:30:00.000Z",
        end: "2026-03-02T00:00:00.000Z"
      }
    }).success).toBe(false);
  });

  it("requires bounded unique lookup identities without accepting date bounds", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(ReviewPresentationRequestSchema.parse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id]
    })).toMatchObject({ mode: "lookup", reviewItemIds: [id], limit: 100 });
    expect(ReviewPresentationRequestSchema.safeParse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id, id]
    }).success).toBe(false);
    expect(ReviewPresentationRequestSchema.safeParse({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: [id],
      window: windowRequest.window
    }).success).toBe(false);
  });
});

describe("Review presentation terminal representation", () => {
  const reviewItemId = "00000000-0000-4000-8000-000000000001";
  const review = {
    kind: "review" as const,
    reviewItemId,
    eventId: null,
    locationSegmentId: null,
    sourceKind: "generic" as const,
    eventSource: null,
    eventType: null,
    title: "Synthetic Review",
    category: { id: null, name: null, color: null },
    place: { id: null, label: null },
    interval: { start: "2026-03-01T09:00:00.000Z", end: "2026-03-01T09:30:00.000Z" },
    confidence: "medium",
    status: "open" as const,
    createdAt: "2026-03-01T09:00:00.000Z",
    updatedAt: "2026-03-01T09:00:00.000Z",
    proposalHash: "a".repeat(64),
    canonicalEntryIds: [],
    semanticRevision: null
  };

  it("uses missing_review for an absent lookup rather than a missing Review status", () => {
    expect(ReviewProposalPresentationSchema.safeParse({ ...review, status: "missing" }).success).toBe(false);
    expect(ReviewPresentationSnapshotSchema.safeParse({
      version: 1,
      scope: { mode: "lookup", timeZone: "Europe/London", reviewItemIds: [reviewItemId] },
      snapshotToken: "synthetic",
      capturedAt: "2026-03-01T10:00:00.000Z",
      nextCursor: null,
      completeness: {
        records: true,
        outstandingCounts: true,
        completedToday: false,
        partialReason: null
      },
      outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] },
      records: [],
      links: [],
      lookup: { reviewItems: [{ kind: "missing_review", reviewItemId }], entries: [] }
    }).success).toBe(true);
  });
});
