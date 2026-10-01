import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({ query }));

const { getLocationReviewEvidence } = await import("./location-query-service");

const session = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["app:read"]
};

describe("Location Review evidence query", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("starts independent evidence and nearby-place reads in parallel", async () => {
    const phaseResolvers: Array<(value: { rows: never[] }) => void> = [];
    query.mockImplementationOnce(() => Promise.resolve({ rows: [reviewRow()] }));
    query.mockImplementation(() => new Promise((resolve) => {
      phaseResolvers.push(resolve);
    }));

    const request = getLocationReviewEvidence(
      "30000000-0000-4000-8000-000000000001",
      session
    );

    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(4));
    expect(phaseResolvers).toHaveLength(3);
    for (const resolve of phaseResolvers) resolve({ rows: [] });

    await expect(request).resolves.toMatchObject({
      reviewItemId: "30000000-0000-4000-8000-000000000001",
      segment: {
        id: "50000000-0000-4000-8000-000000000001",
        kind: "stay",
        evidenceCount: 0,
        rejectedEvidenceCount: 0
      }
    });
  });

  it.each([
    ["unknown Visit with movement-backed bounds after raw expiry", "unknown", "2026-08-20T07:59:40.000Z", "2026-08-20T08:30:00.000Z", true, true, true],
    ["saved-place corroborated gap", "saved", "2026-08-20T07:59:40.000Z", "2026-08-20T08:30:00.000Z", true, true, false],
    ["learned-place gap", "learned", "2026-08-20T07:59:40.000Z", "2026-08-20T08:30:00.000Z", true, true, false],
    ["ordinary exact unknown stay", "unknown", "2026-08-20T08:00:00.000Z", "2026-08-20T08:00:00.000Z", true, false, false],
    ["unknown GPS gap without Visit", "unknown", "2026-08-20T07:59:40.000Z", "2026-08-20T08:30:00.000Z", true, false, false],
    ["commute", "unknown", "2026-08-20T07:59:40.000Z", "2026-08-20T08:30:00.000Z", false, true, false]
  ] as const)("sets explicit approximate-arrival presentation only for %s", async (
    _case, placeMatchKind, lower, upper, stay, persistedFlag, expected
  ) => {
    const review = {
      ...reviewRow(),
      placeMatchKind,
      approximateArrival: persistedFlag,
      startLowerBoundAt: lower,
      startUpperBoundAt: upper,
      stayId: stay ? reviewRow().stayId : null,
      commuteId: stay ? null : "60000000-0000-4000-8000-000000000001"
    };
    query.mockImplementation((sql: string) => {
      if (sql.includes("from review_items ri")) return Promise.resolve({ rows: [review] });
      return Promise.resolve({ rows: [] });
    });
    const dto = await getLocationReviewEvidence(review.reviewItemId, session);
    expect(dto.segment.approximateArrival).toBe(expected);
  });

  it("presents trip stops from commute metadata and ignores malformed entries", async () => {
    const review = {
      ...reviewRow(),
      stayId: null,
      commuteId: "60000000-0000-4000-8000-000000000001",
      startedAt: "2026-09-29T16:33:49.000Z",
      stoppedAt: "2026-09-29T16:45:39.000Z",
      tripStops: [
        { staySegmentId: "stay_a", startedAt: "2026-09-29T16:35:49.000Z", stoppedAt: "2026-09-29T16:44:11.000Z",
          startLowerBoundAt: "2026-09-29T16:35:49.000Z", startUpperBoundAt: "2026-09-29T16:38:11.000Z" },
        { startedAt: "not a time", stoppedAt: "2026-09-29T16:44:11.000Z" },
        { startedAt: "2026-09-29T16:44:11.000Z", stoppedAt: "2026-09-29T16:40:00.000Z" },
        null
      ]
    };
    query.mockImplementation((sql: string) => {
      if (sql.includes("from review_items ri")) return Promise.resolve({ rows: [review] });
      return Promise.resolve({ rows: [] });
    });
    const dto = await getLocationReviewEvidence(review.reviewItemId, session);
    expect(dto.stops).toEqual([{
      startedAt: "2026-09-29T16:35:49.000Z", stoppedAt: "2026-09-29T16:44:11.000Z",
      durationSeconds: 502, approximate: true
    }]);
    expect(dto.textualSummary).toContain("includes an 8-minute (approximate) stop");
    expect(dto.textualSummary).toContain("not travel time");
    expect(query.mock.calls[0][0]).toContain("cs.metadata->'stops'");
  });

  it("returns no stops for a stay or a trip without stop metadata", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("from review_items ri")) return Promise.resolve({ rows: [{ ...reviewRow(), tripStops: null }] });
      return Promise.resolve({ rows: [] });
    });
    const dto = await getLocationReviewEvidence(reviewRow().reviewItemId, session);
    expect(dto.stops).toEqual([]);
    expect(dto.textualSummary).not.toContain("stop from");
  });
});

function reviewRow() {
  return {
    reviewItemId: "30000000-0000-4000-8000-000000000001",
    eventId: "40000000-0000-4000-8000-000000000001",
    title: "Visit library",
    notes: null,
    placeId: null,
    placeName: null,
    addressSummary: null,
    deviceId: "device-1",
    stayId: "50000000-0000-4000-8000-000000000001",
    commuteId: null,
    placeMatchKind: "unknown",
    approximateArrival: false,
    status: "review",
    startedAt: "2026-08-20T08:00:00.000Z",
    stoppedAt: "2026-08-20T08:30:00.000Z",
    startLowerBoundAt: null,
    startUpperBoundAt: null,
    stopLowerBoundAt: null,
    stopUpperBoundAt: null,
    centreLongitude: -0.1,
    centreLatitude: 51.5,
    radiusMeters: 80,
    confidence: "high",
    continuityStatus: "continuous",
    algorithmVersion: "location-v2.0",
    fromLongitude: null,
    fromLatitude: null,
    toLongitude: null,
    toLatitude: null
  };
}
