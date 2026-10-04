import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

/** Fixture instants: milliseconds after an arbitrary synthetic origin. */
export const physicalStopAt = (ms: number) => new Date(Date.UTC(2026, 0, 10) + ms).toISOString();

// Arbitrary equatorial geometry (0.009° latitude ≈ 1 km) and synthetic identities.
// Shapes are derived from retained traces without copying their coordinates:
// a pickup with a native Visit and slow fixes that start minutes after arrival,
// and brief kerbside stops where iOS reported 5–7 minute Visits.
export const PHYSICAL_STOP_LATITUDE = 0.009;
export const PHYSICAL_STOP_HOME_ID = "10000000-0000-4000-8000-000000000021";

export type PhysicalStopShape = {
  /** Native Visit [arrival, departure] in ms from fixture start, or null for no Visit. */
  visit: [number, number] | null;
  /** Slow fixes at the stop, ms from fixture start. */
  slowAt: number[];
  slowAccuracy?: number;
  slowSpeed?: number;
  /** Extra fixes relative to the stop, e.g. a vehicle moving within the radius or broad fixes elsewhere. */
  extra?: Array<{ at: number; speed: number | null; latitudeOffset?: number; accuracy?: number }>;
  /** Stop latitude; defaults to about 1 km from Home. */
  stopLatitude?: number;
  /** Outbound and return route latitudes; default to straight lines between Home and the stop. */
  outLatitudes?: [number, number, number];
  backLatitudes?: [number, number, number];
  /** First observed movement away from the stop. Omit to end the trace at the stop. */
  departAt?: number;
  /** When the device is back home (start of the home Visit). */
  returnAt?: number;
};

export function physicalStopFixture(shape: PhysicalStopShape): LocationEngineInput {
  const stopLatitude = shape.stopLatitude ?? PHYSICAL_STOP_LATITUDE;
  const out = shape.outLatitudes ?? [0.0025, 0.005, 0.0075];
  const back = shape.backLatitudes ?? [0.006, 0.004, 0.002];
  const home = { id: PHYSICAL_STOP_HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 60, loggingEnabled: false };
  const point = (id: string, ms: number, latitude: number, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: id, deviceId: "20000000-0000-4000-8000-000000000021", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: physicalStopAt(ms), sourceTimestamp: physicalStopAt(ms), receivedAt: physicalStopAt(9_000_000),
    timeZone: "UTC", latitude, longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, isSimulated: false, ...patch
  });
  const visit = (id: string, start: number, stop: number, latitude: number, accuracy = 20) =>
    point(id, start, latitude, { kind: "visit", endedAt: physicalStopAt(stop), horizontalAccuracyMeters: accuracy, speedMetersPerSecond: null });
  const evidence: LocationEvidence[] = [
    visit("home-visit", 0, 600_000, 0), point("home-a", 0, 0), point("home-b", 300_000, 0), point("home-c", 600_000, 0),
    ...[20_000, 40_000, 60_000].map((offset, i) => point(`out-${i}`, 600_000 + offset, out[i], { speedMetersPerSecond: 12 })),
    // Final approach: still moving within the stop radius before the car stops.
    point("parking", 675_000, stopLatitude - 0.0001, { speedMetersPerSecond: 4 }),
    ...(shape.visit ? [visit("stop-visit", shape.visit[0], shape.visit[1], stopLatitude, 70)] : []),
    ...shape.slowAt.map((ms, i) => point(`slow-${i}`, ms, stopLatitude + 0.00001 * (i + 1), {
      speedMetersPerSecond: shape.slowSpeed ?? 0.6, horizontalAccuracyMeters: shape.slowAccuracy ?? 4
    })),
    ...(shape.extra ?? []).map((item, i) => point(`extra-${i}`, item.at, stopLatitude + (item.latitudeOffset ?? 0), {
      speedMetersPerSecond: item.speed, horizontalAccuracyMeters: item.accuracy ?? 5
    }))
  ];
  if (shape.departAt != null) {
    const depart = shape.departAt;
    evidence.push(
      point("depart", depart, stopLatitude - 0.0005, { speedMetersPerSecond: 9.8 }),
      ...[14_000, 17_000, 36_000].map((offset, i) => point(`back-${i}`, depart + offset, back[i], { speedMetersPerSecond: 12 }))
    );
  }
  if (shape.returnAt != null) {
    evidence.push(visit("return-visit", shape.returnAt, shape.returnAt + 600_000, 0),
      ...[0, 300_000, 600_000].map((offset, i) => point(`return-${i}`, shape.returnAt! + offset, 0)));
  }
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: physicalStopAt(9_000_000), savedPlaces: [home], acceptedLearnedPlaces: [], evidence
  };
}

/** Owner-confirmed ~9 minute pickup: Visit, slow fixes spread over 92 s, then quiet until departure. */
export const PHYSICAL_STOP_PICKUP: PhysicalStopShape = {
  visit: [670_000, 1_220_000],
  slowAt: [860_000, 886_000, 892_000, 893_000, 952_000],
  departAt: 1_224_000,
  returnAt: 1_308_000
};
