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
  fetchReviewPresentationSnapshot,
  REVIEW_PRESENTATION_MAX_SNAPSHOT_PAGES,
  ReviewPresentationSnapshotChangedError,
  ReviewPresentationValidationError,
  mergeReviewPresentationPages
} from "./reviewPresentationClient";
import type { ReviewPresentationResponse } from "@dayframe/shared";
import { rememberReviewPresentationRequestedAt, reviewPresentationRequestedAt } from "./reviewPresentationRequestTime";
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

  it("carries the earliest page's request time to the merged snapshot (stale-cache eviction bound)", () => {
    const first = rememberReviewPresentationRequestedAt(page([], "cursor"), "2026-10-12T18:00:00.000Z");
    const second = rememberReviewPresentationRequestedAt(page([], null), "2026-10-12T18:00:02.000Z");
    expect(reviewPresentationRequestedAt(mergeReviewPresentationPages([first, second]))).toBe("2026-10-12T18:00:00.000Z");
    expect(reviewPresentationRequestedAt(mergeReviewPresentationPages([page([], null)]))).toBeUndefined();
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

  it("asks for time away, Move route lines and outings, which only this client understands", async () => {
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockResolvedValue({
      status: "authenticated",
      snapshot: { token: "fixture-token", owner: { workspaceId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001" } }
    } as never);
    vi.mocked(isAuthenticatedSessionSnapshotCurrent).mockReturnValue(true);
    vi.mocked(mobileJsonRequest).mockResolvedValue({ response: { ok: false, status: 409 } as Response, body: { code: "snapshot_changed" } } as never);
    await fetchReviewPresentationPage({
      owner: { backendId: "staging-fixture", workspaceId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001" },
      request: { version: 1, mode: "backlog", timeZone: "Etc/UTC", limit: 100 }
    }).catch(() => undefined);
    expect(vi.mocked(mobileJsonRequest).mock.lastCall?.[1]?.headers).toMatchObject({ "x-dayframe-review-features": "time-away,move-route,outing,outing-count,learned-name,timer-trip-clash" });
  });

  it("classifies a malformed successful response without exposing its body", async () => {
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockResolvedValue({
      status: "authenticated",
      snapshot: { token: "fixture-token", owner: { workspaceId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001" } }
    } as never);
    vi.mocked(isAuthenticatedSessionSnapshotCurrent).mockReturnValue(true);
    vi.mocked(mobileJsonRequest).mockResolvedValue({
      response: { ok: true, status: 200 } as Response,
      body: { unexpected: true }
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
    })).rejects.toBeInstanceOf(ReviewPresentationValidationError);
  });
});

// Location v4 design §7 (#621): clashes past the bootstrap's 100 Review items, read page by page.
describe("a block that ran into a trip past the bootstrap's cap", () => {
  const OWNER = { backendId: "staging-fixture", workspaceId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000001" };
  const clashField = { timeEntryId: "40000000-0000-4000-8000-000000000001", tripId: "trip-1", tripStartedAt: "2026-09-12T10:42:00.000Z",
    tripStoppedAt: "2026-09-12T11:10:00.000Z", overlapSeconds: 1080 };
  const clashRecord = (reviewItemId: string, field: unknown = clashField) => ({
    ...review(reviewItemId), eventSource: "location_learning", eventType: "timer_trip_clash", title: "Team sync ran 18m into your trip",
    interval: { start: "2026-09-12T09:00:00.000Z", end: "2026-09-12T10:42:00.000Z" }, proposalHash: "b".repeat(64),
    ...(field === undefined ? {} : { timerTripClash: field })
  }) as ReviewPresentationResponse["records"][number];
  const authenticated = () => {
    vi.mocked(mobileJsonRequest).mockReset();
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockReset();
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockResolvedValue({ status: "authenticated", snapshot: { token: "fixture-token", owner: OWNER } } as never);
    vi.mocked(isAuthenticatedSessionSnapshotCurrent).mockReturnValue(true);
  };
  const ok = (value: unknown) => ({ response: { ok: true, status: 200 } as Response, body: value });
  // mobileJsonRequest's own validate runs on the raw body (as the real adapter does).
  const serve = (pages: unknown[]) => vi.mocked(mobileJsonRequest).mockImplementation((async (_url: string, _init: RequestInit,
    options: { validate: (value: unknown, response: Response) => unknown }) => {
    const value = pages.shift();
    return { response: { ok: true, status: 200 } as Response, body: options.validate(value, { ok: true, status: 200 } as Response) };
  }) as never);

  it("pages past the cap, 200 a page with the server's cursor, asking for the clash field", async () => {
    authenticated();
    const ids = (from: number, count: number) => Array.from({ length: count }, (_, index) =>
      `30000000-0000-4000-8000-${String(from + index).padStart(12, "0")}`);
    serve([
      page(ids(0, 200).map((id) => review(id)), "cursor-1"),
      page([...ids(200, 199).map((id) => review(id)), clashRecord("31000000-0000-4000-8000-000000000001")], "cursor-2"),
      page([clashRecord("31000000-0000-4000-8000-000000000002")], null)
    ]);
    const snapshot = await fetchReviewPresentationSnapshot({ owner: OWNER, request: { version: 1, ...scope, limit: 200 } });
    expect(snapshot.records).toHaveLength(401);
    const calls = vi.mocked(mobileJsonRequest).mock.calls;
    expect(calls.map((call) => JSON.parse(String(call[1]?.body)).cursor)).toEqual([undefined, "cursor-1", "cursor-2"]);
    expect(calls.every((call) => JSON.parse(String(call[1]?.body)).limit === 200)).toBe(true);
    expect((calls[0][1]?.headers as Record<string, string>)["x-dayframe-review-features"].split(",")).toContain("timer-trip-clash");
    const clash = snapshot.records.find((record) => record.kind === "review" && record.reviewItemId === "31000000-0000-4000-8000-000000000002");
    expect(clash).toMatchObject({ timerTripClash: clashField });
  });

  it("keeps a record whose clash field is malformed, without the field, and never fails the page", async () => {
    authenticated();
    serve([page([clashRecord("31000000-0000-4000-8000-000000000003", { ...clashField, overlapSeconds: -5 }),
      clashRecord("31000000-0000-4000-8000-000000000004", { ...clashField, extra: true })], null)]);
    const snapshot = await fetchReviewPresentationSnapshot({ owner: OWNER, request: { version: 1, ...scope, limit: 200 } });
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.some((record) => "timerTripClash" in record)).toBe(false);
  });

  it("stops after its page cap rather than following cursors forever", async () => {
    authenticated();
    vi.mocked(mobileJsonRequest).mockImplementation((async () => ok(page([], "again"))) as never);
    await expect(fetchReviewPresentationSnapshot({ owner: OWNER, request: { version: 1, ...scope, limit: 200 } }))
      .rejects.toThrow("bounded page count");
    expect(vi.mocked(mobileJsonRequest).mock.calls.length).toBeLessThanOrEqual(REVIEW_PRESENTATION_MAX_SNAPSHOT_PAGES);
    expect(REVIEW_PRESENTATION_MAX_SNAPSHOT_PAGES).toBe(25);
  });

  it("stops paging when the account changes mid-read: no page is read for the next account", async () => {
    vi.mocked(mobileJsonRequest).mockReset();
    vi.mocked(readOwnedAuthenticatedSessionSnapshot).mockReset();
    vi.mocked(isAuthenticatedSessionSnapshotCurrent).mockReturnValue(true);
    vi.mocked(readOwnedAuthenticatedSessionSnapshot)
      .mockResolvedValueOnce({ status: "authenticated", snapshot: { token: "fixture-token", owner: OWNER } } as never)
      // Another account is signed in before the second page.
      .mockResolvedValueOnce({ status: "owner_mismatch" } as never);
    vi.mocked(mobileJsonRequest).mockResolvedValueOnce(ok(page([review("30000000-0000-4000-8000-000000000999")], "cursor-1")) as never);
    await expect(fetchReviewPresentationSnapshot({ owner: OWNER, request: { version: 1, ...scope, limit: 200 } })).rejects.toBeTruthy();
    expect(vi.mocked(mobileJsonRequest)).toHaveBeenCalledTimes(1);
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
