import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, MobileReviewItem } from "./api";

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn()
}));

vi.mock("./secure-session", () => ({
  clearSessionToken: vi.fn(),
  getSessionToken: vi.fn()
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe.test"
}));

const {
  createReviewClientMutationId,
  locationReviewEvidenceExpiry,
  nextReviewRetryAt,
  projectReviewBootstrap,
  sanitiseDashboardBootstrapForCache,
  reviewSyncDisposition,
  restoreReviewItemsWithAnchors,
  sanitiseReviewItemForCache,
  utf8ByteSize
} = await import("./reviewSyncStore");

describe("Review sync store contracts", () => {
  it("generates valid distinct stable mutation IDs before local enqueue", () => {
    const first = createReviewClientMutationId();
    const second = createReviewClientMutationId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(second).not.toBe(first);
  });

  it("bounds exponential retry jitter", () => {
    const attemptedAt = new Date("2026-07-27T10:00:00.000Z");
    expect(nextReviewRetryAt(attemptedAt, 1, () => 0)).toBe(
      "2026-07-27T10:00:24.000Z"
    );
    expect(nextReviewRetryAt(attemptedAt, 1, () => 1)).toBe(
      "2026-07-27T10:00:36.000Z"
    );
    expect(nextReviewRetryAt(attemptedAt, 99, () => 0.5)).toBe(
      "2026-07-27T11:00:00.000Z"
    );
  });

  it("classifies retry, authentication and permanent conflict outcomes", () => {
    expect(reviewSyncDisposition(200)).toBe("acknowledge");
    expect(reviewSyncDisposition(401)).toBe("authentication_required");
    expect(reviewSyncDisposition(403)).toBe("authentication_required");
    expect(reviewSyncDisposition(408)).toBe("retry");
    expect(reviewSyncDisposition(429)).toBe("retry");
    expect(reviewSyncDisposition(503)).toBe("retry");
    expect(reviewSyncDisposition(409, "review_item_locked")).toBe("retry");
    expect(reviewSyncDisposition(409, "overlap")).toBe("retry");
    expect(reviewSyncDisposition(409, "resolution_conflict")).toBe(
      "needs_attention"
    );
    expect(reviewSyncDisposition(422, "invalid_category")).toBe(
      "needs_attention"
    );
  });

  it("filters durable tombstones from bootstrap and updates the Review count", () => {
    const data = bootstrap([reviewItem({ id: "review-1" }), reviewItem({ id: "review-2" })]);
    const projected = projectReviewBootstrap(data, new Set(["review-1"]));
    expect(projected.reviewItems.map((item) => item.id)).toEqual(["review-2"]);
    expect(projected.stats?.reviewCount).toBe(1);
  });

  it("does not cache coordinates, raw Health payloads or secrets", () => {
    const safe = sanitiseReviewItemForCache(reviewItem({
      rawPayload: {
        algorithmVersion: "location-v2.0",
        clientSegmentId: "segment-1",
        continuityStatus: "uncertain_gap",
        latitude: 51.5,
        longitude: -0.1,
        samples: [{ sleepStage: "deep" }],
        token: "secret"
      }
    }));
    expect(safe.rawPayload).toEqual({
      algorithmVersion: "location-v2.0",
      clientSegmentId: "segment-1",
      continuityStatus: "uncertain_gap"
    });
  });

  it("caches dashboard presentation without location coordinates or raw evidence", () => {
    const safe = sanitiseDashboardBootstrapForCache({
      ...bootstrap([reviewItem({
        rawPayload: {
          algorithmVersion: "location-v2.0",
          latitude: 51.5,
          longitude: -0.1,
          token: "secret"
        }
      })]),
      places: [{
        id: "place-1",
        name: "Office",
        latitude: 51.5,
        longitude: -0.1,
        radiusMeters: 100,
        priority: 1,
        defaultProjectId: null,
        defaultCategoryId: null
      }],
      learnedPlaces: [{
        id: "learned-1",
        name: "Candidate",
        latitude: 51.5,
        longitude: -0.1,
        radiusMeters: 100,
        visitCount: 2,
        distinctDayCount: 2,
        sampleCount: 4,
        totalDwellSeconds: 3600,
        longestDwellSeconds: 1800,
        averageAccuracyMeters: 8,
        maxClusterSpreadMeters: 12,
        firstSeenAt: "2026-07-26T08:00:00.000Z",
        lastSeenAt: "2026-07-27T08:00:00.000Z",
        lastStartedAt: null,
        lastStoppedAt: null,
        confidence: "medium",
        classification: "place_candidate",
        status: "candidate",
        address: { postcode: "SECRET" },
        poiName: null,
        formattedAddress: null,
        geocodedAt: null,
        rawPayload: { samples: [] }
      }]
    });

    expect(safe.places[0]).not.toHaveProperty("latitude");
    expect(safe.places[0]).not.toHaveProperty("longitude");
    expect(safe.learnedPlaces).toBeUndefined();
    expect(safe.reviewItems[0].rawPayload).toEqual({
      algorithmVersion: "location-v2.0"
    });
  });

  it("uses the earlier of the server evidence expiry and the seven-day local cap", () => {
    const fetchedAt = "2026-08-20T10:00:00.000Z";
    expect(locationReviewEvidenceExpiry({
      evidenceExpiresAt: "2026-08-21T10:00:00.000Z"
    }, fetchedAt)).toBe("2026-08-21T10:00:00.000Z");
    expect(locationReviewEvidenceExpiry({
      evidenceExpiresAt: "2026-09-20T10:00:00.000Z"
    }, fetchedAt)).toBe("2026-08-27T10:00:00.000Z");
  });

  it("counts serialized evidence using UTF-8 bytes", () => {
    expect(utf8ByteSize("map")).toBe(3);
    expect(utf8ByteSize("map 📍")).toBe(8);
  });

  it("restores permanent conflicts at surviving canonical anchors without duplicates", () => {
    const first = reviewItem({ id: "review-1" });
    const restored = reviewItem({ id: "review-2" });
    const third = reviewItem({ id: "review-3" });
    const result = restoreReviewItemsWithAnchors([first, third], [{
      item: restored,
      originalPosition: 1,
      precedingIds: [first.id],
      followingIds: [third.id]
    }, {
      item: restored,
      originalPosition: 0,
      precedingIds: [],
      followingIds: []
    }]);
    expect(result.map((item) => item.id)).toEqual(["review-1", "review-2", "review-3"]);
  });
});

function reviewItem(
  overrides: Partial<MobileReviewItem> = {}
): MobileReviewItem {
  return {
    id: "review-1",
    title: "Walk",
    eventSource: "health_workout",
    eventType: "health_workout_import",
    categoryName: "Health",
    placeName: null,
    suggestedCategoryId: null,
    suggestedPlaceId: null,
    suggestedStartedAt: "2026-07-27T08:00:00.000Z",
    suggestedStoppedAt: "2026-07-27T09:00:00.000Z",
    confidence: "high",
    status: "open",
    notes: null,
    rawPayload: null,
    createdAt: "2026-07-27T09:01:00.000Z",
    ...overrides
  };
}

function bootstrap(reviewItems: MobileReviewItem[]): MobileBootstrap {
  return {
    user: {
      id: "user-1",
      email: "review@example.com",
      name: "Review Tester"
    },
    workspace: {
      id: "workspace-1",
      name: "Personal"
    },
    activeEntry: null,
    stats: {
      todaySeconds: 0,
      weekSeconds: 0,
      reviewCount: reviewItems.length
    },
    projects: [],
    categories: [],
    entries: [],
    places: [],
    reviewItems
  };
}
