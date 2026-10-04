import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, LocationEvidence } from "../src/location/types";
import { simulate, type Scenario, type SimPlace } from "./fixtures/captureSimulator";

const HOME_ID = "10000000-0000-4000-8000-0000000000f1";
const DEVICE = "20000000-0000-4000-8000-0000000000f1";
const t0 = Date.parse("2026-03-09T08:00:00Z");
const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
const north = (metres: number) => metres / 111_195;

function point(id: string, minutes: number, metres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes + 1), timeZone: "UTC", endedAt: null,
    latitude: north(metres), longitude: 0, horizontalAccuracyMeters: 4, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}

/** Home, a 2 km drive out and straight back, and a return arrival Visit dated while still 400 m away. */
function roundTrip(options: { returnVisit?: boolean } = {}): LocationEngineInput {
  const evidence: LocationEvidence[] = [
    point("home-0", 0, 0), point("home-1", 10, 3), point("home-2", 20, 0),
    { ...point("home-exit", 30.2, 0), kind: "geofence_exit", latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, savedPlaceId: HOME_ID }
  ];
  // Out at 11 m/s with the 75 m distance filter, then back.
  let minutes = 30.3;
  for (let metres = 120; metres <= 2_000; metres += 75, minutes += 75 / 11 / 60) evidence.push(point(`out-${metres}`, minutes, metres, { speedMetersPerSecond: 11 }));
  for (let metres = 1_925; metres >= 120; metres -= 75, minutes += 75 / 11 / 60) evidence.push(point(`back-${metres}`, minutes, metres, { speedMetersPerSecond: 11 }));
  const backAt = minutes;
  if (options.returnVisit !== false) {
    // iOS dates the arrival before the car stops; its coordinate is at Home.
    const visitAt = backAt - 0.6;
    evidence.push({ ...point("return-visit", visitAt, 5), kind: "visit", horizontalAccuracyMeters: 10, speedMetersPerSecond: null,
      metadata: { visitDepartureOpen: true }, receivedAt: at(backAt + 5) });
  }
  evidence.push(
    point("arrive-0", backAt, 60, { speedMetersPerSecond: 6 }),
    { ...point("home-enter", backAt + 0.05, 0), kind: "geofence_enter", latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, savedPlaceId: HOME_ID },
    point("home-3", backAt + 1, 2), point("home-4", backAt + 15, 0), point("home-5", backAt + 40, 3)
  );
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(backAt + 120), acceptedLearnedPlaces: [], evidence,
    savedPlaces: [{ id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false }]
  };
}
const commutes = (input: LocationEngineInput) =>
  runLocationEngine(input).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");

describe("the start of a same-place round trip", () => {
  it("is the departure, not the return's early-dated arrival Visit", () => {
    const output = runLocationEngine(roundTrip());
    const [home] = output.segmentUpserts;
    const trips = output.segmentUpserts.filter((segment) => segment.kind === "commute");
    // The whole 5.6-minute drive, from where the Home stay ended.
    expect(trips).toEqual([expect.objectContaining({ startedAt: home.stoppedAt, qualificationReason: "same_place_meaningful_round_trip" })]);
    expect(Date.parse(trips[0].stoppedAt!) - Date.parse(trips[0].startedAt)).toBeGreaterThan(5 * 60_000);
  });

  it("matches the trip without the early Visit", () => {
    const withVisit = commutes(roundTrip());
    expect(withVisit.map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]))
      .toEqual(commutes(roundTrip({ returnVisit: false })).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]));
  });

  // Simulated capture: two short stops on one outing, each with a single still fix and a Visit.
  const HOME: SimPlace = { id: HOME_ID, name: "Home", at: { x: 0, y: 0 }, radius: 100, loggingEnabled: false };
  const outing: Scenario = { start: "2026-03-09T12:00:00Z", origin: HOME.at, places: [HOME], legs: [
    { kind: "stay", minutes: 60 }, { kind: "drive", to: { x: 1_500, y: 300 } }, { kind: "stay", minutes: 6 },
    { kind: "drive", to: { x: 1_900, y: 900 } }, { kind: "stay", minutes: 7 },
    { kind: "drive", to: HOME.at, via: [{ x: 900, y: 600 }] }, { kind: "stay", minutes: 90 }
  ] };
  it.each(Array.from({ length: 20 }, (_, index) => index + 1))("keeps a simulated outing with short stops (seed %i)", (seed) => {
    const sim = simulate(outing, seed);
    const trips = commutes(sim.input());
    // The whole outing (about 60–80 minutes in) is one round trip from Home.
    expect(trips.some((trip) => trip.qualificationReason === "same_place_meaningful_round_trip" &&
      trip.startedAt <= sim.at(62) && trip.stoppedAt! >= sim.at(78))).toBe(true);
  });
});
