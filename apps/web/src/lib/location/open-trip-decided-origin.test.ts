import { describe, expect, it } from "vitest";
import {
  LOCATION_ENGINE_V2_CONFIG as config,
  largeBuildingAt,
  largeBuildingVisitFixture,
  runLocationEngine,
  type ClassifiedEvidence,
  type CommuteSegment,
  type LocationEngineOutput,
  type StaySegment
} from "@dayframe/shared";
import { openTripAgainstDecidedOrigin } from "./location-replay-service";

// Location v4 step 5: the journey in progress derived again against a decided origin's end. Synthetic data only.
describe("open trip against a decided origin", () => {
  it("re-derives from the engine's own output: kept a second after the decided end, gone once the end passes the movement", () => {
    const input = largeBuildingVisitFixture();
    const cut = Date.parse(largeBuildingAt(306));
    const output = runLocationEngine({ ...input, processingAt: largeBuildingAt(307),
      evidence: input.evidence.filter((item) => Date.parse(item.occurredAt) <= cut) });
    expect(output.openTrip?.startedAt).toBe(largeBuildingAt(297.5));
    const later = new Date(Date.parse(largeBuildingAt(297.5)) + 1_000).toISOString();
    expect(openTripAgainstDecidedOrigin(output, later, config, largeBuildingAt(307))).toMatchObject({
      fromStaySegmentId: output.openTrip!.fromStaySegmentId });
    expect(openTripAgainstDecidedOrigin(output, largeBuildingAt(306), config, largeBuildingAt(307))).toBeNull();
  });

  it("keeps a journey that ran through a short stop", () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 26, 8) + Math.round(minutes * 60_000)).toISOString();
    const stay = (id: string, start: number, stop: number, east: number, evidenceIds: string[]): StaySegment => ({ kind: "stay",
      clientSegmentId: id, algorithmVersion: config.algorithmVersion, status: "finalised", startedAt: at(start), stoppedAt: at(stop),
      placeId: null, placeMatchKind: "unknown", candidatePlaceIds: [], centreLatitude: 0, centreLongitude: east / 111_320, sampleCount: 3,
      continuityStatus: "continuous", confidence: "medium", evidenceIds });
    const reading = (id: string, minutes: number, east: number, speed: number): ClassifiedEvidence => ({ evidence: { clientEvidenceId: id,
      deviceId: "d", algorithmVersion: config.algorithmVersion, kind: "standard_location", occurredAt: at(minutes), receivedAt: at(minutes),
      timeZone: "UTC", latitude: 0, longitude: east / 111_320, horizontalAccuracyMeters: 8, speedMetersPerSecond: speed, isSimulated: false },
      impliedSpeedMetersPerSecond: null, match: null });
    const origin = stay("origin", 0, 60, 0, ["o-a"]);
    const stop = stay("stop", 68, 73, 600, ["s-a"]);
    const toStop = { kind: "commute", clientSegmentId: "to-stop", fromStaySegmentId: "origin", toStaySegmentId: "stop", startedAt: at(60),
      stoppedAt: at(68), evidenceIds: ["w-1"] } as unknown as CommuteSegment;
    const output = {
      segmentUpserts: [origin, toStop, stop],
      acceptedEvidence: [reading("o-a", 30, 0, 0), reading("w-1", 63, 300, 1.6), reading("s-a", 70, 600, 0),
        reading("on-1", 75, 900, 9), reading("on-2", 77, 1_900, 10)],
      openTrip: { kind: "open_trip", clientSegmentId: "open", fromStaySegmentId: "origin", fromPlaceId: null, startedAt: at(60),
        lastObservedAt: at(77), routeSampleCount: 4, routeDistanceMeters: 1_900, evidenceIds: [] }
    } as Pick<LocationEngineOutput, "segmentUpserts" | "acceptedEvidence" | "openTrip">;
    // The origin was decided a second later: the journey still runs from it, through the stop.
    expect(openTripAgainstDecidedOrigin(output, new Date(Date.parse(at(60)) + 1_000).toISOString(), config, at(78)))
      .toMatchObject({ fromStaySegmentId: "origin", lastObservedAt: at(77) });
  });
});
