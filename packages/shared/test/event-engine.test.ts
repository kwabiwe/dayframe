import { describe, expect, it } from "vitest";
import {
  applyActivityEvent,
  formatLocationCoordinates,
  locationAddressSummary,
  mapHealthKitSleepStage,
  normalizeActivityEvent,
  readableLocationNameFromParts,
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
      defaultActivityDescription: "Workout",
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

  it("allows explicit task starts without a project", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "manual_app",
        type: "timer_start",
        occurredAt: new Date("2026-06-20T08:00:00Z"),
        categoryId: ids.work,
        description: "Unplanned admin"
      },
      context
    );

    expect(next.activeEntry?.projectId).toBeUndefined();
    expect(next.activeEntry?.categoryId).toBe(ids.work);
    expect(next.activeEntry?.description).toBe("Unplanned admin");
    expect(next.reviewItems).toHaveLength(0);
  });

  it("keeps category-only explicit starts descriptionless when no description is supplied", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "mobile_app",
        type: "timer_start",
        occurredAt: new Date("2026-06-20T08:00:00Z"),
        categoryId: ids.work
      },
      context
    );

    expect(next.activeEntry?.categoryId).toBe(ids.work);
    expect(next.activeEntry?.description).toBeUndefined();
  });

  it("does not use the legacy start fallback title for blank timer starts", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "manual_app",
        type: "timer_start",
        occurredAt: new Date("2026-06-20T08:00:00Z"),
        categoryId: ids.work
      },
      context
    );

    expect(candidate.title).toBe("Timer started");
  });

  it("records geofence arrivals as evidence instead of live timers", () => {
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

    expect(candidate.action).toBe("record_only");
    expect(candidate.reviewStatus).toBe("confirmed");
    expect(candidate.confidence).toBe("low");
  });

  it("does not live-start timers from old geofence start rules", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_enter",
        occurredAt: new Date("2026-06-20T12:00:00Z"),
        placeId: ids.gymPlace
      },
      {
        ...context,
        automationRules: [
          {
            id: "40000000-0000-4000-8000-000000000011",
            name: "Enter Gym -> start",
            triggerSource: "geofence_specific",
            triggerType: "geofence_enter",
            placeId: ids.gymPlace,
            action: "start_timer",
            projectId: ids.gym,
            categoryId: ids.health,
            enabled: true
          }
        ]
      }
    );

    expect(candidate.action).toBe("record_only");
    expect(candidate.reviewStatus).toBe("confirmed");
    expect(candidate.reason).toContain("after the fact");
  });

  it("routes specific geofence exits to review even when an old stop rule exists", () => {
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
    expect(reviewCandidate.reason).toContain("review-first");

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

    expect(stopCandidate.action).toBe("create_review_item");
    expect(stopCandidate.reviewStatus).toBe("needs_review");
    expect(stopCandidate.reason).toContain("after-the-fact");
  });

  it("uses the place default activity description for geofence visit candidates", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_exit",
        occurredAt: new Date("2026-06-20T13:00:00Z"),
        placeId: ids.gymPlace
      },
      context
    );

    expect(candidate.title).toBe("Workout");
  });

  it("falls back to the place name when a geofence place has no default activity description", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_exit",
        occurredAt: new Date("2026-06-20T13:00:00Z"),
        placeId: ids.home
      },
      context
    );

    expect(candidate.title).toBe("Home");
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

  it("records Home arrivals as evidence only", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "geofence_specific",
        type: "geofence_enter",
        occurredAt: new Date("2026-06-20T18:00:00Z"),
        placeId: ids.home
      },
      context
    );

    expect(candidate.action).toBe("record_only");
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

  it("keeps uncertain commute learning review-first and prefers a Travel category when present", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-06-20T08:45:00Z"),
        rawPayload: {
          fromPlaceName: "Home",
          toPlaceName: "Gym",
          startedAt: "2026-06-20T08:15:00.000Z",
          stoppedAt: "2026-06-20T08:45:00.000Z"
        }
      },
      {
        ...context,
        categories: [...context.categories, { id: "20000000-0000-4000-8000-000000000010", name: "Travel" }]
      }
    );

    expect(candidate.action).toBe("create_review_item");
    expect(candidate.reviewStatus).toBe("needs_review");
    expect(candidate.categoryId).toBe("20000000-0000-4000-8000-000000000010");
    expect(candidate.title).toBe("Possible commute from Home to Gym");
  });

  it("keeps learned regular-place visits review-first", () => {
    const candidate = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "learned_place_visit",
        occurredAt: new Date("2026-06-20T09:15:00Z"),
        rawPayload: {
          candidateName: "Regular place near 51.501, -0.120",
          address: {
            street: "New London Road",
            postalCode: "CM2 0XX"
          },
          latitude: 51.501,
          longitude: -0.12,
          startedAt: "2026-06-20T08:45:00.000Z",
          stoppedAt: "2026-06-20T09:15:00.000Z",
          sampleCount: 3
        }
      },
      context
    );

    expect(candidate.action).toBe("create_review_item");
    expect(candidate.reviewStatus).toBe("needs_review");
    expect(candidate.confidence).toBe("low");
    expect(candidate.title).toBe("Near New London Road");
  });

  it("formats readable location names without promoting coordinates to primary copy", () => {
    expect(readableLocationNameFromParts({
      address: { name: "Tesco Springfield", street: "Springfield Road", postalCode: "CM2 6QT" },
      latitude: 51.7484,
      longitude: 0.4381
    })).toBe("Near Tesco Springfield");
    expect(readableLocationNameFromParts({
      address: { name: "12 New London Road", streetNumber: "12", street: "New London Road", postalCode: "CM2 0XX" },
      latitude: 51.7484,
      longitude: 0.4381
    })).toBe("Near New London Road");
    expect(readableLocationNameFromParts({
      fallbackName: "Regular place near 51.748, 0.438",
      latitude: 51.7484,
      longitude: 0.4381
    })).toBe("Unknown place near 51.748, 0.438");
    expect(locationAddressSummary({ street: "New London Road", city: "Chelmsford", postalCode: "CM2 0XX" }))
      .toBe("New London Road, Chelmsford, CM2 0XX");
    expect(formatLocationCoordinates(51.7484, 0.4381)).toBe("51.748, 0.438");
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
});
