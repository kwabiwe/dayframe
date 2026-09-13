import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewPresentationSnapshot } from "@dayframe/shared";

const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  fetch: vi.fn(),
  lookup: vi.fn()
}));

vi.mock("./reviewSyncStore", () => ({
  cacheReviewPresentation: mocks.cache,
  readAcknowledgedReviewHandoverLookup: mocks.lookup
}));
vi.mock("./reviewPresentationClient", () => ({
  fetchReviewPresentationSnapshot: mocks.fetch
}));

import { reconcileAcknowledgedReviewPresentationHandover } from "./reviewPresentationHandover";

const reviewId = "70000000-0000-4000-8000-000000000001";
const entryId = "70000000-0000-4000-8000-000000000002";
const owner = {
  backendId: "staging-fixture",
  workspaceId: "70000000-0000-4000-8000-000000000003",
  userId: "70000000-0000-4000-8000-000000000004"
};

function lookupResponse(linkedEntryIds: string[]): ReviewPresentationSnapshot {
  return {
    version: 1,
    scope: { mode: "lookup", timeZone: "Europe/London" },
    snapshotToken: `snapshot-${linkedEntryIds.join("-") || "none"}`,
    capturedAt: "2026-09-12T12:00:00.000Z",
    nextCursor: null,
    completeness: {
      records: true,
      outstandingCounts: true,
      completedToday: false,
      partialReason: null
    },
    outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] },
    records: [],
    links: [{ reviewItemId: reviewId, entryIds: linkedEntryIds, status: "accepted" }],
    lookup: { reviewItems: [], entries: [] }
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cache.mockResolvedValue(true);
});

describe("acknowledged Review presentation handover", () => {
  it("follows an explicit accepted source link before asking for an equivalent result entry", async () => {
    mocks.lookup.mockResolvedValue({
      clientMutationId: "70000000-0000-4000-8000-000000000005",
      reviewItemIds: [reviewId],
      entryIds: [],
      signature: "equivalent-without-receipt-entry"
    });
    mocks.fetch
      .mockResolvedValueOnce(lookupResponse([entryId]))
      .mockResolvedValueOnce(lookupResponse([entryId]));

    await expect(reconcileAcknowledgedReviewPresentationHandover({
      owner,
      timeZone: "Europe/London"
    })).resolves.toEqual({ attempted: true, signature: "equivalent-without-receipt-entry" });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][0].request).toMatchObject({
      mode: "lookup",
      reviewItemIds: [reviewId]
    });
    expect(mocks.fetch.mock.calls[0][0].request.entryIds).toBeUndefined();
    expect(mocks.fetch.mock.calls[1][0].request).toMatchObject({
      mode: "lookup",
      reviewItemIds: [reviewId],
      entryIds: [entryId]
    });
    expect(mocks.cache).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit receipt result in the first bounded lookup", async () => {
    mocks.lookup.mockResolvedValue({
      clientMutationId: "70000000-0000-4000-8000-000000000006",
      reviewItemIds: [reviewId],
      entryIds: [entryId],
      signature: "receipt-entry"
    });
    mocks.fetch.mockResolvedValue(lookupResponse([entryId]));

    await reconcileAcknowledgedReviewPresentationHandover({
      owner,
      timeZone: "Europe/London"
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0].request).toMatchObject({
      reviewItemIds: [reviewId],
      entryIds: [entryId]
    });
  });

  it("does not issue a display read when no durable acknowledgement needs proof", async () => {
    mocks.lookup.mockResolvedValue(null);

    await expect(reconcileAcknowledgedReviewPresentationHandover({
      owner,
      timeZone: "Europe/London"
    })).resolves.toEqual({ attempted: false, signature: null });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
  });
});
