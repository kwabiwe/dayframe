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

  it("does not report a recorded stop as an evidence gap or split point (review finding 4)", async () => {
    const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 8, 29, 16, minute, second)).toISOString();
    const review = {
      ...reviewRow(), stayId: null, commuteId: "60000000-0000-4000-8000-000000000001",
      startedAt: at(0), stoppedAt: at(20),
      tripStops: [{ staySegmentId: "stay_a", startedAt: at(2), stoppedAt: at(18) }]
    };
    const route = [at(0, 10), at(0, 35), at(1, 0), at(1, 25), at(1, 50), at(18, 10), at(18, 35), at(19, 0), at(19, 25)]
      .map((occurredAt, index) => ({
        id: `e${index}`, clientEvidenceId: `route-${index}`, kind: "standard_location", occurredAt, endedAt: null,
        longitude: -0.1, latitude: 51.5 + index * 0.001, accuracyMeters: 5, role: "route", expiresAt: at(59)
      }));
    query.mockImplementation((sql: string) => {
      if (sql.includes("from review_items ri")) return Promise.resolve({ rows: [review] });
      if (sql.includes("from location_segment_evidence lse")) return Promise.resolve({ rows: route });
      return Promise.resolve({ rows: [] });
    });
    const dto = await getLocationReviewEvidence(review.reviewItemId, session);
    expect(dto.map.gaps).toEqual([]);
    expect(dto.suggestedSplitPoints).toEqual([]);
    expect(dto.textualSummary).toContain("Largest evidence gap: 0 minutes");
  });

  it("still reports an unobserved gap outside a recorded stop", async () => {
    const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 8, 29, 16, minute, second)).toISOString();
    const review = {
      ...reviewRow(), stayId: null, commuteId: "60000000-0000-4000-8000-000000000001",
      startedAt: at(0), stoppedAt: at(50),
      tripStops: [{ staySegmentId: "stay_a", startedAt: at(2), stoppedAt: at(10) }]
    };
    const route = [at(0, 30), at(1, 30), at(30, 0), at(49, 0)].map((occurredAt, index) => ({
      id: `e${index}`, clientEvidenceId: `route-${index}`, kind: "standard_location", occurredAt, endedAt: null,
      longitude: -0.1, latitude: 51.5 + index * 0.001, accuracyMeters: 5, role: "route", expiresAt: at(59)
    }));
    query.mockImplementation((sql: string) => {
      if (sql.includes("from review_items ri")) return Promise.resolve({ rows: [review] });
      if (sql.includes("from location_segment_evidence lse")) return Promise.resolve({ rows: route });
      return Promise.resolve({ rows: [] });
    });
    const dto = await getLocationReviewEvidence(review.reviewItemId, session);
    // 01:30–30:00 minus the 02:00–10:00 stop leaves a 20-minute unobserved interval; 30:00–49:00 is 19 minutes.
    expect(dto.map.gaps.map((gap) => [gap.startedAt, gap.stoppedAt, gap.durationSeconds])).toEqual([
      [at(10), at(30), 1_200], [at(30), at(49), 1_140]
    ]);
    expect(dto.suggestedSplitPoints).toHaveLength(2);
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
