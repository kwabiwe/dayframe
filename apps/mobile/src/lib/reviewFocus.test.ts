import { describe, expect, it } from "vitest";
import {
  legacyReviewPresentationToMobileEntry,
  parseReviewFocusRequest
} from "./reviewFocus";

const reviewId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";

describe("parseReviewFocusRequest", () => {
  it("accepts one exact review or legacy identity only", () => {
    expect(parseReviewFocusRequest({ focusReviewId: reviewId })).toEqual({ kind: "review", id: reviewId });
    expect(parseReviewFocusRequest({ focusEntryId: entryId })).toEqual({ kind: "legacy_entry", id: entryId });
  });

  it("refuses invalid, repeated, and ambiguous route values", () => {
    expect(parseReviewFocusRequest({ focusReviewId: "nearby-item" })).toBeNull();
    expect(parseReviewFocusRequest({ focusReviewId: [reviewId] })).toBeNull();
    expect(parseReviewFocusRequest({ focusReviewId: reviewId, focusEntryId: entryId })).toBeNull();
  });
});

describe("legacyReviewPresentationToMobileEntry", () => {
  it("adapts only real editor fields from the presentation contract", () => {
    expect(legacyReviewPresentationToMobileEntry(legacyRecord())).toMatchObject({
      id: entryId,
      startedAt: "2026-09-12T09:00:00.000Z",
      stoppedAt: "2026-09-12T09:30:00.000Z",
      durationSeconds: 1_800,
      tagNames: ["Synthetic"]
    });
  });

  it("does not invent an editor entry from invalid interval evidence", () => {
    expect(legacyReviewPresentationToMobileEntry({
      ...legacyRecord(),
      interval: { start: "2026-09-12T09:30:00.000Z", end: "2026-09-12T09:00:00.000Z" }
    })).toBeNull();
  });
});

function legacyRecord() {
  return {
    kind: "legacy_review_entry" as const,
    entryId,
    eventId: null,
    title: "Synthetic activity",
    category: { id: null, name: "Health", color: "moss" },
    place: { id: null, label: null },
    interval: { start: "2026-09-12T09:00:00.000Z", end: "2026-09-12T09:30:00.000Z" },
    confidence: "medium",
    status: "needs_review" as const,
    updatedAt: "2026-09-12T09:31:00.000Z",
    linkedReviewItemId: null,
    editor: {
      projectId: null,
      projectName: null,
      projectColor: null,
      clientName: null,
      placeKind: null,
      source: "healthkit",
      description: "Synthetic activity",
      durationSeconds: 1_800,
      tagNames: ["Synthetic"]
    }
  };
}
