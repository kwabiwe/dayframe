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
  /** Extra fixes at the stop with explicit speed, e.g. a vehicle moving within the radius. */
  extra?: Array<{ at: number; speed: number; latitudeOffset?: number }>;
  /** First observed movement away from the stop. Omit to end the trace at the stop. */
  departAt?: number;
  /** When the device is back home (start of the home Visit). */
  returnAt?: number;
};

export function physicalStopFixture(shape: PhysicalStopShape): LocationEngineInput {
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
    ...[20_000, 40_000, 60_000].map((offset, i) => point(`out-${i}`, 600_000 + offset, 0.0025 * (i + 1), { speedMetersPerSecond: 12 })),
    // Final approach: still moving within the stop radius before the car stops.
    point("parking", 675_000, PHYSICAL_STOP_LATITUDE - 0.0001, { speedMetersPerSecond: 4 }),
    ...(shape.visit ? [visit("stop-visit", shape.visit[0], shape.visit[1], PHYSICAL_STOP_LATITUDE, 70)] : []),
    ...shape.slowAt.map((ms, i) => point(`slow-${i}`, ms, PHYSICAL_STOP_LATITUDE + 0.00001 * (i + 1), {
      speedMetersPerSecond: shape.slowSpeed ?? 0.6, horizontalAccuracyMeters: shape.slowAccuracy ?? 4
    })),
    ...(shape.extra ?? []).map((item, i) => point(`extra-${i}`, item.at, PHYSICAL_STOP_LATITUDE + (item.latitudeOffset ?? 0), {
      speedMetersPerSecond: item.speed
    }))
  ];
  if (shape.departAt != null) {
    const depart = shape.departAt;
    evidence.push(
      point("depart", depart, PHYSICAL_STOP_LATITUDE - 0.0005, { speedMetersPerSecond: 9.8 }),
      ...[14_000, 17_000, 36_000].map((offset, i) => point(`back-${i}`, depart + offset, 0.006 - 0.002 * i, { speedMetersPerSecond: 12 }))
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
