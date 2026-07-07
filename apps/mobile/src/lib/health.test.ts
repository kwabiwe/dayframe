import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());
const apiMocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn(),
  reprocessHealthReviewItems: vi.fn()
}));
const healthkitMocks = vi.hoisted(() => ({
  isHealthDataAvailable: vi.fn(() => true),
  queryCategorySamplesWithAnchor: vi.fn(),
  queryWorkoutSamplesWithAnchor: vi.fn(),
  requestAuthorization: vi.fn(() => true)
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
    })
  }
}));

vi.mock("./api", () => ({
  enqueueEvent: apiMocks.enqueueEvent,
  reprocessHealthReviewItems: apiMocks.reprocessHealthReviewItems
}));

vi.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: healthkitMocks.isHealthDataAvailable,
  queryCategorySamplesWithAnchor: healthkitMocks.queryCategorySamplesWithAnchor,
  queryWorkoutSamplesWithAnchor: healthkitMocks.queryWorkoutSamplesWithAnchor,
  requestAuthorization: healthkitMocks.requestAuthorization
}));

const {
  getHealthImportPreferences,
  getHealthWorkoutImportPreferences,
  groupSleepSamplesIntoSessions,
  healthKitSleepSessionEvent,
  healthKitWorkoutEvent,
  importHealthKitSleep,
  importHealthKitWorkouts,
  mapHealthKitSleepSample,
  mapHealthKitWorkoutSample,
  reprocessExistingHealthReviewItems,
  setHealthImportPreference
} = await import("./health");

describe("HealthKit mapping", () => {
  beforeEach(() => {
    asyncStore.clear();
    apiMocks.enqueueEvent.mockReset();
    apiMocks.reprocessHealthReviewItems.mockReset();
    healthkitMocks.queryCategorySamplesWithAnchor.mockReset();
    healthkitMocks.queryWorkoutSamplesWithAnchor.mockReset();
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

  it("reprocesses existing Health review items with saved preferences", async () => {
    apiMocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      ok: true,
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0
    });

    await setHealthImportPreference("walking", true);
    await reprocessExistingHealthReviewItems();

    expect(apiMocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sleep: true,
        walking: true,
        strength_training: false,
        swimming: false
      })
    );
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
