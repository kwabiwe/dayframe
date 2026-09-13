import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type {
  ReviewPresentationRequest,
  ReviewPresentationSnapshot
} from "@dayframe/shared";
import type { MobileBootstrap } from "@/lib/api";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  fetch: vi.fn(),
  handover: vi.fn(),
  lookup: vi.fn(),
  readSnapshot: vi.fn(),
  subscribe: null as null | (() => void)
}));

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() })
  }
}));
vi.mock("@/lib/backendIdentity", () => ({ DAYFRAME_BACKEND_ID: "staging-fixture" }));
vi.mock("@/lib/reviewSyncStore", () => ({
  cacheReviewPresentation: mocks.cache,
  readAcknowledgedReviewHandoverLookup: mocks.lookup,
  readReviewPresentationSnapshot: mocks.readSnapshot,
  reviewPresentationScopeKey: () => "window-scope",
  subscribeReviewSync: (listener: () => void) => {
    mocks.subscribe = listener;
    return () => undefined;
  }
}));
vi.mock("@/lib/reviewPresentationClient", () => ({
  fetchReviewPresentationSnapshot: mocks.fetch,
  ReviewPresentationSnapshotChangedError: class extends Error {}
}));
vi.mock("@/lib/reviewPresentationHandover", () => ({
  reconcileAcknowledgedReviewPresentationHandover: mocks.handover
}));
vi.mock("@/lib/todayReviewPresentation", () => ({
  projectTodayReviewPresentation: vi.fn()
}));

import { useTodayReviewPresentation } from "./useTodayReviewPresentation";

describe("useTodayReviewPresentation", () => {
  it("runs acknowledged handover proof from the normal cancellable Today read", async () => {
    mocks.cache.mockResolvedValue(true);
    mocks.lookup.mockResolvedValue(null);
    mocks.readSnapshot.mockResolvedValue(null);
    mocks.handover.mockResolvedValue({ attempted: false, signature: null });
    mocks.fetch.mockImplementation(async ({ request }: {
      request: Omit<ReviewPresentationRequest, "cursor">;
    }) => snapshot(request));

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(mocks.handover).toHaveBeenCalledOnce());
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.handover).toHaveBeenCalledWith(expect.objectContaining({
      owner: {
        backendId: "staging-fixture",
        workspaceId: bootstrap.workspace.id,
        userId: bootstrap.user.id
      },
      timeZone: expect.any(String)
    }));
    expect(mocks.cache).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
});

function Probe() {
  useTodayReviewPresentation({
    bootstrap,
    dashboardEntries: [],
    manualProjectedEntries: [],
    isFocused: true,
    nowMs: Date.parse("2026-09-12T12:00:00.000Z")
  });
  return null;
}

const bootstrap = {
  user: { id: "10000000-0000-4000-8000-000000000001", email: "", name: "" },
  workspace: { id: "20000000-0000-4000-8000-000000000001", name: "Synthetic" },
  activeEntry: null,
  categories: [],
  entries: [],
  reviewItems: [],
  stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 0 },
  serverBuild: { backendId: "staging-fixture" }
} as unknown as MobileBootstrap;

function snapshot(
  request: Omit<ReviewPresentationRequest, "cursor">
): ReviewPresentationSnapshot {
  return {
    version: 1,
    scope: request,
    snapshotToken: "today-window",
    capturedAt: "2026-09-12T12:00:00.000Z",
    nextCursor: null,
    completeness: {
      records: true,
      outstandingCounts: true,
      completedToday: true,
      partialReason: null
    },
    outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] },
    records: [],
    links: [],
    lookup: { reviewItems: [], entries: [] }
  };
}
