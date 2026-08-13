import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activitySnapshot: vi.fn(),
  cleanupActivities: vi.fn(),
  registerLiveActivity: vi.fn(),
  pushToken: vi.fn(),
  start: vi.fn()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      activitySnapshot: mocks.activitySnapshot,
      cleanupActivities: mocks.cleanupActivities,
      start: mocks.start,
      pushToken: mocks.pushToken
    }
  },
  Platform: { OS: "ios" }
}));

vi.mock("./api", () => ({
  registerLiveActivity: mocks.registerLiveActivity
}));

async function loadModule() {
  vi.resetModules();
  return import("./liveActivity");
}

describe("Live Activity sync", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.activitySnapshot.mockReset();
    mocks.activitySnapshot.mockResolvedValue([]);
    mocks.cleanupActivities.mockReset();
    mocks.cleanupActivities.mockResolvedValue(true);
    mocks.start.mockReset();
    mocks.start.mockResolvedValue(true);
    mocks.pushToken.mockReset();
    mocks.pushToken.mockResolvedValue({ token: "a".repeat(64), environment: "development" });
    mocks.registerLiveActivity.mockReset();
    mocks.registerLiveActivity.mockResolvedValue(undefined);
  });

  it("shows Uncategorized instead of Tracking for a blank timer", async () => {
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: null,
      categoryName: null,
      categoryColor: null
    });

    expect(mocks.start).toHaveBeenCalledWith(
      "Uncategorized",
      null,
      null,
      null,
      "2026-07-12T06:45:00.000Z"
    );
  });

  it("registers a persisted activity for remote updates", async () => {
    mocks.start.mockResolvedValue({ started: true, activityId: "activity-1" });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "80000000-0000-4000-8000-000000000001",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledWith({
      token: "a".repeat(64),
      activityId: "activity-1",
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      environment: "development"
    }));
  });

  it("retries until ActivityKit provides both a token and its signed APNs environment", async () => {
    vi.useFakeTimers();
    mocks.start.mockResolvedValue({ started: true, activityId: "activity-1" });
    mocks.pushToken
      .mockResolvedValueOnce({ token: "a".repeat(64), environment: null })
      .mockResolvedValueOnce({ token: "b".repeat(64), environment: "development" });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "80000000-0000-4000-8000-000000000001",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(mocks.pushToken).toHaveBeenCalledTimes(2);
    expect(mocks.registerLiveActivity).toHaveBeenCalledWith(expect.objectContaining({
      token: "b".repeat(64),
      environment: "development"
    }));
    vi.useRealTimers();
  });

  it("clears stale native activities on the first idle bootstrap", async () => {
    mocks.activitySnapshot.mockResolvedValueOnce([{
      activityId: "activity-stale",
      entryId: null,
      isActive: true,
      isRunning: true
    }]);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);

    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-stale"]);
  });

  it("starts a native activity for a changed active entry", async () => {
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });
    await syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith(
      "School run",
      null,
      "Family",
      "#6E5DC6",
      "2026-07-12T06:45:00.000Z"
    );
  });

  it("recreates an externally-ended activity for an unchanged running timer", async () => {
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "80000000-0000-4000-8000-000000000001",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    };

    await syncLiveActivityForEntry(entry);
    mocks.activitySnapshot.mockResolvedValueOnce([]);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale activity satisfy reconciliation for a newer canonical timer", async () => {
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "80000000-0000-4000-8000-000000000002",
      startedAt: "2026-08-13T13:50:00.000Z",
      description: "New timer",
      categoryName: "Work",
      categoryColor: "blue"
    };

    await syncLiveActivityForEntry(entry);
    mocks.activitySnapshot.mockResolvedValueOnce([{
      activityId: "activity-old",
      entryId: "80000000-0000-4000-8000-000000000001",
      isActive: true,
      isRunning: true
    }]);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenLastCalledWith(
      "New timer",
      entry.id,
      "Work",
      "#579DFF",
      entry.startedAt
    );
  });

  it("keeps the exact current activity and cleans stale siblings", async () => {
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "80000000-0000-4000-8000-000000000002",
      startedAt: "2026-08-13T13:50:00.000Z",
      description: "New timer",
      categoryName: "Work",
      categoryColor: "blue"
    };

    await syncLiveActivityForEntry(entry);
    mocks.activitySnapshot.mockResolvedValueOnce([
      { activityId: "activity-new", entryId: entry.id, isActive: true, isRunning: true },
      {
        activityId: "activity-old",
        entryId: "80000000-0000-4000-8000-000000000001",
        isActive: true,
        isRunning: true
      }
    ]);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-old"]);
  });

  it("cleans only observed stale IDs after the intended canonical start exists", async () => {
    const entry = {
      id: "80000000-0000-4000-8000-000000000002",
      startedAt: "2026-08-13T14:00:00.000Z",
      description: "Current timer",
      categoryName: "Work",
      categoryColor: "blue"
    };
    mocks.start.mockResolvedValue({ started: true, activityId: "activity-new" });
    mocks.activitySnapshot.mockResolvedValueOnce([
      { activityId: "activity-new", entryId: entry.id, isActive: true, isRunning: true },
      {
        activityId: "activity-old",
        entryId: "80000000-0000-4000-8000-000000000001",
        isActive: true,
        isRunning: true
      }
    ]);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entry);

    expect(mocks.cleanupActivities).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-old"]);
  });

  it("cleans up a native activity that appeared after an idle reconciliation", async () => {
    mocks.activitySnapshot
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        activityId: "activity-late",
        entryId: null,
        isActive: true,
        isRunning: true
      }]);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);
    await syncLiveActivityForEntry(null);

    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-late"]);
  });

  it("retries active-entry reconciliation when native start reports failure", async () => {
    mocks.start
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    };

    await syncLiveActivityForEntry(entry);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("retries idle reconciliation when native stop reports failure", async () => {
    mocks.activitySnapshot.mockResolvedValue([{
      activityId: "activity-stale",
      entryId: null,
      isActive: true,
      isRunning: true
    }]);
    mocks.cleanupActivities
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);
    await syncLiveActivityForEntry(null);

    expect(mocks.cleanupActivities).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-stale"]);
  });

  it("serializes rapid idle and optimistic active-entry reconciliation", async () => {
    let finishCleanup: ((value: boolean) => void) | undefined;
    mocks.activitySnapshot.mockResolvedValueOnce([{
      activityId: "activity-old",
      entryId: null,
      isActive: true,
      isRunning: true
    }]);
    mocks.cleanupActivities.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishCleanup = resolve;
    }));
    const { syncLiveActivityForEntry } = await loadModule();
    const idleSync = syncLiveActivityForEntry(null);
    await vi.waitFor(() => {
      expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-old"]);
    });
    const activeSync = syncLiveActivityForEntry({
      id: "optimistic:entry-1",
      startedAt: "2026-07-22T06:05:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });

    expect(mocks.start).not.toHaveBeenCalled();
    finishCleanup?.(true);
    await Promise.all([idleSync, activeSync]);

    expect(mocks.cleanupActivities).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("reconciles the latest persisted entry after an optimistic id changes", async () => {
    let finishStart: ((value: boolean) => void) | undefined;
    mocks.start.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishStart = resolve;
    }));
    const { syncLiveActivityForEntry } = await loadModule();
    const optimisticSync = syncLiveActivityForEntry({
      id: "optimistic:entry-1",
      startedAt: "2026-07-22T06:05:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });
    const persistedSync = syncLiveActivityForEntry({
      id: "entry-1",
      startedAt: "2026-07-22T06:05:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });

    finishStart?.(true);
    await Promise.all([optimisticSync, persistedSync]);

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
});
