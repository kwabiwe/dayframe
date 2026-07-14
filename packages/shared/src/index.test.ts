import { describe, expect, it } from "vitest";
import {
  applyActivityEvent,
  automationRuleInputFromDraft,
  calendarBlockContinuationEdges,
  classifyLocationLearningEvidence,
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

describe("location learning classification", () => {
  it("ignores a weak pass-through cluster", () => {
    expect(classifyLocationLearningEvidence({
      visitCount: 1,
      distinctDays: 1,
      sampleCount: 3,
      totalDwellMs: 12 * 60_000,
      longestDwellMs: 12 * 60_000,
      currentDwellMs: 12 * 60_000,
      currentVisitSampleCount: 3,
      averageAccuracyMeters: 35,
      maxClusterSpreadMeters: 45
    })).toMatchObject({ kind: "noise", confidence: "hint" });
  });

  it("classifies a single long dwell as a one-off activity", () => {
    expect(classifyLocationLearningEvidence({
      visitCount: 1,
      distinctDays: 1,
      sampleCount: 5,
      totalDwellMs: 75 * 60_000,
      longestDwellMs: 75 * 60_000,
      currentDwellMs: 75 * 60_000,
      currentVisitSampleCount: 5,
      averageAccuracyMeters: 30,
      maxClusterSpreadMeters: 35
    })).toMatchObject({ kind: "one_off_activity", confidence: "low" });
  });

  it("classifies repeated stable visits as a saveable place candidate", () => {
    expect(classifyLocationLearningEvidence({
      visitCount: 2,
      distinctDays: 2,
      sampleCount: 6,
      totalDwellMs: 49 * 60_000,
      longestDwellMs: 25 * 60_000,
      currentDwellMs: 25 * 60_000,
      currentVisitSampleCount: 3,
      averageAccuracyMeters: 35,
      maxClusterSpreadMeters: 40
    })).toMatchObject({ kind: "place_candidate", confidence: "medium" });
  });

  it("never classifies one visit as a regular place", () => {
    expect(classifyLocationLearningEvidence({
      visitCount: 1,
      distinctDays: 1,
      sampleCount: 10,
      totalDwellMs: 4 * 60 * 60_000,
      longestDwellMs: 4 * 60 * 60_000,
      currentDwellMs: 4 * 60 * 60_000,
      currentVisitSampleCount: 10,
      averageAccuracyMeters: 20,
      maxClusterSpreadMeters: 20
    }).kind).toBe("one_off_activity");
  });
});

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

describe("commute learning normalization", () => {
  const commuteContext: NormalizationContext = {
    projects: [],
    categories: [{ id: categoryId("commute"), name: "Commute" }],
    places: [
      {
        id: placeId("home"),
        name: "Home",
        radiusMeters: 100,
        priority: 10,
        defaultProjectId: null,
        defaultCategoryId: null,
        defaultActivityDescription: null,
        autoStart: false
      },
      {
        id: placeId("work"),
        name: "Work",
        radiusMeters: 120,
        priority: 8,
        defaultProjectId: null,
        defaultCategoryId: null,
        defaultActivityDescription: null,
        autoStart: false
      }
    ],
    automationRules: []
  };

  it("auto-logs clean saved-place to saved-place commutes", () => {
    const event = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-07-13T08:25:00.000Z"),
        rawPayload: {
          fromPlaceId: placeId("home"),
          fromPlaceName: "Home",
          toPlaceId: placeId("work"),
          toPlaceName: "Work",
          startedAt: "2026-07-13T08:00:00.000Z",
          stoppedAt: "2026-07-13T08:25:00.000Z",
          reviewFirst: false
        }
      },
      commuteContext
    );

    expect(event).toEqual(
      expect.objectContaining({
        action: "create_time_entry",
        reviewStatus: "confirmed",
        confidence: "medium_high",
        categoryId: categoryId("commute"),
        title: "Commute"
      })
    );
  });

  it("keeps uncertain commute endpoints review-first", () => {
    const event = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-07-13T08:25:00.000Z"),
        rawPayload: {
          fromPlaceId: placeId("home"),
          fromPlaceName: "Home",
          toPlaceName: "Near Springfield Road",
          startedAt: "2026-07-13T08:00:00.000Z",
          stoppedAt: "2026-07-13T08:25:00.000Z",
          reviewFirst: true
        }
      },
      commuteContext
    );

    expect(event).toEqual(
      expect.objectContaining({
        action: "create_review_item",
        reviewStatus: "needs_review",
        confidence: "medium",
        categoryId: categoryId("commute"),
        title: "Possible commute from Home to Near Springfield Road"
      })
    );
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

  it("turns a supported draft into a review-first saved rule input", () => {
    const draft = draftAutomationRuleFromText({
      text: "If I drive to Chelmsford rail station and come back home shortly after, log it as picking up or dropping my wife.",
      categories: [{ id: categoryId("family"), name: "Family" }],
      places: [{ id: "place-station", name: "Chelmsford Station" }]
    });

    const savePlan = automationRuleInputFromDraft({
      draft,
      categories: [{ id: categoryId("family"), name: "Family" }],
      places: [{ id: "place-station", name: "Chelmsford Station" }]
    });

    expect(savePlan.blockers).toEqual([]);
    expect(savePlan.values).toMatchObject({
      name: "Chelmsford Station pickup/drop-off",
      triggerSource: "geofence_specific",
      triggerType: "geofence_exit",
      placeId: "place-station",
      action: "create_review_item",
      categoryId: categoryId("family"),
      activityDescription: "Train station pickup/drop-off",
      confidenceThreshold: "medium_high"
    });
    expect(savePlan.notes.join(" ")).toMatch(/review-first/i);
  });

  it("blocks saving drafts that do not resolve to a saved place", () => {
    const draft = draftAutomationRuleFromText({
      text: "When I leave the gym, log a workout.",
      categories: [{ id: categoryId("gym"), name: "Gym" }],
      places: []
    });

    const savePlan = automationRuleInputFromDraft({
      draft,
      categories: [{ id: categoryId("gym"), name: "Gym" }],
      places: []
    });

    expect(savePlan.values).toBeUndefined();
    expect(savePlan.blockers.join(" ")).toMatch(/saved place/i);
  });

  it("does not replace an unresolved named category with the place default", () => {
    const draft = draftAutomationRuleFromText({
      text: "When I leave the train station after pickup my wife, log it.",
      categories: [],
      places: [{ id: "place-station", name: "Train Station" }]
    });

    const savePlan = automationRuleInputFromDraft({
      draft,
      categories: [],
      places: [
        {
          id: "place-station",
          name: "Train Station",
          defaultCategoryId: categoryId("travel")
        }
      ]
    });

    expect(savePlan.values).toBeUndefined();
    expect(savePlan.blockers.join(" ")).toMatch(/Add "Family" as a category/);
  });

  it("saves broad-place rules with a broad geofence source", () => {
    const draft = draftAutomationRuleFromText({
      text: "When I leave the town centre, log errands.",
      categories: [{ id: categoryId("errands"), name: "Errands" }],
      places: [{ id: placeId("town"), name: "Town Centre" }]
    });

    const savePlan = automationRuleInputFromDraft({
      draft,
      categories: [{ id: categoryId("errands"), name: "Errands" }],
      places: [{ id: placeId("town"), name: "Town Centre", radiusMeters: 500 }]
    });

    expect(savePlan.values).toMatchObject({
      placeId: placeId("town"),
      triggerSource: "geofence_broad",
      triggerType: "geofence_exit"
    });
  });

  it("prefers the longest saved place name when drafting from text", () => {
    const draft = draftAutomationRuleFromText({
      text: "When I leave Home Office, log focused work.",
      categories: [{ id: categoryId("focus"), name: "Focus" }],
      places: [
        { id: placeId("home"), name: "Home" },
        { id: placeId("home-office"), name: "Home Office" }
      ]
    });

    expect(draft.placeName).toBe("Home Office");
  });
});

describe("automation rule normalization", () => {
  it("uses saved natural-language rule descriptions for place-exit review items", () => {
    const event = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_exit",
        occurredAt: new Date("2026-07-12T09:30:00.000Z"),
        placeId: placeId("station"),
        rawPayload: {}
      },
      {
        projects: [],
        categories: [{ id: categoryId("family"), name: "Family" }],
        places: [
          {
            id: placeId("station"),
            name: "Chelmsford Station",
            radiusMeters: 100,
            priority: 5,
            defaultProjectId: null,
            defaultCategoryId: null,
            defaultActivityDescription: null,
            autoStart: false
          }
        ],
        automationRules: [
          {
            id: "rule-station",
            name: "Chelmsford Station pickup/drop-off",
            triggerSource: "geofence_specific",
            triggerType: "geofence_exit",
            placeId: placeId("station"),
            action: "create_review_item",
            projectId: null,
            categoryId: categoryId("family"),
            activityDescription: "Train station pickup/drop-off",
            enabled: true
          }
        ]
      }
    );

    expect(event).toEqual(
      expect.objectContaining({
        action: "create_review_item",
        reviewStatus: "needs_review",
        title: "Train station pickup/drop-off",
        categoryId: categoryId("family")
      })
    );
  });
});

function categoryId(seed: string) {
  const suffix =
    seed === "focus"
      ? "0001"
      : seed === "health"
        ? "0003"
        : seed === "family"
          ? "0004"
          : seed === "travel" || seed === "commute"
            ? "0005"
            : seed === "errands"
              ? "0006"
              : "0002";
  return `20000000-0000-4000-8000-00000000${suffix}`;
}

function placeId(seed: string) {
  const suffix =
    seed === "station"
      ? "0007"
      : seed === "home-office"
        ? "0008"
        : seed === "town"
          ? "0009"
          : seed === "home"
            ? "0010"
            : seed === "work"
              ? "0011"
              : "0001";
  return `30000000-0000-4000-8000-00000000${suffix}`;
}
