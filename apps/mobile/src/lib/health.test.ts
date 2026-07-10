import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
const apiMocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn(),
  reprocessHealthReviewItems: vi.fn()
}));
const healthkitMocks = vi.hoisted(() => ({
  configureBackgroundTypes: vi.fn(() => Promise.resolve(true)),
  enableBackgroundDelivery: vi.fn(() => Promise.resolve(true)),
  isHealthDataAvailable: vi.fn(() => true),
  queryCategorySamplesWithAnchor: vi.fn(),
  queryWorkoutSamplesWithAnchor: vi.fn(),
  requestAuthorization: vi.fn(() => true),
  subscribeToChanges: vi.fn()
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      asyncStore.delete(key);
      return Promise.resolve();
    })
  }
}));

vi.mock("./api", () => ({
  enqueueEvent: apiMocks.enqueueEvent,
  reprocessHealthReviewItems: apiMocks.reprocessHealthReviewItems
}));

vi.mock("@kingstinct/react-native-healthkit", () => ({
  configureBackgroundTypes: healthkitMocks.configureBackgroundTypes,
  enableBackgroundDelivery: healthkitMocks.enableBackgroundDelivery,
  isHealthDataAvailable: healthkitMocks.isHealthDataAvailable,
  queryCategorySamplesWithAnchor: healthkitMocks.queryCategorySamplesWithAnchor,
  queryWorkoutSamplesWithAnchor: healthkitMocks.queryWorkoutSamplesWithAnchor,
  requestAuthorization: healthkitMocks.requestAuthorization,
  subscribeToChanges: healthkitMocks.subscribeToChanges
}));

const {
  getHealthAutoLogMappings,
  getHealthImportPreferences,
  getHealthWorkoutImportPreferences,
  groupSleepSamplesIntoSessions,
  healthKitSleepSessionEvent,
  healthKitWorkoutEvent,
  importHealthKitSleep,
  importHealthKitWorkouts,
  configureHealthKitAutomaticSync,
  mapHealthKitSleepSample,
  mapHealthKitWorkoutSample,
  exportHealthDebugSnapshot,
  isHealthKitAutomaticSyncEnabled,
  reprocessExistingHealthReviewItems,
  requestHealthKitPermissions,
  setHealthAutoLogMapping,
  setHealthImportPreference,
  startHealthKitChangeObservers
} = await import("./health");

describe("HealthKit mapping", () => {
  beforeEach(() => {
    asyncStore.clear();
    apiMocks.enqueueEvent.mockReset();
    apiMocks.reprocessHealthReviewItems.mockReset();
    healthkitMocks.configureBackgroundTypes.mockReset();
    healthkitMocks.configureBackgroundTypes.mockResolvedValue(true);
    healthkitMocks.enableBackgroundDelivery.mockReset();
    healthkitMocks.enableBackgroundDelivery.mockResolvedValue(true);
    healthkitMocks.isHealthDataAvailable.mockReset();
    healthkitMocks.isHealthDataAvailable.mockReturnValue(true);
    healthkitMocks.queryCategorySamplesWithAnchor.mockReset();
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockReset();
    healthkitMocks.requestAuthorization.mockReset();
    healthkitMocks.requestAuthorization.mockReturnValue(true);
    healthkitMocks.subscribeToChanges.mockReset();
    healthkitMocks.subscribeToChanges.mockImplementation(() => ({ remove: vi.fn() }));
  });

  it("maps sleep samples into Dayframe sleep segments", () => {
    const mapped = mapHealthKitSleepSample({
      uuid: "sleep-1",
      value: 3,
      startDate: "2026-07-03T22:00:00.000Z",
      endDate: "2026-07-04T06:00:00.000Z",
      sourceRevision: { source: { name: "Health" } }
    });

    expect(mapped).toMatchObject({
      externalSampleId: "sleep-1",
      stage: "asleep_core",
      startedAt: "2026-07-03T22:00:00.000Z",
      stoppedAt: "2026-07-04T06:00:00.000Z",
      sourceName: "Health"
    });
  });

  it("groups sleep phases into one user-facing sleep session", () => {
    const samples = [
      sleepSample("in-bed", "in_bed", "2026-07-06T22:30:00.000Z", "2026-07-06T23:55:00.000Z"),
      sleepSample("core", "asleep_core", "2026-07-06T23:55:00.000Z", "2026-07-07T02:15:00.000Z"),
      sleepSample("deep", "asleep_deep", "2026-07-07T02:15:00.000Z", "2026-07-07T03:10:00.000Z"),
      sleepSample("rem", "asleep_rem", "2026-07-07T03:10:00.000Z", "2026-07-07T06:27:00.000Z"),
      sleepSample("awake", "awake", "2026-07-07T06:27:00.000Z", "2026-07-07T06:40:00.000Z")
    ];

    const sessions = groupSleepSamplesIntoSessions(samples);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      startedAt: "2026-07-06T23:55:00.000Z",
      stoppedAt: "2026-07-07T06:27:00.000Z",
      samples: [
        expect.objectContaining({ externalSampleId: "core" }),
        expect.objectContaining({ externalSampleId: "deep" }),
        expect.objectContaining({ externalSampleId: "rem" })
      ]
    });
    expect(healthKitSleepSessionEvent(sessions[0])).toMatchObject({
      localId: expect.stringMatching(/^healthkit-sleep:sleep-session-/),
      description: "Sleep",
      rawPayload: {
        startedAt: "2026-07-06T23:55:00.000Z",
        stoppedAt: "2026-07-07T06:27:00.000Z",
        durationSeconds: 23520,
        autoConfirm: true,
        samples: expect.arrayContaining([
          expect.objectContaining({ sleepStage: "asleep_core" }),
          expect.objectContaining({ sleepStage: "asleep_deep" }),
          expect.objectContaining({ sleepStage: "asleep_rem" })
        ])
      }
    });
  });

  it("imports sleep phases as one queued sleep session", async () => {
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-1",
      samples: [
        { uuid: "core", value: 3, startDate: "2026-07-06T23:55:00.000Z", endDate: "2026-07-07T02:15:00.000Z" },
        { uuid: "deep", value: 4, startDate: "2026-07-07T02:15:00.000Z", endDate: "2026-07-07T03:10:00.000Z" },
        { uuid: "rem", value: 5, startDate: "2026-07-07T03:10:00.000Z", endDate: "2026-07-07T06:27:00.000Z" }
      ]
    });

    const result = await importHealthKitSleep();

    expect(result.importedCount).toBe(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Sleep",
        rawPayload: expect.objectContaining({
          startedAt: "2026-07-06T23:55:00.000Z",
          stoppedAt: "2026-07-07T06:27:00.000Z",
          autoConfirm: true,
          samples: expect.arrayContaining([
            expect.objectContaining({ externalSampleId: "core" }),
            expect.objectContaining({ externalSampleId: "deep" }),
            expect.objectContaining({ externalSampleId: "rem" })
          ])
        })
      })
    );
  });

  it("exports a bounded Health debug snapshot without advancing anchors or leaking routes", async () => {
    asyncStore.set("dayframe.healthkit.sleepAnchor.v1", "sleep-anchor-before");
    asyncStore.set("dayframe.healthkit.workoutAnchor.v1", "workout-anchor-before");
    asyncStore.set("dayframe.healthkit.sleepSeen.v1", JSON.stringify(["old-sleep"]));
    asyncStore.set("dayframe.healthkit.workoutSeen.v1", JSON.stringify(["old-workout"]));
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-after",
      deletedSamples: [],
      samples: [
        {
          uuid: "debug-core",
          value: 3,
          startDate: "2026-07-06T23:55:00.000Z",
          endDate: "2026-07-07T02:15:00.000Z",
          metadata: { latitude: 51.5, source: "debug" }
        },
        {
          uuid: "debug-rem",
          value: 5,
          startDate: "2026-07-07T02:15:00.000Z",
          endDate: "2026-07-07T06:27:00.000Z"
        }
      ]
    });
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-after",
      deletedSamples: [{ uuid: "deleted-workout" }],
      workouts: [
        {
          uuid: "debug-walk",
          workoutActivityType: 52,
          startDate: "2026-07-07T07:00:00.000Z",
          endDate: "2026-07-07T07:16:00.000Z",
          duration: 960,
          metadata: { route: [{ latitude: 51.5, longitude: -0.1 }], HKIndoorWorkout: false }
        }
      ]
    });

    const snapshot = await exportHealthDebugSnapshot({ lookbackDays: 7, limit: 50 });

    expect(healthkitMocks.queryCategorySamplesWithAnchor).toHaveBeenCalledWith(
      "HKCategoryTypeIdentifierSleepAnalysis",
      expect.objectContaining({
        filter: { date: expect.objectContaining({ startDate: expect.any(Date), endDate: expect.any(Date) }) },
        limit: 50
      })
    );
    expect(healthkitMocks.queryWorkoutSamplesWithAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { date: expect.objectContaining({ startDate: expect.any(Date), endDate: expect.any(Date) }) },
        limit: 50
      })
    );
    expect(snapshot.storedState).toMatchObject({
      sleepAnchorPresent: true,
      workoutAnchorPresent: true,
      sleepSeenCount: 1,
      workoutSeenCount: 1
    });
    expect(snapshot.healthKit.sleep).toMatchObject({
      sampleCount: 2,
      stageCounts: { asleep_core: 1, asleep_rem: 1 },
      sessions: [
        expect.objectContaining({
          sampleCount: 2,
          autoConfirm: true
        })
      ]
    });
    expect(snapshot.healthKit.workouts).toMatchObject({
      sampleCount: 1,
      deletedSampleCount: 1,
      typeCounts: { walking: 1 }
    });
    expect(snapshot.generatedEvents.workouts[0].rawPayload).toMatchObject({
      workoutType: "walking",
      autoConfirm: true
    });
    expect(JSON.stringify(snapshot)).not.toContain("latitude");
    expect(JSON.stringify(snapshot)).not.toContain("longitude");
    expect(asyncStore.get("dayframe.healthkit.sleepAnchor.v1")).toBe("sleep-anchor-before");
    expect(asyncStore.get("dayframe.healthkit.workoutAnchor.v1")).toBe("workout-anchor-before");
  });

  it("excludes disabled workout types from generated debug events", async () => {
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-debug",
      deletedSamples: [],
      samples: []
    });
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-debug",
      deletedSamples: [],
      workouts: [
        {
          uuid: "debug-strength",
          workoutActivityType: 50,
          startDate: "2026-07-07T11:00:00.000Z",
          endDate: "2026-07-07T12:00:00.000Z",
          duration: 3600
        },
        {
          uuid: "debug-walk",
          workoutActivityType: 52,
          startDate: "2026-07-07T07:00:00.000Z",
          endDate: "2026-07-07T07:16:00.000Z",
          duration: 960
        }
      ]
    });

    const snapshot = await exportHealthDebugSnapshot();

    expect(snapshot.healthKit.workouts).toMatchObject({
      sampleCount: 2,
      typeCounts: { strength_training: 1, walking: 1 }
    });
    expect(snapshot.generatedEvents.workouts.map((event) => event.rawPayload.workoutType)).toEqual([
      "walking"
    ]);
  });

  it("filters disabled sleep sessions before queueing Health events", async () => {
    await setHealthImportPreference("sleep", false);
    healthkitMocks.queryCategorySamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "sleep-anchor-disabled",
      samples: [
        { uuid: "core", value: 3, startDate: "2026-07-06T23:55:00.000Z", endDate: "2026-07-07T06:27:00.000Z" }
      ]
    });

    const result = await importHealthKitSleep();

    expect(result.importedCount).toBe(0);
    expect(result.notes).toContain("Ignored 1 disabled Apple Health sleep session");
    expect(apiMocks.enqueueEvent).not.toHaveBeenCalled();
  });

  it("marks short sleep sessions for review instead of auto-confirm", () => {
    const event = healthKitSleepSessionEvent({
      externalSessionId: "short-sleep",
      startedAt: "2026-07-07T04:00:00.000Z",
      stoppedAt: "2026-07-07T04:30:00.000Z",
      samples: [
        sleepSample("short-core", "asleep_core", "2026-07-07T04:00:00.000Z", "2026-07-07T04:30:00.000Z")
      ]
    });

    expect(event.rawPayload.durationSeconds).toBe(1800);
    expect(event.rawPayload.autoConfirm).toBe(false);
  });

  it("maps workout samples into summarized Dayframe workouts", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "workout-1",
      workoutActivityType: 52,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:10:00.000Z",
      duration: { quantity: 2400, unit: "s" },
      totalDistance: { quantity: 3200, unit: "m" },
      totalEnergyBurned: { quantity: 180, unit: "kcal" },
      sourceRevision: { source: { name: "Apple Watch" } },
      metadata: { HKIndoorWorkout: false }
    });

    expect(mapped).toMatchObject({
      externalSampleId: "workout-1",
      workoutType: "walking",
      workoutLabel: "Walk",
      startedAt: "2026-07-03T08:30:00.000Z",
      stoppedAt: "2026-07-03T09:10:00.000Z",
      durationSeconds: 2400,
      distanceMeters: 3200,
      energyKcal: 180,
      sourceName: "Apple Watch"
    });
  });

  it("maps strength workouts to friendly labels", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "strength-1",
      workoutActivityType: 50,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:10:00.000Z"
    });

    expect(mapped.workoutType).toBe("strength_training");
    expect(mapped.workoutLabel).toBe("Strength training");
    expect(healthKitWorkoutEvent(mapped).description).toBe("Strength training");
  });

  it("normalizes fractional workout durations to whole seconds", () => {
    const mapped = mapHealthKitWorkoutSample({
      uuid: "workout-decimal-duration",
      workoutActivityType: 52,
      startDate: "2026-07-03T08:30:00.000Z",
      endDate: "2026-07-03T09:34:18.123Z",
      duration: { quantity: 3858.122684240341, unit: "s" }
    });

    expect(mapped.durationSeconds).toBe(3858);
    expect(healthKitWorkoutEvent(mapped).rawPayload.durationSeconds).toBe(3858);
  });

  it("builds event-first workout payloads without route locations", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "workout-2",
        workoutActivityType: "highIntensityIntervalTraining",
        startDate: "2026-07-03T10:00:00.000Z",
        endDate: "2026-07-03T10:30:00.000Z",
        duration: 1800,
        metadata: { route: [{ latitude: 51.5, longitude: -0.1 }] }
      })
    );

    expect(event.source).toBe("health_workout");
    expect(event.type).toBe("health_workout_import");
    expect(event.description).toBe("Workout");
    expect(event.rawPayload).toMatchObject({
      provider: "healthkit",
      externalSampleId: "workout-2",
      workoutType: "other",
      durationSeconds: 1800,
      autoConfirm: false
    });
    expect(JSON.stringify(event.rawPayload)).not.toContain("latitude");
    expect(JSON.stringify(event.rawPayload)).not.toContain("longitude");
  });

  it("stores Health import preferences with sleep enabled and strength disabled by default", async () => {
    await expect(getHealthImportPreferences()).resolves.toMatchObject({
      cycling: true,
      running: true,
      sleep: true,
      strength_training: false,
      swimming: false,
      walking: true,
      other: false
    });

    const saved = await setHealthImportPreference("strength_training", true);

    expect(saved.strength_training).toBe(true);
    await expect(getHealthWorkoutImportPreferences()).resolves.toMatchObject({
      strength_training: true,
      swimming: false
    });
  });

  it("stores Health auto-log mappings for category and description defaults", async () => {
    await expect(getHealthAutoLogMappings()).resolves.toEqual({});

    const saved = await setHealthAutoLogMapping("walking", {
      categoryId: "category-fitness",
      description: "Morning walk"
    });

    expect(saved.walking).toEqual({
      categoryId: "category-fitness",
      description: "Morning walk"
    });
    await expect(getHealthAutoLogMappings()).resolves.toEqual(saved);
  });

  it("applies custom Health mappings to generated sleep and workout events", () => {
    const sleepEvent = healthKitSleepSessionEvent(
      {
        externalSessionId: "mapped-sleep",
        startedAt: "2026-07-07T00:00:00.000Z",
        stoppedAt: "2026-07-07T07:00:00.000Z",
        samples: [
          sleepSample("mapped-core", "asleep_core", "2026-07-07T00:00:00.000Z", "2026-07-07T07:00:00.000Z")
        ]
      },
      {
        categoryId: "category-rest",
        description: "Overnight sleep"
      }
    );
    const workoutEvent = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "mapped-walk",
        workoutActivityType: 52,
        startDate: "2026-07-07T08:00:00.000Z",
        endDate: "2026-07-07T08:30:00.000Z"
      }),
      {
        categoryId: "category-fitness",
        description: "Morning walk"
      }
    );

    expect(sleepEvent).toMatchObject({
      categoryId: "category-rest",
      description: "Overnight sleep"
    });
    expect(workoutEvent).toMatchObject({
      categoryId: "category-fitness",
      description: "Morning walk"
    });
  });

  it("enables automatic sleep and workout sync after Health permission is granted", async () => {
    const permission = await requestHealthKitPermissions();

    expect(permission.status).toBe("available");
    expect(healthkitMocks.configureBackgroundTypes).toHaveBeenCalledWith(
      ["HKCategoryTypeIdentifierSleepAnalysis", "HKWorkoutTypeIdentifier"],
      1
    );
    expect(healthkitMocks.enableBackgroundDelivery).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", 1);
    expect(healthkitMocks.enableBackgroundDelivery).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", 1);
    await expect(isHealthKitAutomaticSyncEnabled()).resolves.toBe(true);
  });

  it("does not mark automatic sync enabled when HealthKit background delivery is unavailable", async () => {
    healthkitMocks.enableBackgroundDelivery.mockResolvedValue(false);

    await expect(configureHealthKitAutomaticSync()).resolves.toBe(false);
    await expect(isHealthKitAutomaticSyncEnabled()).resolves.toBe(false);
  });

  it("subscribes to HealthKit sleep and workout changes only after automatic sync is enabled", async () => {
    await expect(startHealthKitChangeObservers(vi.fn())).resolves.toBeNull();

    await configureHealthKitAutomaticSync();
    const onChange = vi.fn();
    const subscription = await startHealthKitChangeObservers(onChange);
    const sleepCallback = healthkitMocks.subscribeToChanges.mock.calls[0][1];

    expect(healthkitMocks.subscribeToChanges).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", expect.any(Function));
    expect(healthkitMocks.subscribeToChanges).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", expect.any(Function));

    sleepCallback({ errorMessage: undefined });
    expect(onChange).toHaveBeenCalledWith("HKCategoryTypeIdentifierSleepAnalysis", undefined);
    subscription?.remove();
  });

  it("reprocesses existing Health review items with saved preferences", async () => {
    apiMocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      ok: true,
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 0,
      skippedCount: 0,
      failedCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0,
      errorSummary: []
    });

    await setHealthImportPreference("walking", true);
    await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sleep: true,
        walking: true,
        strength_training: false,
        swimming: false
      }),
      { limit: 25, force: true, mappings: {} }
    );
  });

  it("reprocesses existing Health review items with saved mappings", async () => {
    apiMocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      ok: true,
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 0,
      skippedCount: 0,
      failedCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0,
      errorSummary: []
    });

    await setHealthAutoLogMapping("walking", {
      categoryId: "category-fitness",
      description: "Morning walk"
    });
    await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      expect.objectContaining({ walking: true }),
      {
        limit: 25,
        force: true,
        mappings: {
          walking: {
            categoryId: "category-fitness",
            description: "Morning walk"
          }
        }
      }
    );
  });

  it("drains partial Health review reprocess batches during one refresh", async () => {
    apiMocks.reprocessHealthReviewItems
      .mockResolvedValueOnce({
        ok: true,
        checkedCount: 25,
        confirmedCount: 25,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 25,
        remainingReviewCount: 88,
        batchSize: 25,
        partial: true,
        hasMore: true,
        errorSummary: []
      })
      .mockResolvedValueOnce({
        ok: true,
        checkedCount: 8,
        confirmedCount: 8,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 8,
        remainingReviewCount: 0,
        batchSize: 25,
        partial: false,
        hasMore: false,
        errorSummary: []
      });

    const result = await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledTimes(2);
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ walking: true }),
      { limit: 25, force: true, mappings: {} }
    );
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ walking: true }),
      { limit: 25, force: true, mappings: {} }
    );
    expect(result).toMatchObject({
      checkedCount: 33,
      confirmedCount: 33,
      updatedCategoryCount: 33,
      remainingReviewCount: 0,
      partial: false,
      hasMore: false
    });
  });

  it("keeps background Health review reprocess failures non-fatal", async () => {
    apiMocks.reprocessHealthReviewItems.mockRejectedValueOnce(new Error("Unable to reprocess Health review items: 500"));

    const result = await reprocessExistingHealthReviewItems(undefined, { force: true });

    expect(result).toMatchObject({
      ok: false,
      failedCount: 1,
      errorSummary: ["Unable to reprocess Health review items: 500"]
    });
    await expect(reprocessExistingHealthReviewItems()).resolves.toMatchObject({
      ok: true,
      checkedCount: 0,
      errorSummary: ["Backoff active."]
    });
    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledTimes(1);
  });

  it("filters disabled workout types before queueing Health events", async () => {
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      newAnchor: "workout-anchor-1",
      workouts: [
        {
          uuid: "walk-1",
          workoutActivityType: 52,
          startDate: "2026-07-03T08:30:00.000Z",
          endDate: "2026-07-03T09:00:00.000Z",
          duration: 1800
        },
        {
          uuid: "strength-1",
          workoutActivityType: 50,
          startDate: "2026-07-03T10:00:00.000Z",
          endDate: "2026-07-03T10:45:00.000Z",
          duration: 2700
        }
      ]
    });

    const result = await importHealthKitWorkouts();

    expect(result.importedCount).toBe(1);
    expect(result.notes).toContain("Ignored 1 disabled workout");
    expect(apiMocks.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: "healthkit-workout:walk-1",
        description: "Walk",
        rawPayload: expect.objectContaining({
          autoConfirm: true,
          workoutType: "walking"
        })
      })
    );
  });

  it("marks short workouts for review instead of auto-confirm", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "short-walk",
        workoutActivityType: 52,
        startDate: "2026-07-03T08:30:00.000Z",
        endDate: "2026-07-03T08:32:00.000Z",
        duration: 120
      })
    );

    expect(event.rawPayload.autoConfirm).toBe(false);
  });

  it("auto-confirms five-minute walks", () => {
    const event = healthKitWorkoutEvent(
      mapHealthKitWorkoutSample({
        uuid: "five-minute-walk",
        workoutActivityType: 52,
        startDate: "2026-07-03T08:30:00.000Z",
        endDate: "2026-07-03T08:35:00.000Z",
        duration: 300
      })
    );

    expect(event.rawPayload).toMatchObject({
      autoConfirm: true,
      workoutType: "walking"
    });
  });
});

function sleepSample(
  externalSampleId: string,
  stage: "in_bed" | "asleep_core" | "asleep_deep" | "asleep_rem" | "awake",
  startedAt: string,
  stoppedAt: string
) {
  return {
    externalSampleId,
    stage,
    startedAt,
    stoppedAt,
    sourceName: "Apple Watch",
    rawPayload: { uuid: externalSampleId }
  };
}
