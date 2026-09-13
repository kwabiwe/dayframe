import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  AuthRequiredError: class AuthRequiredError extends Error {}
}));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://staging-fixture.invalid" }));
vi.mock("./mobile-network", () => ({
  MobileHttpResponseError: class MobileHttpResponseError extends Error {},
  StaleMobileSessionResponseError: class StaleMobileSessionResponseError extends Error {},
  mobileJsonRequest: vi.fn()
}));
vi.mock("./secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: vi.fn(),
  readOwnedAuthenticatedSessionSnapshot: vi.fn()
}));
import {
  fetchReviewPresentationPage,
  ReviewPresentationSnapshotChangedError,
  mergeReviewPresentationPages
} from "./reviewPresentationClient";
import type { ReviewPresentationResponse } from "@dayframe/shared";
import { mobileJsonRequest } from "./mobile-network";
import {
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot
} from "./secure-session";

const scope = {
  mode: "window" as const,
  timeZone: "Etc/UTC",
  window: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
  today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" }
};

describe("mergeReviewPresentationPages", () => {
  it("retains every bounded page from one snapshot and deduplicates explicit identities", () => {
    const merged = mergeReviewPresentationPages([
      page([review("10000000-0000-4000-8000-000000000001")], "cursor"),
      page([
        review("10000000-0000-4000-8000-000000000001"),
        review("10000000-0000-4000-8000-000000000002")
      ], null)
    ]);

    expect(merged.records).toHaveLength(2);
    expect(merged.nextCursor).toBeNull();
    expect(merged.completeness.records).toBe(true);
  });

  it("does not combine pages across a changed snapshot or scope", () => {
    expect(() => mergeReviewPresentationPages([
      page([], "cursor"),
      { ...page([], null), snapshotToken: "changed" }
    ])).toThrow(ReviewPresentationSnapshotChangedError);
  });
});

describe("fetchReviewPresentationPage", () => {
  it("recognises a typed snapshot conflict so the caller can restart once", async () => {
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockResolvedValue({
      status: "authenticated",
      snapshot: { token: "fixture-token", owner: { workspaceId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001" } }
    } as never);
    vi.mocked(isAuthenticatedSessionSnapshotCurrent).mockReturnValue(true);
    vi.mocked(mobileJsonRequest).mockResolvedValue({
      response: { ok: false, status: 409 } as Response,
      body: { code: "snapshot_changed" }
    } as never);

    await expect(fetchReviewPresentationPage({
      owner: {
        backendId: "staging-fixture",
        workspaceId: "10000000-0000-4000-8000-000000000001",
        userId: "20000000-0000-4000-8000-000000000001"
      },
      request: {
        version: 1,
        mode: "lookup",
        timeZone: "Etc/UTC",
        reviewItemIds: ["30000000-0000-4000-8000-000000000001"],
        limit: 100
      }
    })).rejects.toBeInstanceOf(ReviewPresentationSnapshotChangedError);
  });
});

function page(records: ReviewPresentationResponse["records"], nextCursor: string | null): ReviewPresentationResponse {
  return {
    version: 1,
    scope,
    snapshotToken: "snapshot",
    capturedAt: "2026-09-12T10:00:00.000Z",
    nextCursor,
    completeness: {
      records: nextCursor === null,
      outstandingCounts: true,
      completedToday: nextCursor === null,
      partialReason: nextCursor ? "page" : null
    },
    outstanding: { globalCount: 2, todayCount: 2, openReviewItemIds: [] },
    records,
    links: [],
    lookup: { reviewItems: [], entries: [] }
  };
}

function review(reviewItemId: string): ReviewPresentationResponse["records"][number] {
  return {
    kind: "review",
    reviewItemId,
    eventId: null,
    locationSegmentId: null,
    sourceKind: "generic",
    eventSource: "health_workout",
    eventType: "workout",
    title: "Synthetic walk",
    category: { id: null, name: null, color: null },
    place: { id: null, label: null },
    interval: { start: "2026-09-12T09:00:00.000Z", end: "2026-09-12T09:30:00.000Z" },
    confidence: "medium",
    status: "open",
    createdAt: "2026-09-12T09:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    proposalHash: "a".repeat(64),
    canonicalEntryIds: [],
    semanticRevision: null
  };
}
