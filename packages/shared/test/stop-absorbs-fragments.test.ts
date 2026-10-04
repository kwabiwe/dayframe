import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

// Shape of a simulated edge stop (capture simulator, seed 2): the drive passes
// through the School's circle, iOS reports entering and leaving it, and the car
// parks 124 m from the pin. One still fix, a ten-minute silence, a second still
// fix, then the drive home crosses the circle again. Metres east/north of the
// School pin; synthetic geometry and identities.
const SCHOOL_ID = "10000000-0000-4000-8000-0000000000d2";
const HOME_ID = "10000000-0000-4000-8000-0000000000d1";
const DEVICE = "20000000-0000-4000-8000-0000000000d1";
const t0 = Date.parse("2026-03-02T10:00:00Z");
const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
const LAT0 = 51.7;
const latitude = (y: number) => LAT0 + y / 110_540;
const longitude = (x: number) => x / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
type Row = [id: string, minutes: number, x: number | null, y: number | null, accuracy: number | null, speed: number | null,
  kind?: LocationEvidence["kind"], extra?: Partial<LocationEvidence>];
const rows: Row[] = [
  ["home-0", 0, -530, -750, 5, 0], ["home-1", 30, -528, -752, 5, 0], ["home-2", 59.9, -530, -749, 5, 0],
  ["drive-0", 60.12, -489, -679, 3.6, 10.49], ["drive-1", 60.36, -406, -549, 3.6, 11.23],
  ["home-exit", 60.49, null, null, null, null, "geofence_exit", { savedPlaceId: HOME_ID }],
  ["visit-open", 60.5, 89, 89, 10, null, "visit", { metadata: { visitDepartureOpen: true } }],
  ["visit-done", 60.5, 94, 29, 66, null, "visit", { endedAt: at(87.35) }],
  ["drive-2", 60.73, -283, -340, 2.8, 9.39], ["drive-3", 61.1, -134, -154, 4.4, 11.08], ["drive-4", 61.35, -28, -37, 2.4, 9.58],
  ["school-enter", 61.44, null, null, null, null, "geofence_enter", { savedPlaceId: SCHOOL_ID }],
  ["drive-5", 61.48, 27, 24, 4.4, 10.11], ["drive-6", 61.6, 81, 76, 4, 12.35],
  ["school-exit", 61.63, null, null, null, null, "geofence_exit", { savedPlaceId: SCHOOL_ID }],
  ["parked-0", 61.95, 88, 84, 3.4, 0.27], ["parked-1", 71.71, 86, 91, 5.8, 0.07],
  ["away-0", 85.73, 33, 27, 4.8, 11.54],
  ["school-enter-2", 85.97, null, null, null, null, "geofence_enter", { savedPlaceId: SCHOOL_ID }],
  ["away-1", 85.86, -22, -29, 2.2, 10.29], ["away-2", 85.98, -75, -85, 2.5, 9.66], ["away-3", 86.1, -133, -144, 3.1, 9.7],
  ["school-exit-2", 86.22, null, null, null, null, "geofence_exit", { savedPlaceId: SCHOOL_ID }],
  ["away-4", 86.22, -183, -203, 4.8, 9.62], ["away-5", 86.47, -277, -328, 4.4, 11.77], ["away-6", 86.84, -402, -528, 4.6, 9.4],
  ["home-visit", 86.77, -522, -756, 9, null, "visit", { metadata: { visitDepartureOpen: true } }],
  ["away-7", 87.08, -485, -677, 4.4, 10.95], ["away-8", 87.21, -526, -742, 4.2, 9.6],
  ["home-enter", 87.26, null, null, null, null, "geofence_enter", { savedPlaceId: HOME_ID }],
  ["home-3", 88.16, -526, -749, 6.3, 0.14], ["home-4", 120, -530, -750, 5, 0]
];
function edgeStop(drop: string[] = []): LocationEngineInput {
  const evidence = rows.filter(([id]) => !drop.includes(id)).map(([id, minutes, x, y, accuracy, speed, kind, extra]): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: kind ?? "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes), endedAt: null, timeZone: "UTC",
    latitude: x == null ? null : latitude(y!), longitude: x == null ? null : longitude(x), horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: speed, savedPlaceId: null, isSimulated: kind ? null : false, metadata: {}, ...extra
  }));
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(200), acceptedLearnedPlaces: [], evidence,
    savedPlaces: [
      { id: HOME_ID, name: "Home", latitude: latitude(-750), longitude: longitude(-530), radiusMeters: 100, loggingEnabled: false },
      { id: SCHOOL_ID, name: "School", latitude: latitude(0), longitude: longitude(0), radiusMeters: 100, loggingEnabled: true }
    ]
  };
}
const stays = (input: LocationEngineInput) =>
  runLocationEngine(input).segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
const between = (list: StaySegment[], from: number, to: number) => list.filter((stay) => stay.startedAt > at(from) && stay.startedAt < at(to));

describe("a physical stop that covers fragments of itself", () => {
  it("replaces a fragment that place logic started late", () => {
    const [stop, ...others] = between(stays(edgeStop()), 61, 80);
    expect(others).toEqual([]);
    // The stop starts at the observed arrival (the last moving fix), not after the silence.
    expect(stop).toMatchObject({ startedAt: at(61.6), placeMatchKind: "unknown", placeId: null, formation: "physical_stop" });
    expect(stop.candidatePlaceIds).toContain(SCHOOL_ID);
    expect(Date.parse(stop.stoppedAt!)).toBeGreaterThanOrEqual(Date.parse(at(85.7)));
  });

  it("keeps the promoted stay when it already covers the stop", () => {
    // Without the drive through the circle there is no pending exit: place logic's stay starts at the
    // first parked fix and agrees with the stop to within a minute, so it keeps precedence.
    const kept = between(stays(edgeStop(["school-enter", "drive-5", "drive-6", "school-exit"])), 61, 80);
    expect(kept).toHaveLength(1);
    expect(kept[0].formation).toBeUndefined();
  });

  // The thirty-minute silence limit is pinned by saved-place-arrival-boundaries.test.ts, whose
  // contract (no presence across 48 unsupported minutes) fails without it.
});
