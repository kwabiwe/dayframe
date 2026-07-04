import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn()
  }
}));

vi.mock("./api", () => ({
  enqueueEvent: vi.fn()
}));

const {
  healthKitWorkoutEvent,
  mapHealthKitSleepSample,
  mapHealthKitWorkoutSample
} = await import("./health");

describe("HealthKit mapping", () => {
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
      startedAt: "2026-07-03T08:30:00.000Z",
      stoppedAt: "2026-07-03T09:10:00.000Z",
      durationSeconds: 2400,
      distanceMeters: 3200,
      energyKcal: 180,
      sourceName: "Apple Watch"
    });
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
    expect(event.description).toBe("Workout high intensity interval training");
    expect(event.rawPayload).toMatchObject({
      provider: "healthkit",
      externalSampleId: "workout-2",
      workoutType: "high_intensity_interval_training",
      durationSeconds: 1800
    });
    expect(JSON.stringify(event.rawPayload)).not.toContain("latitude");
    expect(JSON.stringify(event.rawPayload)).not.toContain("longitude");
  });
});
