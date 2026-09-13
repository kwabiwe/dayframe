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
  state: null as any,
  recordRead: vi.fn(),
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
  recordReviewPresentationRead: mocks.recordRead,
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
  ReviewPresentationSnapshotChangedError: class extends Error {},
  ReviewPresentationValidationError: class extends Error {}
}));
vi.mock("@/lib/mobile-network", () => ({
  isMobileTransportFailure: (error: unknown) => error instanceof TypeError
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
    mocks.readSnapshot.mockResolvedValue(cachedSnapshot());
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

  it("retries a failed presentation read on explicit refresh with unchanged bootstrap counts", async () => {
    mocks.cache.mockResolvedValue(true);
    mocks.lookup.mockResolvedValue(null);
    mocks.readSnapshot.mockResolvedValue(cachedSnapshot());
    mocks.handover.mockResolvedValue({ attempted: false, signature: null });
    mocks.fetch
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockImplementationOnce(async ({ request }: {
        request: Omit<ReviewPresentationRequest, "cursor">;
      }) => snapshot(request));

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe refreshGeneration={0} />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    });
    await vi.waitFor(() => expect(mocks.state).toMatchObject({ errorKind: "offline", isLoading: false }));
    expect(mocks.recordRead).toHaveBeenCalledWith(expect.objectContaining({ backendId: "dayframe-staging" }), "today", "offline");

    act(() => {
      tree.update(<Probe refreshGeneration={1} />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    });

    expect(bootstrap.entries).toHaveLength(0);
    expect(bootstrap.reviewItems).toHaveLength(0);
    expect(mocks.fetch.mock.calls[1]?.[0].request).toMatchObject({ mode: "window", limit: 200 });
    expect(mocks.state).toMatchObject({ error: null, errorKind: null });
    expect(mocks.recordRead).toHaveBeenLastCalledWith(expect.anything(), "today", "success");
    act(() => tree.unmount());
  });

  it("fails closed when bootstrap declares a different backend", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Probe bootstrap={{
        ...bootstrap,
        serverBuild: {
          ...bootstrap.serverBuild!,
          backendId: "staging-project-ref"
        }
      }} />);
      await Promise.resolve();
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.handover).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

function Probe({
  bootstrap: source = bootstrap,
  refreshGeneration
}: {
  bootstrap?: MobileBootstrap;
  refreshGeneration?: number;
}) {
  mocks.state = useTodayReviewPresentation({
    bootstrap: source,
    dashboardEntries: [],
    manualProjectedEntries: [],
    isFocused: true,
    nowMs: Date.parse("2026-09-12T12:00:00.000Z"),
    refreshGeneration
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
  serverBuild: {
    sourceSha: null,
    deploymentId: null,
    backendId: "dayframe-staging",
    environment: "staging",
    syncContractVersion: 1
  }
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

function cachedSnapshot() {
  const request: Omit<ReviewPresentationRequest, "cursor"> = {
    version: 1,
    mode: "window",
    timeZone: "Etc/UTC",
    window: { start: "2026-07-15T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
    today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
    limit: 200
  };
  return {
    response: snapshot(request),
    cachedAt: "2026-09-12T12:00:00.000Z",
    localRevision: 1,
    effects: []
  };
}
