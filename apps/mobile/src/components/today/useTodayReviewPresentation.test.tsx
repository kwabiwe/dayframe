import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/backendIdentity", () => ({ DAYFRAME_BACKEND_ID: "dayframe-staging" }));
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribe = null;
  });

  it("establishes the staging owner and reads presentation from a staging-style bootstrap", async () => {
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
        backendId: "dayframe-staging",
        workspaceId: bootstrap.workspace.id,
        userId: bootstrap.user.id
      },
      timeZone: expect.any(String)
    }));
    expect(mocks.cache).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("fails closed when bootstrap declares a different backend", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe bootstrap={{
        ...bootstrap,
        serverBuild: { backendId: "staging-project-ref" }
      }} />);
      await Promise.resolve();
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.handover).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

function Probe({ bootstrap: source = bootstrap }: { bootstrap?: MobileBootstrap }) {
  useTodayReviewPresentation({
    bootstrap: source,
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
  serverBuild: { backendId: "dayframe-staging" }
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
