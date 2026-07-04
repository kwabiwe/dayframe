import { describe, expect, it } from "vitest";
import {
  applyActivityEvent,
  mapHealthKitSleepStage,
  mapTogglTimeEntry,
  normalizeActivityEvent,
  type NormalizationContext,
  type TimelineState
} from "../src";

const ids = {
  deepWork: "10000000-0000-4000-8000-000000000001",
  gym: "10000000-0000-4000-8000-000000000004",
  work: "20000000-0000-4000-8000-000000000001",
  health: "20000000-0000-4000-8000-000000000004",
  home: "30000000-0000-4000-8000-000000000001",
  gymPlace: "30000000-0000-4000-8000-000000000003",
  town: "30000000-0000-4000-8000-000000000005",
  gymRule: "40000000-0000-4000-8000-000000000001"
};

const context: NormalizationContext = {
  projects: [
    { id: ids.deepWork, name: "Deep Work", categoryId: ids.work },
    { id: ids.gym, name: "Gym", categoryId: ids.health }
  ],
  categories: [
    { id: ids.work, name: "Work" },
    { id: ids.health, name: "Health" }
  ],
  places: [
    { id: ids.home, name: "Home", radiusMeters: 120, priority: 5, autoStart: false },
    {
      id: ids.gymPlace,
      name: "Gym",
      radiusMeters: 80,
      priority: 8,
      defaultProjectId: ids.gym,
      defaultCategoryId: ids.health,
      autoStart: false
    },
    { id: ids.town, name: "Town Centre", radiusMeters: 700, priority: 1, autoStart: false }
  ],
  automationRules: [
    {
      id: ids.gymRule,
      name: "Gym suggestion",
      triggerSource: "geofence_specific",
      triggerType: "geofence_enter",
      placeId: ids.gymPlace,
      action: "suggest_timer",
      projectId: ids.gym,
      categoryId: ids.health,
      enabled: true
    }
  ]
};

describe("event normalization", () => {
  it("closes the previous active timer when a new explicit activity starts", () => {
    const initial: TimelineState = { completedEntries: [], reviewItems: [] };
    const first = applyActivityEvent(
      initial,
      {
        source: "manual_app",
        type: "timer_start",
        occurredAt: new Date("2026-06-20T08:00:00Z"),
        projectId: ids.deepWork
      },
      context
    );
    const second = applyActivityEvent(
      first,
      {
        source: "mobile_app",
        type: "quick_action",
        occurredAt: new Date("2026-06-20T09:15:00Z"),
        projectId: ids.gym,
        categoryId: ids.health
      },
      context
    );

    expect(second.completedEntries).toHaveLength(1);
    expect(second.completedEntries[0].projectId).toBe(ids.deepWork);
    expect(second.completedEntries[0].stoppedAt?.toISOString()).toBe("2026-06-20T09:15:00.000Z");
    expect(second.activeEntry?.projectId).toBe(ids.gym);
  });

  it("routes broad geofence signals to review", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_broad",
        type: "geofence_enter",
        occurredAt: new Date("2026-06-20T12:00:00Z"),
        placeId: ids.town,
        rawPayload: { isBroad: true }
      },
      context
    );

    expect(candidate.action).toBe("create_review_item");
    expect(candidate.reviewStatus).toBe("needs_review");
    expect(candidate.confidence).toBe("low");
  });

  it("routes specific geofence exits to review unless an explicit stop rule exists", () => {
    const reviewCandidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_exit",
        occurredAt: new Date("2026-06-20T13:00:00Z"),
        placeId: ids.gymPlace
      },
      context
    );
    expect(reviewCandidate.action).toBe("create_review_item");
    expect(reviewCandidate.reviewStatus).toBe("needs_review");

    const stopCandidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_exit",
        occurredAt: new Date("2026-06-20T14:00:00Z"),
        placeId: ids.gymPlace
      },
      {
        ...context,
        automationRules: [
          {
            id: "40000000-0000-4000-8000-000000000010",
            name: "Leave Gym -> stop",
            triggerSource: "geofence_specific",
            triggerType: "geofence_exit",
            placeId: ids.gymPlace,
            action: "stop_timer",
            projectId: ids.gym,
            categoryId: ids.health,
            enabled: true
          }
        ]
      }
    );

    expect(stopCandidate.action).toBe("stop_timer");
    expect(stopCandidate.reviewStatus).toBe("confirmed");
  });

  it("suppresses review items when an ignore source rule matches", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_broad",
        type: "geofence_enter",
        occurredAt: new Date("2026-06-20T12:00:00Z"),
        placeId: ids.town,
        rawPayload: { isBroad: true }
      },
      {
        ...context,
        automationRules: [
          {
            id: "40000000-0000-4000-8000-000000000099",
            name: "Ignore broad geofence entries",
            triggerSource: "geofence_broad",
            triggerType: "geofence_enter",
            action: "ignore_source",
            enabled: true
          },
          ...context.automationRules
        ]
      }
    );

    expect(candidate.action).toBe("record_only");
    expect(candidate.reviewStatus).toBe("confirmed");
  });

  it("never auto-starts Home by default", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_enter",
        occurredAt: new Date("2026-06-20T18:00:00Z"),
        placeId: ids.home
      },
      context
    );

    expect(candidate.action).toBe("create_review_item");
    expect(candidate.reason).toContain("Home");
  });

  it("creates review items for long unknown stays", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_broad",
        type: "unknown_stay",
        occurredAt: new Date("2026-06-20T15:00:00Z"),
        rawPayload: { durationMinutes: 45 }
      },
      context
    );

    expect(candidate.action).toBe("create_review_item");
    expect(candidate.reviewStatus).toBe("needs_review");
  });

  it("maps HealthKit sleep stages into Dayframe stages", () => {
    expect(mapHealthKitSleepStage(0)).toBe("in_bed");
    expect(mapHealthKitSleepStage(3)).toBe("asleep_core");
    expect(mapHealthKitSleepStage(4)).toBe("asleep_deep");
    expect(mapHealthKitSleepStage(5)).toBe("asleep_rem");
    expect(mapHealthKitSleepStage("awake")).toBe("awake");
  });

  it("accepts optional client event ids for idempotent mobile retries", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "mobile_app",
        type: "timer_stop",
        occurredAt: new Date("2026-06-20T17:00:00Z"),
        clientEventId: "mobile-local-1"
      },
      context
    );

    expect(candidate.action).toBe("stop_timer");
    expect(candidate.reviewStatus).toBe("confirmed");
  });

  it("maps Toggl time entries to stable external references", () => {
    const mapped = mapTogglTimeEntry({
      id: 123,
      workspace_id: 999,
      project_id: 456,
      description: " Imported entry ",
      start: new Date("2026-06-20T08:00:00Z"),
      stop: null,
      duration: 1800,
      tags: ["billable"],
      billable: true
    });

    expect(mapped.externalId).toBe("123");
    expect(mapped.projectExternalId).toBe("456");
    expect(mapped.description).toBe("Imported entry");
    expect(mapped.stoppedAt).toBe("2026-06-20T08:30:00.000Z");
    expect(mapped.tags).toEqual(["billable"]);
    expect(mapped.billable).toBe(true);
  });
});
