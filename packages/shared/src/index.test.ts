import { describe, expect, it } from "vitest";
import {
  applyActivityEvent,
  healthWorkoutLabel,
  normalizeHealthWorkoutType,
  shouldAutoConfirmHealthSleep,
  shouldAutoConfirmHealthWorkout,
  type NormalizationContext,
  type TimelineState
} from "./index";

const context: NormalizationContext = {
  projects: [],
  categories: [{ id: categoryId("focus"), name: "Focus" }],
  places: [],
  automationRules: []
};

describe("category-first timer events", () => {
  it("closes the current active timer before starting a new explicit category timer", () => {
    const startedAt = new Date("2026-07-04T08:00:00.000Z");
    const switchAt = new Date("2026-07-04T09:15:00.000Z");
    const initial: TimelineState = {
      activeEntry: {
        id: "entry-active",
        categoryId: categoryId("admin"),
        source: "manual_app",
        confidence: "high",
        startedAt,
        description: "Admin"
      },
      completedEntries: [],
      reviewItems: []
    };

    const next = applyActivityEvent(
      initial,
      {
        source: "mobile_app",
        type: "timer_start",
        occurredAt: switchAt,
        categoryId: categoryId("focus"),
        description: "Write notes"
      },
      context
    );

    expect(next.completedEntries).toEqual([
      expect.objectContaining({
        id: "entry-active",
        stoppedAt: switchAt
      })
    ]);
    expect(next.activeEntry).toEqual(
      expect.objectContaining({
        categoryId: categoryId("focus"),
        description: "Write notes",
        startedAt: switchAt
      })
    );
  });
});

describe("HealthKit workout helpers", () => {
  it("maps common HealthKit workout types to friendly activity labels", () => {
    expect(normalizeHealthWorkoutType(52)).toBe("walking");
    expect(healthWorkoutLabel(52)).toBe("Walk");
    expect(healthWorkoutLabel(37)).toBe("Run");
    expect(healthWorkoutLabel(13)).toBe("Cycling");
    expect(healthWorkoutLabel(46)).toBe("Swimming");
    expect(normalizeHealthWorkoutType(50)).toBe("strength_training");
    expect(normalizeHealthWorkoutType("traditionalStrengthTraining")).toBe("strength_training");
    expect(healthWorkoutLabel("traditionalStrengthTraining")).toBe("Strength training");
    expect(healthWorkoutLabel("workout_999")).toBe("Workout");
  });

  it("only auto-confirms sufficiently long known workout types", () => {
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "walking", durationSeconds: 20 * 60 })).toBe(true);
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "walking", durationSeconds: 2 * 60 })).toBe(false);
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "strength_training", durationSeconds: 5 * 60 })).toBe(false);
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "other", durationSeconds: 60 * 60 })).toBe(false);
  });

  it("only auto-confirms plausible Health sleep sessions", () => {
    expect(shouldAutoConfirmHealthSleep({ durationSeconds: 7 * 60 * 60 })).toBe(true);
    expect(shouldAutoConfirmHealthSleep({ durationSeconds: 45 * 60 })).toBe(false);
    expect(shouldAutoConfirmHealthSleep({ durationSeconds: 16 * 60 * 60 })).toBe(false);
  });

  it("applies high-confidence Health sleep as completed entries", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "health_sleep",
        type: "health_sleep_import",
        occurredAt: new Date("2026-07-06T23:55:00.000Z"),
        description: "Sleep",
        rawPayload: {
          autoConfirm: true,
          startedAt: "2026-07-06T23:55:00.000Z",
          stoppedAt: "2026-07-07T06:27:00.000Z",
          durationSeconds: 23520
        }
      },
      {
        ...context,
        categories: [{ id: categoryId("health"), name: "Health" }]
      }
    );

    expect(next.reviewItems).toHaveLength(0);
    expect(next.completedEntries).toEqual([
      expect.objectContaining({
        categoryId: categoryId("health"),
        description: "Sleep",
        startedAt: new Date("2026-07-06T23:55:00.000Z"),
        stoppedAt: new Date("2026-07-07T06:27:00.000Z")
      })
    ]);
  });

  it("keeps suspicious Health sleep in review", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "health_sleep",
        type: "health_sleep_import",
        occurredAt: new Date("2026-07-07T04:00:00.000Z"),
        description: "Sleep",
        rawPayload: {
          autoConfirm: true,
          startedAt: "2026-07-07T04:00:00.000Z",
          stoppedAt: "2026-07-07T04:30:00.000Z",
          durationSeconds: 1800
        }
      },
      {
        ...context,
        categories: [{ id: categoryId("health"), name: "Health" }]
      }
    );

    expect(next.completedEntries).toHaveLength(0);
    expect(next.reviewItems).toEqual([
      expect.objectContaining({
        categoryId: categoryId("health"),
        title: "Sleep"
      })
    ]);
  });

  it("applies high-confidence Health workouts as completed entries", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "health_workout",
        type: "health_workout_import",
        occurredAt: new Date("2026-07-07T07:00:00.000Z"),
        description: "Walk",
        rawPayload: {
          autoConfirm: true,
          workoutType: "walking",
          startedAt: "2026-07-07T07:00:00.000Z",
          stoppedAt: "2026-07-07T07:30:00.000Z",
          durationSeconds: 1800
        }
      },
      {
        ...context,
        categories: [{ id: categoryId("health"), name: "Health" }]
      }
    );

    expect(next.reviewItems).toHaveLength(0);
    expect(next.completedEntries).toEqual([
      expect.objectContaining({
        categoryId: categoryId("health"),
        description: "Walk",
        startedAt: new Date("2026-07-07T07:00:00.000Z"),
        stoppedAt: new Date("2026-07-07T07:30:00.000Z")
      })
    ]);
  });
});

function categoryId(seed: string) {
  const suffix = seed === "focus" ? "0001" : seed === "health" ? "0003" : "0002";
  return `20000000-0000-4000-8000-00000000${suffix}`;
}
