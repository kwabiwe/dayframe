import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEvidence, MotionActivity, MotionConfidence } from "../src/location/types";

// Location v3 bug 9 (16 Oct 2026). Synthetic geometry only: Home at the origin, School 3 km north.
const HOME_ID = "10000000-0000-4000-8000-0000000004b1";
const SCHOOL_ID = "10000000-0000-4000-8000-0000000004b2";
const DEVICE = "20000000-0000-4000-8000-0000000004b1";
const t0 = Date.parse("2026-10-15T15:00:00Z");
const at = (minutes: number) => new Date(t0 + Math.round(minutes * 60_000)).toISOString();
const north = (metres: number) => metres / 111_195;

function fix(id: string, minute: number, metres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(minute + 1), timeZone: "UTC", endedAt: null,
    latitude: north(metres), longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minute: number, kind: "geofence_enter" | "geofence_exit", placeId: string) =>
  fix(id, minute, 0, { kind, savedPlaceId: placeId, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
function motion(steps: Array<[minute: number, activity: MotionActivity, confidence?: MotionConfidence]>, queriedAtMinute = 200): LocationEvidence[] {
  return steps.map(([minute, activity, confidence = "high"], index) => ({
    clientEvidenceId: `motion-${index}`, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "motion_activity",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(Math.max(minute, queriedAtMinute)), timeZone: "UTC",
    endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null,
    savedPlaceId: null, isSimulated: null, metadata: { motionActivity: activity, motionConfidence: confidence }
  }));
}

/** Home until minute 60, a journey to School over `minutes`, School afterwards; route fixes every minute. */
function journey(minutes: number, routeSpeed: number | null, extra: LocationEvidence[] = []) {
  const evidence = [
    ...[0, 15, 30, 45, 60].map((minute, index) => fix(`home-${index}`, minute, index % 2 * 3)),
    crossing("home-exit", 60.5, "geofence_exit", HOME_ID),
    ...Array.from({ length: minutes - 1 }, (_, index) =>
      fix(`route-${index}`, 61 + index, 300 + (index + 1) * (2_400 / minutes), { speedMetersPerSecond: routeSpeed })),
    crossing("school-enter", 60 + minutes + 0.2, "geofence_enter", SCHOOL_ID),
    ...[0.5, 10, 20, 40].map((offset, index) => fix(`school-${index}`, 60 + minutes + offset, 3_000 + index % 2 * 4)),
    ...extra
  ];
  const [trip] = runLocationEngine({
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(240), evidence, acceptedLearnedPlaces: [],
    savedPlaces: [
      { id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true },
      { id: SCHOOL_ID, name: "School", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true }
    ]
  }).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
  return trip;
}

describe("travel mode through iOS's unknown spells (location v3 bug 9)", () => {
  // A 13-minute stop-and-go drive: three automotive records with long unknown spells between them, so
  // confident movement covers under half the journey. No native speed on the route fixes, so only
  // Motion & Fitness can say how it was travelled.
  const stopAndGo = (middle: MotionActivity, middleConfidence: MotionConfidence = "high") => motion([
    [40, "stationary"], [60.6, "automotive"], [62.6, "unknown"], [65.6, middle, middleConfidence], [66.6, "unknown"],
    [70.6, "automotive"], [72.6, "unknown"], [73.2, "stationary"]
  ]);

  it("carries the mode across unknown spells between two records of it", () => {
    expect(journey(13, null, stopAndGo("automotive"))).toMatchObject({ toPlaceId: SCHOOL_ID, travelMode: "automotive" });
  });

  it("carries across low-confidence records of the same mode", () => {
    expect(journey(13, null, stopAndGo("automotive", "low")).travelMode).toBe("automotive");
  });

  it("never carries across stillness, even low-confidence stillness (a stop, not travel)", () => {
    expect(journey(13, null, stopAndGo("stationary")).travelMode).toBeUndefined();
    expect(journey(13, null, stopAndGo("stationary", "low")).travelMode).toBeUndefined();
  });

  it("never carries a mode across a low-confidence record of another one", () => {
    const walkLowDriveWalk = motion([[40, "stationary"], [60.6, "walking"], [61.6, "automotive", "low"], [72.6, "walking"], [73.2, "stationary"]]);
    expect(journey(13, null, walkLowDriveWalk).travelMode).not.toBe("walking");
  });

  it("never carries between two different modes", () => {
    const walkThenDrive = motion([[40, "stationary"], [60.6, "walking"], [62.6, "unknown"], [71.6, "automotive"], [73.2, "stationary"]]);
    expect(journey(13, null, walkThenDrive).travelMode).toBeUndefined();
  });
});

describe("travel mode from route speed when Motion & Fitness gives none (location v3 bug 9)", () => {
  // A short drive Core Motion has not called yet: only unknown records.
  const unknownOnly = motion([[40, "stationary"], [60.6, "unknown"], [64.4, "stationary"]]);

  it("calls three or more fast accurate fixes a drive", () => {
    expect(journey(4, 12, unknownOnly).travelMode).toBe("automotive");
    expect(journey(4, 12).travelMode).toBe("automotive");
  });

  it("calls stays far apart covered fast a drive, even without native speed", () => {
    // 2.7 km between the stays in 3.2 minutes: no walk, run or ride does that.
    expect(journey(3, null, unknownOnly).travelMode).toBe("automotive");
    // 2.7 km in 36 minutes is not.
    expect(journey(36, null).travelMode).toBeUndefined();
  });

  it("needs three independent fast fixes", () => {
    const trip = journey(4, 12, unknownOnly);
    expect(trip.routeSampleCount).toBe(3);
    const slower = journey(20, null, [fix("fast-a", 61.1, 900, { speedMetersPerSecond: 12 }),
      fix("fast-b", 61.105, 900, { speedMetersPerSecond: 12 })]);
    expect(slower.travelMode).toBeUndefined();
  });

  it("calls walking-pace fixes with none faster a walk", () => {
    expect(journey(36, 1.4).travelMode).toBe("walking");
    const oneFast = journey(36, 1.4, [fix("fast", 70.5, 900, { speedMetersPerSecond: 9 })]);
    expect(oneFast.travelMode).toBeUndefined();
  });

  it("never overrides a mode Motion & Fitness gave", () => {
    const walked = motion([[40, "stationary"], [60.6, "walking"], [96.4, "stationary"]]);
    expect(journey(36, 12, walked).travelMode).toBe("walking");
  });

  it("ignores broad and simulated fixes", () => {
    expect(journey(20, null, [fix("broad-0", 61.2, 700, { speedMetersPerSecond: 12, horizontalAccuracyMeters: 80 }),
      fix("broad-1", 62.2, 1_400, { speedMetersPerSecond: 12, horizontalAccuracyMeters: 80 }),
      fix("broad-2", 63.2, 2_100, { speedMetersPerSecond: 12, horizontalAccuracyMeters: 80 })]).travelMode).toBeUndefined();
    expect(journey(20, null, [fix("sim-0", 61.2, 700, { speedMetersPerSecond: 12, isSimulated: true }),
      fix("sim-1", 62.2, 1_400, { speedMetersPerSecond: 12, isSimulated: true }),
      fix("sim-2", 63.2, 2_100, { speedMetersPerSecond: 12, isSimulated: true })]).travelMode).toBeUndefined();
  });
});
