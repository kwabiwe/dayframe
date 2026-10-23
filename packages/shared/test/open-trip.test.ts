import { describe, expect, it } from "vitest";
import { deriveOpenTrip } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { largeBuildingAt, largeBuildingVisitFixture } from "../src/location/largeBuildingVisitFixture";
import { runLocationEngine } from "../src/location/segmenter";
import type { ClassifiedEvidence, CommuteSegment, LocationEvidence, StaySegment } from "../src/location/types";

// Location v4 step 5, "Travelling since…": synthetic equatorial geometry in metres around a made-up
// origin, synthetic identities.
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 26, 8) + Math.round(minutes * 60_000)).toISOString();
const latitude = (northMetres: number) => northMetres / 110_574;
const longitude = (eastMetres: number) => eastMetres / 111_320;
const SAVED_ID = "10000000-0000-4000-8000-0000000000d1";

function origin(status: StaySegment["status"] = "finalised"): StaySegment {
  return { kind: "stay", clientSegmentId: "origin", algorithmVersion: config.algorithmVersion, status,
    startedAt: at(0), stoppedAt: status === "open" ? null : at(60), placeId: null, placeMatchKind: "unknown",
    candidatePlaceIds: [], centreLatitude: 0, centreLongitude: 0, sampleCount: 4, continuityStatus: "continuous",
    confidence: "medium", evidenceIds: ["origin-a", "origin-b"] };
}

function reading(id: string, minutes: number, east: number, patch: Partial<LocationEvidence> = {},
  match: ClassifiedEvidence["match"] = null): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: id, deviceId: "device-o", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes), timeZone: "UTC",
    latitude: latitude(0), longitude: longitude(east), horizontalAccuracyMeters: 8, speedMetersPerSecond: 0,
    isSimulated: false, ...patch }, impliedSpeedMetersPerSecond: null, match };
}

/** At the origin until minute 60, then walking east from minute 61. */
function evidence(extra: ClassifiedEvidence[] = [], walk = true) {
  return [reading("origin-a", 10, 5), reading("origin-b", 59, -5),
    ...(walk ? [61, 63, 65, 67].map((minutes, index) => reading(`walk-${index}`, minutes, 100 + index * 150, { speedMetersPerSecond: 1.4 + index * 0.1 })) : []),
    ...extra].sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt));
}

describe("open trip, Travelling since… (location v4 step 5)", () => {
  it("shows the journey in progress from the last stay's departure, with what has been seen so far", () => {
    const trip = deriveOpenTrip([origin()], evidence(), config, at(70));
    expect(trip).toMatchObject({ kind: "open_trip", fromStaySegmentId: "origin", fromPlaceId: null, startedAt: at(60),
      lastObservedAt: at(67), routeSampleCount: 4, evidenceIds: ["walk-0", "walk-1", "walk-2", "walk-3"] });
    expect(trip!.routeDistanceMeters).toBeGreaterThan(500);
  });

  it("is never shown while a stay is open", () => {
    expect(deriveOpenTrip([origin("open")], evidence(), config, at(70))).toBeNull();
  });

  it("ends after a silence over the continuity limit: a parked phone stops reporting", () => {
    expect(deriveOpenTrip([origin()], evidence(), config, at(67 + 12))).not.toBeNull();
    expect(deriveOpenTrip([origin()], evidence(), config, at(67 + 13))).toBeNull();
  });

  it("ends when iOS reports an arrival Visit after the last movement", () => {
    const visit = reading("arrival-visit", 68, 600, { kind: "visit", speedMetersPerSecond: null, endedAt: null, metadata: { visitDepartureOpen: true } });
    expect(deriveOpenTrip([origin()], evidence([visit]), config, at(70))).toBeNull();
  });

  it("ends at a saved place: an entry, or a still reading there", () => {
    const entry = reading("entry", 68, 600, { kind: "geofence_enter", latitude: null, longitude: null, horizontalAccuracyMeters: null,
      speedMetersPerSecond: null, savedPlaceId: SAVED_ID });
    const there = reading("there", 68, 600, {}, { kind: "saved", placeId: SAVED_ID, candidates: [] });
    expect(deriveOpenTrip([origin()], evidence([entry]), config, at(70))).toBeNull();
    expect(deriveOpenTrip([origin()], evidence([there]), config, at(70))).toBeNull();
  });

  it("comes back once the device moves on after a stop", () => {
    const visit = reading("transfer-visit", 68, 600, { kind: "visit", speedMetersPerSecond: null, endedAt: at(70) });
    const onwards = reading("onwards", 71, 900, { speedMetersPerSecond: 9 });
    expect(deriveOpenTrip([origin()], evidence([visit, onwards]), config, at(72))).toMatchObject({ startedAt: at(60), lastObservedAt: at(71) });
  });

  it("runs on through a short stop the journey reached, from the place before it", () => {
    const stop: StaySegment = { ...origin(), clientSegmentId: "stop", startedAt: at(68), stoppedAt: at(73), centreLongitude: 600 / 111_320,
      evidenceIds: ["stop-a"] };
    const reached = { kind: "commute", clientSegmentId: "to-stop", fromStaySegmentId: "origin", toStaySegmentId: "stop" } as CommuteSegment;
    const moving = [reading("stop-a", 70, 600), reading("on-1", 75, 900, { speedMetersPerSecond: 9 }), reading("on-2", 77, 1_900, { speedMetersPerSecond: 10 })];
    expect(deriveOpenTrip([origin(), stop], evidence(moving), config, at(78), [reached]))
      .toMatchObject({ fromStaySegmentId: "origin", startedAt: at(60), lastObservedAt: at(77) });
    // Without a journey to the stop, it is a place of its own: the trip runs from there.
    expect(deriveOpenTrip([origin(), stop], evidence(moving), config, at(78), [])).toMatchObject({ fromStaySegmentId: "stop" });
  });

  it("needs movement and a reading clearly away from the origin", () => {
    const still = [70, 72].map((minutes, index) => reading(`still-${index}`, minutes, 600));
    expect(deriveOpenTrip([origin()], evidence(still, false), config, at(73))).toBeNull();
    const nearby = [61, 63].map((minutes, index) => reading(`near-${index}`, minutes, 30 + index * 20, { speedMetersPerSecond: 1.6 }));
    expect(deriveOpenTrip([origin()], evidence(nearby, false), config, at(64))).toBeNull();
  });

  it("comes out of the engine beside the segments, never as one", () => {
    // Mid-way through the drive home in the large-building fixture, as the evidence stood then.
    const input = largeBuildingVisitFixture();
    const cut = Date.parse(largeBuildingAt(306));
    const output = runLocationEngine({ ...input, processingAt: largeBuildingAt(307),
      evidence: input.evidence.filter((item) => Date.parse(item.occurredAt) <= cut) });
    const building = output.segmentUpserts.find((segment) => segment.kind === "stay" && segment.startedAt === largeBuildingAt(68))!;
    expect(output.openTrip).toMatchObject({ fromStaySegmentId: building.clientSegmentId, startedAt: largeBuildingAt(297.5) });
    expect(output.segmentUpserts.some((segment) => segment.kind === "commute" && segment.fromStaySegmentId === building.clientSegmentId)).toBe(false);
    expect(output.segmentUpserts.every((segment) => segment.kind === "stay" || segment.kind === "commute")).toBe(true);
  });
});
