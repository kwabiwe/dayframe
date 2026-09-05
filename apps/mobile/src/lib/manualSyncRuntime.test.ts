import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  sleep: vi.fn(),
  workout: vi.fn(),
  review: vi.fn(),
  location: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("./api", () => ({
  AuthRequiredError: class extends Error {},
  syncQueue: mocks.sync,
  fetchBootstrap: async () => ({
    user: { id: "user" },
    workspace: { id: "workspace" },
  }),
}));
vi.mock("./health", () => ({
  getHealthImportPreferences: async () => ({ sleep: true, walking: true }),
  isHealthKitAutomaticSyncEnabled: async () => true,
  importHealthKitSleep: mocks.sleep,
  importHealthKitWorkouts: mocks.workout,
  reprocessExistingHealthReviewItems: async () => ({
    ok: true,
    confirmedCount: 0,
    ignoredCount: 0,
    updatedCategoryCount: 0,
    repairedSleepEntryCount: 0,
    remainingReviewCount: 0,
  }),
}));
vi.mock("./mobileAccount", () => ({
  mobileAccountKey: () => "owner",
  mobileAccountOwnersEqual: () => true,
  readActiveMobileAccount: async () => ({
    userId: "user",
    workspaceId: "workspace",
  }),
}));
vi.mock("./secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: () => true,
  readOwnedAuthenticatedSessionSnapshot: async () => ({
    status: "authenticated",
    snapshot: { token: "fixture" },
  }),
}));
vi.mock("./reviewSyncStore", () => ({
  cacheDashboardBootstrap: async () => {},
  synchroniseReviewMutations: mocks.review,
}));
vi.mock("./location/runtime", () => ({
  syncLocationIntelligenceOnForeground: mocks.location,
}));
vi.mock("./location/store", () => ({
  getActiveLocationAccountIdentity: async () => ({
    userId: "user",
    workspaceId: "workspace",
  }),
}));
vi.mock("./dashboardBootstrapChannel", () => ({
  beginRecoveredDashboardBootstrapPublication: () => ({
    publish: mocks.publish,
    abandon: () => {},
  }),
}));
vi.mock("./durableLocalProjection", () => ({
  projectDurableLocalWork: (value: unknown) => value,
}));
vi.mock("./durableLocalWork", () => ({
  readDurableLocalWork: async () => ({}),
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const empty = () => ({
  syncedCount: 0,
  remainingCount: 0,
  remaining: [],
  stopped: false,
});
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.review.mockResolvedValue({
    outcome: "server_busy",
    acknowledgedCount: 0,
    waitingCount: 1,
    needsAttentionCount: 0,
  });
  mocks.location.mockResolvedValue({
    outcome: "complete",
    remainingEvidenceCount: 0,
  });
});
describe("Sync now runtime", () => {
  it("delivers each later Health capture even when an earlier forced drain is already running", async () => {
    const sleep = deferred<{ importedCount: number }>(),
      workout = deferred<{ importedCount: number }>();
    const first = deferred<ReturnType<typeof empty>>(),
      second = deferred<ReturnType<typeof empty>>();
    mocks.sleep.mockReturnValue(sleep.promise);
    mocks.workout.mockReturnValue(workout.promise);
    mocks.sync
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(empty());
    const { synchroniseDeviceNow } = await import("./manualSyncRuntime");
    const pass = synchroniseDeviceNow();
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    sleep.resolve({ importedCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.resolve(empty());
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    workout.resolve({ importedCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    second.resolve(empty());
    const result = await pass;
    expect(mocks.sync).toHaveBeenCalledTimes(3);
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
    expect(mocks.location).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalled();
    expect(result.lanes.review.outcome).toBe("server_busy");
  });
});
