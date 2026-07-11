import { describe, expect, it } from "vitest";
import {
  applyActivityEvent,
  calendarBlockContinuationEdges,
  draftAutomationRuleFromText,
  healthAutoLogMappingFor,
  healthWorkoutLabel,
  normalizeActivityEvent,
  normalizeHealthAutoLogMappings,
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
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "walking", durationSeconds: 5 * 60 })).toBe(true);
    expect(shouldAutoConfirmHealthWorkout({ workoutType: "walking", durationSeconds: 4 * 60 })).toBe(false);
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
        categories: [{ id: categoryId("sleep"), name: "Sleep" }]
      }
    );

    expect(next.reviewItems).toHaveLength(0);
    expect(next.completedEntries).toEqual([
      expect.objectContaining({
        categoryId: categoryId("sleep"),
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
        categories: [{ id: categoryId("sleep"), name: "Sleep" }]
      }
    );

    expect(next.completedEntries).toHaveLength(0);
    expect(next.reviewItems).toEqual([
      expect.objectContaining({
        categoryId: categoryId("sleep"),
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

  it("infers legacy Health workout labels before auto-confirming", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "health_workout",
        type: "health_workout_import",
        occurredAt: new Date("2026-07-07T07:00:00.000Z"),
        description: "Walk",
        rawPayload: {
          autoConfirm: true,
          workoutLabel: "Walk",
          startedAt: "2026-07-07T07:00:00.000Z",
          stoppedAt: "2026-07-07T07:05:00.000Z",
          durationSeconds: 5 * 60
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
        description: "Walk"
      })
    ]);
  });
});

describe("calendar continuation helpers", () => {
  it("marks a visible segment that started before the selected day", () => {
    expect(
      calendarBlockContinuationEdges({
        startedAt: "2026-07-09T22:30:00.000Z",
        stoppedAt: "2026-07-10T06:45:00.000Z",
        dayStart: "2026-07-10T00:00:00.000Z",
        dayEnd: "2026-07-11T00:00:00.000Z"
      })
    ).toEqual({
      startsBeforeDay: true,
      continuesIntoNextDay: false
    });
  });

  it("marks a visible segment that continues into the following day", () => {
    expect(
      calendarBlockContinuationEdges({
        startedAt: "2026-07-10T21:30:00.000Z",
        stoppedAt: "2026-07-11T05:45:00.000Z",
        dayStart: "2026-07-10T00:00:00.000Z",
        dayEnd: "2026-07-11T00:00:00.000Z"
      })
    ).toEqual({
      startsBeforeDay: false,
      continuesIntoNextDay: true
    });
  });
});

describe("Health auto-log mappings", () => {
  it("keeps known Health mapping values and drops unknown keys", () => {
    const mappings = normalizeHealthAutoLogMappings({
      sleep: {
        categoryId: "category-sleep",
        description: "  Rest  "
      },
      walking: {
        categoryId: "",
        description: "Morning walk"
      },
      commute: {
        categoryId: "ignored",
        description: "ignored"
      }
    });

    expect(mappings).toEqual({
      sleep: {
        categoryId: "category-sleep",
        description: "Rest"
      },
      walking: {
        categoryId: null,
        description: "Morning walk"
      }
    });
    expect(healthAutoLogMappingFor("sleep", mappings)).toEqual({
      categoryId: "category-sleep",
      description: "Rest"
    });
    expect(healthAutoLogMappingFor("running", mappings)).toEqual({});
  });
});

describe("explicit Shortcut starts", () => {
  it("keeps blank Shortcut starts uncategorized without applying source defaults", () => {
    const started = normalizeActivityEvent(
      {
        source: "shortcut",
        type: "shortcut_action",
        occurredAt: new Date("2026-07-11T08:00:00.000Z")
      },
      context
    );

    expect(started).toEqual(
      expect.objectContaining({
        action: "start_timer",
        categoryId: undefined,
        title: "Timer started",
        description: undefined
      })
    );
  });

  it("resolves human Shortcut category names from the event payload", () => {
    const event = normalizeActivityEvent(
      {
        source: "shortcut",
        type: "shortcut_action",
        occurredAt: new Date("2026-07-11T08:00:00.000Z"),
        description: "Write notes",
        rawPayload: { category: "Focus" }
      },
      context
    );

    expect(event).toEqual(
      expect.objectContaining({
        categoryId: categoryId("focus"),
        title: "Write notes",
        description: "Write notes"
      })
    );
  });
});

describe("automation rule drafting", () => {
  it("drafts a station pickup rule as a guarded round trip", () => {
    const draft = draftAutomationRuleFromText({
      text: "If I drive to Chelmsford rail station and come back home shortly after, log it as picking up or dropping my wife.",
      categories: [{ id: categoryId("family"), name: "Family" }],
      places: [{ id: "place-station", name: "Chelmsford Station" }]
    });

    expect(draft).toMatchObject({
      kind: "round_trip_place_visit",
      title: "Chelmsford Station pickup/drop-off",
      placeName: "Chelmsford Station",
      outcome: {
        categoryName: "Family",
        description: "Train station pickup/drop-off",
        mode: "auto_log_when_matched"
      }
    });
    expect(draft.conditions).toEqual(expect.arrayContaining([
      "Trip starts at Home and returns to Home.",
      "No onward commute place appears before returning home."
    ]));
    expect(draft.simulationChecks.join(" ")).toMatch(/rejection reason/i);
  });

  it("keeps unknown rule drafts review-first", () => {
    const draft = draftAutomationRuleFromText({
      text: "When something unusual happens, ask me later."
    });

    expect(draft.kind).toBe("review_first_custom_rule");
    expect(draft.outcome.mode).toBe("review_first");
    expect(draft.unsupported[0]).toMatch(/more detail/i);
  });
});

function categoryId(seed: string) {
  const suffix = seed === "focus" ? "0001" : seed === "health" ? "0003" : seed === "family" ? "0004" : "0002";
  return `20000000-0000-4000-8000-00000000${suffix}`;
}
