import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

/** Fixture instants: minutes after an arbitrary synthetic origin. */
export const largeBuildingAt = (minutes: number) => new Date(Date.UTC(2026, 0, 12, 8) + Math.round(minutes * 60_000)).toISOString();

// Arbitrary equatorial geometry in metres around a made-up origin (the centre iOS reported for the
// building Visit) and synthetic identities. The shape is derived from a retained trace without copying
// its coordinates or times: a long stay inside one large building while walking around it, an accurate
// arrival Visit, a broad (104 m) completed Visit covering the whole stay, sparse fixes with 35–86 minute
// silences, and fixes up to 160 m from the arrival cluster that still lie inside the Visit's radius.
const METRES_PER_DEGREE_LATITUDE = 110_574;
const METRES_PER_DEGREE_LONGITUDE = 111_320;
const latitude = (northMetres: number) => northMetres / METRES_PER_DEGREE_LATITUDE;
const longitude = (eastMetres: number) => eastMetres / METRES_PER_DEGREE_LONGITUDE;

export const LARGE_BUILDING_HOME_ID = "10000000-0000-4000-8000-000000000031";
const DEVICE_ID = "20000000-0000-4000-8000-000000000031";
/** The saved home lies 2 km west of the building. */
const HOME = { north: 0, east: -2_000 };
/** The arrival cluster lies 70 m south of the Visit's reported centre. */
const ARRIVAL = { north: -70, east: 0 };

export type LargeBuildingShape = {
  /** Completed Visit departure, minutes from the origin (default 297.5); null leaves only the arrival callback. */
  visitEndsAt?: number | null;
  /** Where the far fix at minute 175 lies, metres north of the Visit centre (default 90: 160 m from the arrival cluster). */
  farFixNorth?: number;
  /** The far fix's horizontal accuracy in metres (default 13). */
  farFixAccuracy?: number;
};

export const LARGE_BUILDING_FAR_FIX_ID = "building-far";

export function largeBuildingVisitFixture(shape: LargeBuildingShape = {}): LocationEngineInput {
  const visitEndsAt = shape.visitEndsAt === undefined ? 297.5 : shape.visitEndsAt;
  const point = (id: string, minutes: number, north: number, east: number, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE_ID, algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: largeBuildingAt(minutes), sourceTimestamp: largeBuildingAt(minutes),
    receivedAt: largeBuildingAt(420), timeZone: "UTC", latitude: latitude(north), longitude: longitude(east),
    horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, isSimulated: false, ...patch
  });
  const visit = (id: string, minutes: number, endsAt: number | null, north: number, east: number, accuracy: number) =>
    point(id, minutes, north, east, {
      kind: "visit", endedAt: endsAt == null ? null : largeBuildingAt(endsAt), horizontalAccuracyMeters: accuracy,
      speedMetersPerSecond: null, metadata: endsAt == null ? { visitDepartureOpen: true } : undefined
    });
  const motion = (minutes: number, activity: "stationary" | "walking" | "automotive"): LocationEvidence => ({
    clientEvidenceId: `motion-${minutes}`, deviceId: DEVICE_ID, algorithmVersion: config.algorithmVersion,
    kind: "motion_activity", occurredAt: largeBuildingAt(minutes), sourceTimestamp: largeBuildingAt(minutes),
    receivedAt: largeBuildingAt(420), timeZone: "UTC", latitude: null, longitude: null, horizontalAccuracyMeters: null,
    speedMetersPerSecond: null, isSimulated: false, metadata: { motionActivity: activity, motionConfidence: "high" }
  });
  const home = (id: string, minutes: number, patch: Partial<LocationEvidence> = {}) => point(id, minutes, HOME.north, HOME.east, patch);
  const evidence: LocationEvidence[] = [
    // At home, then a drive east to the building.
    visit("home-visit", 0, 58, HOME.north, HOME.east, 20),
    home("home-a", 0), home("home-b", 20), home("home-c", 40), home("home-d", 57),
    point("drive-out-1", 60, 0, -1_500, { speedMetersPerSecond: 12 }),
    point("drive-out-2", 62, 0, -1_000, { speedMetersPerSecond: 12 }),
    point("drive-out-3", 64, 0, -500, { speedMetersPerSecond: 12 }),
    point("walk-in", 66, -60, -150, { speedMetersPerSecond: 1.4, horizontalAccuracyMeters: 8 }),
    // iOS reports the arrival precisely and, on departure, one broad Visit for the whole stay.
    visit("building-arrival", 68, null, ARRIVAL.north, ARRIVAL.east, 16),
    ...(visitEndsAt == null ? [] : [visit("building-visit", 68, visitEndsAt, 0, 0, 104)]),
    // A few minutes of fixes at the arrival cluster, then the phone goes quiet (distance filter).
    ...[71, 72.5, 74, 76, 78, 80.5].map((minutes, index) => point(`building-arrival-${index}`, minutes,
      ARRIVAL.north + (index % 3) - 1, ARRIVAL.east + (index % 2) * 2, { horizontalAccuracyMeters: 9 + index * 1.5 })),
    point("building-quiet-1", 116, -45, 0, { horizontalAccuracyMeters: 13 }),
    // After a 59-minute silence: one accurate fix across the building, taken walking.
    point(LARGE_BUILDING_FAR_FIX_ID, 175, shape.farFixNorth ?? 90, 0, { horizontalAccuracyMeters: shape.farFixAccuracy ?? 13, speedMetersPerSecond: 1.6 }),
    // An 86-minute silence, then a 25-minute one, all inside the Visit's radius.
    point("building-quiet-2", 261, 80, 20, { horizontalAccuracyMeters: 19 }),
    point("building-quiet-3", 287, -50, 50, { horizontalAccuracyMeters: 17 }),
    // Leaving after the Visit's departure: a walk out, then the drive home.
    point("walk-out-1", 298, 200, 100, { horizontalAccuracyMeters: 9, speedMetersPerSecond: 1.7 }),
    point("walk-out-2", 300, 400, 200, { horizontalAccuracyMeters: 10, speedMetersPerSecond: 1.6 }),
    point("drive-home-1", 305, 100, -600, { speedMetersPerSecond: 12 }),
    point("drive-home-2", 309, 0, -1_400, { speedMetersPerSecond: 12 }),
    point("drive-home-3", 313, 0, -1_900, { speedMetersPerSecond: 4 }),
    visit("home-return-visit", 315, 400, HOME.north, HOME.east, 20),
    home("home-return-a", 315.5), home("home-return-b", 330), home("home-return-c", 360), home("home-return-d", 390),
    // Core Motion: walking spells throughout the stay, not stillness.
    motion(0, "stationary"), motion(59.5, "automotive"), motion(65.5, "walking"), motion(70, "stationary"),
    motion(95, "walking"), motion(108, "stationary"), motion(150, "walking"), motion(164, "stationary"),
    motion(172, "walking"), motion(186, "stationary"), motion(200, "walking"), motion(206, "stationary"),
    motion(255, "walking"), motion(268, "stationary"), motion(284, "walking"), motion(290, "stationary"),
    motion(296, "walking"), motion(302, "automotive"), motion(313.5, "walking"), motion(316, "stationary")
  ];
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: largeBuildingAt(420),
    savedPlaces: [{ id: LARGE_BUILDING_HOME_ID, name: "Home", latitude: latitude(HOME.north), longitude: longitude(HOME.east), radiusMeters: 100, loggingEnabled: false }],
    acceptedLearnedPlaces: [], evidence
  };
}
