import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasActiveActivity: vi.fn(),
  registerLiveActivity: vi.fn(),
  pushToken: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      hasActiveActivity: mocks.hasActiveActivity,
      start: mocks.start,
      pushToken: mocks.pushToken,
      stop: mocks.stop
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
    mocks.hasActiveActivity.mockReset();
    mocks.hasActiveActivity.mockResolvedValue(true);
    mocks.start.mockReset();
    mocks.start.mockResolvedValue(true);
    mocks.pushToken.mockReset();
    mocks.pushToken.mockResolvedValue({ token: "a".repeat(64), environment: "development" });
    mocks.registerLiveActivity.mockReset();
    mocks.registerLiveActivity.mockResolvedValue(undefined);
    mocks.stop.mockReset();
    mocks.stop.mockResolvedValue(true);
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
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);

    expect(mocks.stop).toHaveBeenCalledTimes(1);
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
      "Family",
      "#6E5DC6",
      "2026-07-12T06:45:00.000Z"
    );
  });

  it("recreates an externally-ended activity for an unchanged running timer", async () => {
    const { syncLiveActivityForEntry } = await loadModule();
    const entry = {
      id: "entry-1",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    };

    await syncLiveActivityForEntry(entry);
    mocks.hasActiveActivity.mockResolvedValueOnce(false);
    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("cleans up a native activity that appeared after an idle reconciliation", async () => {
    mocks.hasActiveActivity.mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);
    await syncLiveActivityForEntry(null);

    expect(mocks.stop).toHaveBeenCalledTimes(2);
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
    mocks.stop
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);
    await syncLiveActivityForEntry(null);

    expect(mocks.stop).toHaveBeenCalledTimes(2);
  });

  it("serializes rapid idle and optimistic active-entry reconciliation", async () => {
    let finishStop: ((value: boolean) => void) | undefined;
    mocks.stop.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishStop = resolve;
    }));
    const { syncLiveActivityForEntry } = await loadModule();
    const idleSync = syncLiveActivityForEntry(null);
    const activeSync = syncLiveActivityForEntry({
      id: "optimistic:entry-1",
      startedAt: "2026-07-22T06:05:00.000Z",
      description: "School run",
      categoryName: "Family",
      categoryColor: "violet"
    });

    expect(mocks.start).not.toHaveBeenCalled();
    finishStop?.(true);
    await Promise.all([idleSync, activeSync]);

    expect(mocks.stop).toHaveBeenCalledTimes(1);
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
