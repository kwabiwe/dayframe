import { describe, expect, it, vi } from "vitest";
import type { ClassifiedEvidence, CommuteSegment, LocationEvidence, StaySegment } from "@dayframe/shared";

// The engine output is fixed here so a decided stay can move a time-away item's
// endpoint during replay; everything else in replay runs for real.
const engine = vi.hoisted(() => ({ output: null as unknown }));
vi.mock("@dayframe/shared", async (original) => ({
  ...await original<typeof import("@dayframe/shared")>(),
  runLocationEngine: () => engine.output
}));
const { LOCATION_ENGINE_V2_CONFIG, stableLocationId } = await import("@dayframe/shared");
const { replayLocationEvidence } = await import("./location-replay-service");

const HOME = "10000000-0000-4000-8000-0000000000d1";
const DEVICE = "20000000-0000-4000-8000-0000000000d1";
const version = LOCATION_ENGINE_V2_CONFIG.algorithmVersion;
const at = (hh: number, mm: number) => `2026-03-10T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
const north = (metres: number) => metres / 111_195;
const fix = (id: string, iso: string, metres: number): LocationEvidence => ({
  clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: version, kind: "standard_location", occurredAt: iso,
  sourceTimestamp: iso, receivedAt: iso, timeZone: "UTC", endedAt: null, latitude: north(metres), longitude: 0,
  horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null, isSimulated: false, metadata: {}
});
const home = Array.from({ length: 7 }, (_, i) => fix(`home-${i}`, at(12, i * 10), 0));
const away = Array.from({ length: 15 }, (_, i) => fix(`away-${i}`, at(13 + Math.floor((3 + i * 5) / 60), (3 + i * 5) % 60), 400 + i * 3));
const back = [fix("back-0", at(14, 20), 0), fix("back-1", at(14, 30), 0), fix("back-2", at(14, 40), 0)];
const evidence = [...home, ...away, ...back];
const stay = (id: string, from: string, to: string, ids: string[], place: string | null): StaySegment => ({
  kind: "stay", clientSegmentId: id, algorithmVersion: version, status: "finalised", startedAt: from, stoppedAt: to,
  startLowerBoundAt: from, startUpperBoundAt: from, stopLowerBoundAt: to, stopUpperBoundAt: to,
  placeId: place, placeMatchKind: place ? "saved" : "unknown", candidatePlaceIds: [], centreLatitude: 0, centreLongitude: 0,
  radiusMeters: place ? 100 : 60, sampleCount: ids.length, continuityStatus: "continuous", confidence: "high", evidenceIds: ids
});
const commute = (id: string, from: StaySegment, to: StaySegment, reason: CommuteSegment["qualificationReason"]): CommuteSegment => ({
  kind: "commute", clientSegmentId: id, algorithmVersion: version, status: "finalised", startedAt: from.stoppedAt!, stoppedAt: to.startedAt,
  startLowerBoundAt: from.stoppedAt, startUpperBoundAt: from.stoppedAt, stopLowerBoundAt: to.startedAt, stopUpperBoundAt: to.startedAt,
  fromStaySegmentId: from.clientSegmentId, toStaySegmentId: to.clientSegmentId, fromPlaceId: from.placeId ?? null, toPlaceId: to.placeId ?? null,
  routeDistanceMeters: 900, straightLineDistanceMeters: 800, routeSampleCount: 3, gapDurationSeconds: 540, maximumObservationGapSeconds: 120,
  continuityStatus: "continuous", confidence: reason === "same_place_outing" ? "low" : "medium", qualificationReason: reason, evidenceIds: []
});

describe("Location replay time away", () => {
  it("never lets a rebuilt time-away item span a qualified journey (review finding 1)", async () => {
    const before = stay("stay-home-am", at(12, 0), at(13, 1), home.map((item) => item.clientEvidenceId), HOME);
    const after = stay("stay-home-pm", at(13, 8), at(14, 40), back.map((item) => item.clientEvidenceId), HOME);
    const first = stay("stay-a", at(13, 30), at(14, 1), [], null);
    const second = stay("stay-b", at(14, 10), at(14, 15), [], null);
    const segments = [before, commute(stableLocationId("commute", [before.clientSegmentId, after.clientSegmentId]), before, after, "same_place_outing"), after, first,
      commute("commute-journey", first, second, "significant_endpoint_displacement"), second];
    engine.output = {
      nextState: { algorithmVersion: version, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
      acceptedEvidence: evidence.map((item): ClassifiedEvidence => ({ evidence: item, match: null, impliedSpeedMetersPerSecond: null })),
      rejectedEvidence: [], segmentUpserts: segments, finalisedSegments: segments, diagnostics: {}
    };
    // The decided return-home row starts at 14:20, so replay rebuilds the time away up to it.
    const canonical = { clientSegmentId: after.clientSegmentId, startedAt: at(14, 20), stoppedAt: at(14, 40),
      startLowerBoundAt: at(14, 19), startUpperBoundAt: at(14, 21), stopLowerBoundAt: at(14, 40), stopUpperBoundAt: at(14, 40) };
    const stayRows = segments.filter((segment) => segment.kind === "stay")
      .map((segment) => ({ id: `db-${segment.clientSegmentId}`, clientSegmentId: segment.clientSegmentId }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("decided stay bounds")) return { rows: [canonical] };
      if (sql.includes("insert into stay_segments")) return { rows: stayRows };
      if (sql.includes("from places\n")) return { rows: [{ id: HOME, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100 }] };
      if (sql.includes("from stay_segments") && sql.includes("for update")) return { rows: [{
        id: "decided-row", clientSegmentId: after.clientSegmentId, continuityStatus: "supported_by_visit", preservesManualCorrection: true }] };
      return { rows: [] };
    });
    const server = await replayLocationEvidence({ query } as never, {
      workspaceId: "workspace-private", userId: "user-private", authMode: "provider", scopes: []
    }, { deviceId: DEVICE, algorithmVersion: version, processingAt: at(18, 0) });
    const commutes = server.segments.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    expect(commutes.map((segment) => segment.clientSegmentId)).toContain("commute-journey");
    const overlapping = commutes.filter((segment) => segment.qualificationReason === "same_place_outing" &&
      Date.parse(segment.startedAt) < Date.parse(at(14, 10)) && Date.parse(segment.stoppedAt) > Date.parse(at(14, 1)));
    expect(overlapping).toEqual([]);
  });
});
