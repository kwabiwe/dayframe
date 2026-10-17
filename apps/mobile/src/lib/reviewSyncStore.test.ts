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
  mobileReviewItemFromPresentation,
  nextReviewRetryAt,
  projectReviewBootstrap,
  withNewerTerminalEvidence,
  sanitiseDashboardBootstrapForCache,
  reviewSyncDisposition,
  restoreReviewItemsWithAnchors,
  sanitiseReviewItemForCache,
  utf8ByteSize
} = await import("./reviewSyncStore");
const { isTimeAwayReviewItem, reviewItemCategoryLabel } = await import("./review");

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

  it("moves the count of cards by the cards that leave, an outing once (PRD D19, PR 12c)", () => {
    const outing = (id: string, role: string) => reviewItem({ id, rawPayload: { outingKey: "outing:a", outingRole: role } });
    const items = [outing("stay", "stay"), outing("there", "in"), outing("back", "out"), reviewItem({ id: "walk" })];
    const data = { ...bootstrap(items), stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 4, reviewCardCount: 2 } };
    const whole = projectReviewBootstrap(data, new Set(["stay", "there", "back"]));
    expect(whole.stats).toMatchObject({ reviewCount: 1, reviewCardCount: 1 });
    // The Stay decided on its own: its Moves come back as cards of their own.
    expect(projectReviewBootstrap(data, new Set(["stay"])).stats).toMatchObject({ reviewCount: 3, reviewCardCount: 3 });
    // The capped list misses the Stay of two loaded Moves (Codex r1 on #475): the server's map keeps it exact.
    const capped = { ...bootstrap([...Array.from({ length: 98 }, (_, index) => reviewItem({ id: `other-${index}` })),
      outing("there", "in"), outing("back", "out")]),
      stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 101, reviewCardCount: 99, reviewOutingStays: { there: "stay", back: "stay" } } };
    expect(projectReviewBootstrap(capped, new Set(["there"])).stats).toMatchObject({ reviewCardCount: 99 });
    expect(projectReviewBootstrap(capped, new Set(["there"])).stats).not.toHaveProperty("reviewCardCountApproximate");
    expect(projectReviewBootstrap(capped, new Set(["other-0"])).stats?.reviewCardCount).toBe(98);
    // Its Stay is not listed: deciding it changes the count by what the list can't show, so it is
    // said to be approximate rather than guessed (Codex r3 on #475).
    expect(projectReviewBootstrap(capped, new Set(["stay"])).stats).toMatchObject({ reviewCardCount: 99, reviewCardCountApproximate: true });
    // The Stay listed, its Moves not: deciding the Stay brings both back, exactly, once (Codex r2/r3 on #475).
    const stayListed = { ...bootstrap([...Array.from({ length: 99 }, (_, index) => reviewItem({ id: `other-${index}` })), outing("stay", "stay")]),
      stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 102, reviewCardCount: 100, reviewOutingStays: { there: "stay", back: "stay" } } };
    const once = projectReviewBootstrap(stayListed, new Set(["stay"]));
    expect(once.stats).toMatchObject({ reviewCardCount: 101, reviewOutingStays: { there: "stay", back: "stay" } });
    expect(once.stats).not.toHaveProperty("reviewCardCountApproximate");
    expect(projectReviewBootstrap(once, new Set(["stay"])).stats).toMatchObject({ reviewCardCount: 101 });
    expect(projectReviewBootstrap(once, new Set(["stay"])).stats).not.toHaveProperty("reviewCardCountApproximate");
    // A later decision on one of its unlisted Moves: the map knows it counts, the list can't take it off.
    expect(projectReviewBootstrap(once, new Set(["stay", "there"])).stats).toMatchObject({ reviewCardCount: 101, reviewCardCountApproximate: true });
    // Decisions one after another, in either order, each projected onto the last (Codex r4 on #475).
    const fourCards = { ...bootstrap([outing("stay", "stay"), outing("there", "in"), outing("back", "out"), reviewItem({ id: "walk" })]),
      stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 4, reviewCardCount: 2, reviewOutingStays: { there: "stay", back: "stay" } } };
    const afterStay = projectReviewBootstrap(fourCards, new Set(["stay"]));
    expect(afterStay.stats?.reviewCardCount).toBe(3);
    const afterThere = projectReviewBootstrap(afterStay, new Set(["stay", "there"]));
    expect(afterThere.stats?.reviewCardCount).toBe(2);
    const afterBack = projectReviewBootstrap(afterThere, new Set(["stay", "there", "back"]));
    expect(afterBack.stats?.reviewCardCount).toBe(1);
    expect(afterBack.stats).not.toHaveProperty("reviewCardCountApproximate");
    const movesFirst = projectReviewBootstrap(projectReviewBootstrap(fourCards, new Set(["there"])), new Set(["there", "back"]));
    expect(movesFirst.stats?.reviewCardCount).toBe(2);
    expect(projectReviewBootstrap(movesFirst, new Set(["there", "back", "stay"])).stats?.reviewCardCount).toBe(1);
    // The whole outing listed and decided: one card off, once.
    const listed = { ...bootstrap([...Array.from({ length: 97 }, (_, index) => reviewItem({ id: `other-${index}` })),
      outing("stay", "stay"), outing("there", "in"), outing("back", "out")]),
      stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 100, reviewCardCount: 98, reviewOutingStays: { there: "stay", back: "stay" } } };
    const outingDecided = projectReviewBootstrap(listed, new Set(["stay", "there", "back"]));
    expect(outingDecided.stats?.reviewCardCount).toBe(97);
    expect(projectReviewBootstrap(outingDecided, new Set(["stay", "there", "back"])).stats?.reviewCardCount).toBe(97);
    // A server that counts cards but sent no map (beyond its limit): a local decision makes the count approximate.
    const unmapped = { ...capped, stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: 101, reviewCardCount: 99, reviewOutingStaysOverflow: true } };
    expect(projectReviewBootstrap(unmapped, new Set(["there"])).stats?.reviewCardCountApproximate).toBe(true);
    expect(projectReviewBootstrap(unmapped, new Set()).stats?.reviewCardCountApproximate).toBeUndefined();
    // An older server sends no count of cards: none is made up.
    expect(projectReviewBootstrap(bootstrap(items), new Set(["walk"])).stats).not.toHaveProperty("reviewCardCount");
  });

  it("drops a cached snapshot's counts of cards by the cards settled elsewhere (PR 12c)", () => {
    const record = (id: string, role?: "stay" | "in" | "out") => ({
      kind: "review", reviewItemId: id, status: "open", createdAt: "2026-09-12T09:00:00.000Z",
      interval: { start: "2026-09-12T10:00:00.000Z", end: "2026-09-12T10:30:00.000Z" },
      ...(role ? { outing: { key: "outing:a", role } } : {})
    });
    const snapshot = {
      scope: { mode: "window", timeZone: "Etc/UTC", today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" } },
      outstanding: { globalCount: 2, todayCount: 2, openReviewItemIds: ["stay", "there", "back", "walk"],
        outingStays: { there: "stay", back: "stay" } },
      records: [record("stay", "stay"), record("there", "in"), record("back", "out"), record("walk")],
      links: []
    } as never;
    const settled = withNewerTerminalEvidence(snapshot, new Set(["stay", "there", "back"])) as { outstanding: { globalCount: number; todayCount: number } };
    expect(settled.outstanding).toMatchObject({ globalCount: 1, todayCount: 1 });
    const stayAlone = withNewerTerminalEvidence(snapshot, new Set(["stay"])) as { outstanding: { globalCount: number; todayCount: number; outingStays: object } };
    expect(stayAlone.outstanding).toMatchObject({ globalCount: 3, todayCount: 3, outingStays: {} });
    // Without the map (beyond its limit) a removal leaves the counts approximate (Codex r3 on #475).
    const overflow = { ...(snapshot as { outstanding: object }), outstanding: { globalCount: 2, todayCount: 2,
      openReviewItemIds: ["stay", "there", "back", "walk"], outingStaysOverflow: true } } as never;
    expect((withNewerTerminalEvidence(overflow, new Set(["walk"])) as { outstanding: object }).outstanding).toMatchObject({ countsApproximate: true });
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

  it("keeps time away recognisable through the cache and backlog presentation (review finding 3)", () => {
    const cached = sanitiseReviewItemForCache(reviewItem({
      eventType: "commute_detected", categoryName: null,
      rawPayload: { qualificationReason: "same_place_outing", stopCount: 1, latitude: 51.5 }
    }));
    expect(cached.rawPayload).toEqual({ qualificationReason: "same_place_outing", stopCount: 1 });
    expect(isTimeAwayReviewItem(cached)).toBe(true);
    expect(reviewItemCategoryLabel(cached)).toBe("No activity");
    const record = {
      kind: "review" as const, reviewItemId: "30000000-0000-4000-8000-000000000001", eventId: null,
      locationSegmentId: "70000000-0000-4000-8000-000000000001", sourceKind: "location_v2" as const,
      eventSource: "location_v2", eventType: "commute_detected", title: "Time away from Home",
      category: { id: null, name: null, color: null }, place: { id: null, label: null },
      interval: { start: "2026-03-10T12:00:00.000Z", end: "2026-03-10T12:10:00.000Z" }, confidence: "low",
      status: "open" as const, createdAt: "2026-03-10T12:20:00.000Z", updatedAt: "2026-03-10T12:20:00.000Z",
      proposalHash: null, canonicalEntryIds: [], semanticRevision: null
    };
    const backlog = mobileReviewItemFromPresentation({ ...record, timeAway: { stopCount: 1 } });
    expect(isTimeAwayReviewItem(backlog)).toBe(true);
    expect(reviewItemCategoryLabel(backlog)).toBe("No activity");
    expect(isTimeAwayReviewItem(sanitiseReviewItemForCache(backlog))).toBe(true);
    // A server without the feature: an ordinary commute as before.
    expect(isTimeAwayReviewItem(mobileReviewItemFromPresentation(record))).toBe(false);
    // A Move's route line survives presentation-only cards and the cache (PRD D19, Codex r1 on #456).
    const routed = mobileReviewItemFromPresentation({ ...record, title: "Trip", timeAway: { stopCount: 0 }, routeLabel: "Round trip from Home" });
    expect(routed.rawPayload).toEqual({ qualificationReason: "same_place_outing", stopCount: 0, routeLabel: "Round trip from Home" });
    expect(sanitiseReviewItemForCache(routed).rawPayload).toMatchObject({ routeLabel: "Round trip from Home" });
    expect(mobileReviewItemFromPresentation({ ...record, title: "Drive", routeLabel: "Home → Gym" }).rawPayload).toEqual({ routeLabel: "Home → Gym" });
  });

  it("keeps which outing a card belongs to through backlog presentation and the cache (PRD D19, PR 12b)", () => {
    const record = {
      kind: "review" as const, reviewItemId: "30000000-0000-4000-8000-000000000002", eventId: null,
      locationSegmentId: "70000000-0000-4000-8000-000000000002", sourceKind: "location_v2" as const,
      eventSource: "location_learning", eventType: "commute_detected", title: "Drive",
      category: { id: null, name: null, color: null }, place: { id: null, label: null },
      interval: { start: "2026-03-10T12:00:00.000Z", end: "2026-03-10T12:10:00.000Z" }, confidence: "low",
      status: "open" as const, createdAt: "2026-03-10T12:20:00.000Z", updatedAt: "2026-03-10T12:20:00.000Z",
      proposalHash: null, canonicalEntryIds: [], semanticRevision: null
    };
    // A learned name crosses too (Codex r1 on #481).
    expect(mobileReviewItemFromPresentation({ ...record, learnedName: true }).rawPayload).toEqual({ nameSource: "learned" });
    const presented = mobileReviewItemFromPresentation({ ...record, outing: { key: "outing:synthetic-a", role: "in", travelMode: "automotive" } });
    expect(presented.rawPayload).toEqual({ outingKey: "outing:synthetic-a", outingRole: "in", travelMode: "automotive" });
    expect(sanitiseReviewItemForCache(presented).rawPayload).toEqual({ outingKey: "outing:synthetic-a", outingRole: "in", travelMode: "automotive" });
    // From bootstrap too: the key and role survive the cache (coordinates never do).
    const cached = sanitiseReviewItemForCache(reviewItem({ rawPayload: { outingKey: "outing:synthetic-a", outingRole: "stay", latitude: 0.5 } }));
    expect(cached.rawPayload).toEqual({ outingKey: "outing:synthetic-a", outingRole: "stay" });
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
