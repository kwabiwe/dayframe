import { beforeEach, describe, expect, it, vi } from "vitest";

type NativeActivity = {
  activityId: string;
  entryId: string | null;
  isActive: boolean;
  isRunning: boolean;
};

const mocks = vi.hoisted(() => ({
  activitySnapshot: vi.fn(),
  cleanupActivities: vi.fn(),
  enableStop: vi.fn(),
  registerLiveActivity: vi.fn(),
  pushToken: vi.fn(),
  start: vi.fn()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      activitySnapshot: mocks.activitySnapshot,
      cleanupActivities: mocks.cleanupActivities,
      enableStop: mocks.enableStop,
      start: mocks.start,
      pushToken: mocks.pushToken
    }
  },
  Platform: { OS: "ios" }
}));

vi.mock("./api", () => ({
  registerLiveActivity: mocks.registerLiveActivity
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app"
}));

let activities: NativeActivity[] = [];
let activitySequence = 0;

async function loadModule() {
  vi.resetModules();
  return import("./liveActivity");
}

function canonicalEntry(
  id = "80000000-0000-4000-8000-000000000001",
  overrides: Partial<ReturnType<typeof canonicalEntryShape>> = {}
) {
  return { ...canonicalEntryShape(id), ...overrides };
}

function canonicalEntryShape(id: string) {
  return {
    id,
    startedAt: "2026-08-19T08:15:00.000Z",
    description: "Stretching",
    categoryName: "Health",
    categoryColor: "green"
  };
}

function addActivity(activityId: string, entryId: string | null) {
  activities.push({ activityId, entryId, isActive: true, isRunning: true });
}

function installStatefulNativeMocks() {
  mocks.activitySnapshot.mockImplementation(async () => activities.map((activity) => ({ ...activity })));
  mocks.start.mockImplementation(async (
    _title: string,
    entryId?: string | null
  ) => {
    const canonicalEntryId = entryId ?? null;
    const existing = canonicalEntryId
      ? activities.find((activity) => activity.entryId === canonicalEntryId)
      : null;
    if (existing) return { started: true, activityId: existing.activityId };
    const activityId = canonicalEntryId
      ? `activity-canonical-${++activitySequence}`
      : `activity-optimistic-${++activitySequence}`;
    addActivity(activityId, canonicalEntryId);
    return { started: true, activityId };
  });
  mocks.cleanupActivities.mockImplementation(async (activityIds: string[]) => {
    const stale = new Set(activityIds);
    activities = activities.filter((activity) => !stale.has(activity.activityId));
    return true;
  });
}

describe("Live Activity sync", () => {
  beforeEach(() => {
    vi.useRealTimers();
    activities = [];
    activitySequence = 0;
    mocks.activitySnapshot.mockReset();
    mocks.cleanupActivities.mockReset();
    mocks.enableStop.mockReset();
    mocks.enableStop.mockResolvedValue(true);
    mocks.start.mockReset();
    mocks.pushToken.mockReset();
    mocks.pushToken.mockResolvedValue({ token: "a".repeat(64), environment: "development" });
    mocks.registerLiveActivity.mockReset();
    mocks.registerLiveActivity.mockResolvedValue(undefined);
    installStatefulNativeMocks();
  });

  it("shows Uncategorized for a blank optimistic timer", async () => {
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({
      id: "optimistic-active-timer:blank",
      startedAt: "2026-07-12T06:45:00.000Z",
      description: null,
      categoryName: null,
      categoryColor: null
    });

    expect(mocks.start).toHaveBeenCalledWith(
      "Uncategorized",
      null,
      "https://dayframe-staging.vercel.app",
      null,
      null,
      "2026-07-12T06:45:00.000Z"
    );
  });

  it("proves optimistic-to-canonical convergence before registration", async () => {
    const entry = canonicalEntry();
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry({ ...entry, id: "optimistic-active-timer:stretching" });
    const optimisticId = activities[0]?.activityId;
    await syncLiveActivityForEntry(entry);

    expect(optimisticId).toBe("activity-optimistic-1");
    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-optimistic-1"]);
    expect(activities).toEqual([
      expect.objectContaining({
        activityId: "activity-canonical-2",
        entryId: entry.id,
        isActive: true,
        isRunning: true
      })
    ]);
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledWith({
      token: "a".repeat(64),
      activityId: "activity-canonical-2",
      activeEntryId: entry.id,
      environment: "development"
    }));
    expect(mocks.enableStop).toHaveBeenCalledWith("activity-canonical-2", entry.id);
  });

  it("retries when cleanup resolves true but ActivityKit still reports the stale sibling", async () => {
    vi.useFakeTimers();
    const entry = canonicalEntry();
    addActivity("activity-optimistic", null);
    mocks.cleanupActivities
      .mockResolvedValueOnce(true)
      .mockImplementation(async (activityIds: string[]) => {
        const stale = new Set(activityIds);
        activities = activities.filter((activity) => !stale.has(activity.activityId));
        return true;
      });
    const { syncLiveActivityForEntry } = await loadModule();

    const reconciliation = syncLiveActivityForEntry(entry);
    await vi.advanceTimersByTimeAsync(1_300);
    await reconciliation;

    expect(mocks.cleanupActivities).toHaveBeenCalledTimes(2);
    expect(activities).toHaveLength(1);
    expect(activities[0]?.entryId).toBe(entry.id);
    expect(mocks.registerLiveActivity).toHaveBeenCalledOnce();
  });

  it("retries a false cleanup result and leaves exhausted cleanup unsynced", async () => {
    vi.useFakeTimers();
    const entry = canonicalEntry();
    addActivity("activity-optimistic", null);
    mocks.cleanupActivities.mockResolvedValue(false);
    const { syncLiveActivityForEntry } = await loadModule();

    const exhausted = syncLiveActivityForEntry(entry);
    await vi.advanceTimersByTimeAsync(1_300);
    await exhausted;

    expect(mocks.cleanupActivities).toHaveBeenCalledTimes(3);
    expect(mocks.registerLiveActivity).not.toHaveBeenCalled();

    mocks.cleanupActivities.mockImplementation(async (activityIds: string[]) => {
      const stale = new Set(activityIds);
      activities = activities.filter((activity) => !stale.has(activity.activityId));
      return true;
    });
    const foregroundRetry = syncLiveActivityForEntry(entry);
    await vi.advanceTimersByTimeAsync(1_300);
    await foregroundRetry;

    expect(activities).toHaveLength(1);
    expect(activities[0]?.entryId).toBe(entry.id);
    expect(mocks.registerLiveActivity).toHaveBeenCalledOnce();
  });

  it("keeps one deterministic survivor when canonical siblings share an entry UUID", async () => {
    const entry = canonicalEntry();
    addActivity("activity-canonical-a", entry.id);
    addActivity("activity-canonical-b", entry.id);
    mocks.start.mockResolvedValue({ started: true, activityId: "activity-canonical-b" });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entry);

    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-canonical-a"]);
    expect(activities.map((activity) => activity.activityId)).toEqual(["activity-canonical-b"]);
    await vi.waitFor(() => expect(mocks.enableStop).toHaveBeenCalledWith(
      "activity-canonical-b",
      entry.id
    ));
  });

  it("lets a newer timer generation survive cleanup captured for the prior generation", async () => {
    const entryA = canonicalEntry();
    const entryB = canonicalEntry("80000000-0000-4000-8000-000000000002", {
      description: "Planning",
      categoryName: "Work",
      categoryColor: "blue"
    });
    addActivity("activity-optimistic", null);
    let finishFirstCleanup: ((value: boolean) => void) | undefined;
    mocks.cleanupActivities
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        finishFirstCleanup = resolve;
      }))
      .mockImplementation(async (activityIds: string[]) => {
        const stale = new Set(activityIds);
        activities = activities.filter((activity) => !stale.has(activity.activityId));
        return true;
      });
    const { syncLiveActivityForEntry } = await loadModule();

    const syncA = syncLiveActivityForEntry(entryA);
    await vi.waitFor(() => expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-optimistic"]));
    const syncB = syncLiveActivityForEntry(entryB);
    activities = activities.filter((activity) => activity.activityId !== "activity-optimistic");
    finishFirstCleanup?.(true);
    await Promise.all([syncA, syncB]);

    expect(activities).toHaveLength(1);
    expect(activities[0]?.entryId).toBe(entryB.id);
    expect(mocks.cleanupActivities).toHaveBeenNthCalledWith(2, ["activity-canonical-1"]);
  });

  it("captures exact stale IDs when Stop supersedes canonical promotion", async () => {
    const entry = canonicalEntry();
    addActivity("activity-optimistic", null);
    let finishPromotionCleanup: ((value: boolean) => void) | undefined;
    mocks.cleanupActivities
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        finishPromotionCleanup = resolve;
      }))
      .mockImplementation(async (activityIds: string[]) => {
        const stale = new Set(activityIds);
        activities = activities.filter((activity) => !stale.has(activity.activityId));
        return true;
      });
    const { syncLiveActivityForEntry } = await loadModule();

    const promotion = syncLiveActivityForEntry(entry);
    await vi.waitFor(() => expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-optimistic"]));
    const stop = syncLiveActivityForEntry(null);
    activities = activities.filter((activity) => activity.activityId !== "activity-optimistic");
    finishPromotionCleanup?.(true);
    await Promise.all([promotion, stop]);

    expect(mocks.cleanupActivities).toHaveBeenNthCalledWith(1, ["activity-optimistic"]);
    expect(mocks.cleanupActivities).toHaveBeenNthCalledWith(2, ["activity-canonical-1"]);
    expect(activities).toEqual([]);
  });

  it("does not enable a stale activity when registration completes after replacement", async () => {
    const entryA = canonicalEntry();
    const entryB = canonicalEntry("80000000-0000-4000-8000-000000000002", {
      description: "Planning",
      categoryName: "Work",
      categoryColor: "blue"
    });
    let finishRegistrationA: (() => void) | undefined;
    mocks.registerLiveActivity.mockImplementation(({ activityId }: { activityId: string }) => {
      if (activityId !== "activity-canonical-1") return Promise.resolve();
      return new Promise<void>((resolve) => {
        finishRegistrationA = resolve;
      });
    });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entryA);
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: "activity-canonical-1" })
    ));
    await syncLiveActivityForEntry(entryB);
    finishRegistrationA?.();

    await vi.waitFor(() => expect(mocks.enableStop).toHaveBeenCalledWith(
      "activity-canonical-2",
      entryB.id
    ));
    expect(mocks.enableStop).not.toHaveBeenCalledWith("activity-canonical-1", entryA.id);
    expect(activities).toEqual([
      expect.objectContaining({ activityId: "activity-canonical-2", entryId: entryB.id })
    ]);
  });

  it("requeues registration for the latest same-entry generation", async () => {
    const entry = canonicalEntry();
    let finishFirstRegistration: (() => void) | undefined;
    mocks.registerLiveActivity
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishFirstRegistration = resolve;
      }))
      .mockResolvedValue(undefined);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entry);
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledTimes(1));
    await syncLiveActivityForEntry(entry);
    finishFirstRegistration?.();

    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mocks.enableStop).toHaveBeenCalledWith(
      "activity-canonical-1",
      entry.id
    ));
  });

  it("re-registers the verified survivor when ActivityKit rotates its token", async () => {
    const entry = canonicalEntry();
    mocks.pushToken
      .mockResolvedValueOnce({ token: "a".repeat(64), environment: "development" })
      .mockResolvedValue({ token: "b".repeat(64), environment: "development" });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entry);
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledTimes(1));
    await syncLiveActivityForEntry(entry);
    await vi.waitFor(() => expect(mocks.registerLiveActivity).toHaveBeenCalledTimes(2));

    expect(mocks.registerLiveActivity).toHaveBeenNthCalledWith(2, expect.objectContaining({
      token: "b".repeat(64),
      activityId: "activity-canonical-1",
      activeEntryId: entry.id
    }));
  });

  it("passes final canonical metadata to ActivityKit", async () => {
    const entry = canonicalEntry();
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(entry);

    expect(mocks.start).toHaveBeenCalledWith(
      "Stretching",
      entry.id,
      "https://dayframe-staging.vercel.app",
      "Health",
      "#1F845A",
      entry.startedAt
    );
  });

  it("cleans every active Activity before marking idle convergence complete", async () => {
    addActivity("activity-a", null);
    addActivity("activity-b", canonicalEntry().id);
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);

    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-a", "activity-b"]);
    expect(activities).toEqual([]);
    expect(mocks.registerLiveActivity).not.toHaveBeenCalled();
  });

  it("cleans an ActivityKit-active sibling whose content is no longer running", async () => {
    activities.push({
      activityId: "activity-stopped-but-active",
      entryId: canonicalEntry().id,
      isActive: true,
      isRunning: false
    });
    const { syncLiveActivityForEntry } = await loadModule();

    await syncLiveActivityForEntry(null);

    expect(mocks.cleanupActivities).toHaveBeenCalledWith(["activity-stopped-but-active"]);
    expect(activities).toEqual([]);
  });
});
