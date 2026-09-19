import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import type { LocationEngineInput, LocationEvidence, SavedPlaceForMatching } from "./types";

// Synthetic coordinates and names only. The timestamps mirror the reported shape,
// but this fixture is not a copy of a private device trace.
export const ARRIVAL_BOUNDARY_DEVICE_ID = "20000000-0000-4000-8000-000000000121";
export const ARRIVAL_BOUNDARY_PLACE: SavedPlaceForMatching = {
  id: "10000000-0000-4000-8000-000000000121",
  name: "Synthetic arrival venue",
  latitude: 51.5,
  longitude: -0.08,
  radiusMeters: 90
};
export const ARRIVAL_BOUNDARY_ORIGIN = {
  id: "10000000-0000-4000-8000-000000000122",
  name: "Synthetic origin",
  latitude: 51.5,
  longitude: -0.1,
  radiusMeters: 90
} satisfies SavedPlaceForMatching;

export const ARRIVAL_BOUNDARY_VISIT_AT = "2026-09-17T11:32:51.000Z";
export const ARRIVAL_BOUNDARY_VISIT_END = "2026-09-17T12:34:53.000Z";
export const ARRIVAL_BOUNDARY_PROCESSING_AT = "2026-09-17T15:00:00.000Z";

function signal(
  id: string,
  occurredAt: string,
  point: { latitude: number; longitude: number } | null,
  options: Partial<LocationEvidence> = {}
): LocationEvidence {
  return {
    clientEvidenceId: id,
    deviceId: ARRIVAL_BOUNDARY_DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location",
    occurredAt,
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    horizontalAccuracyMeters: 25,
    receivedAt: ARRIVAL_BOUNDARY_PROCESSING_AT,
    timeZone: "Europe/London",
    ...options
  };
}

export type SavedPlaceArrivalFixtureOptions = {
  includeVisit?: boolean;
  visitAccuracyMeters?: number | null;
  visitEndedAt?: string | null;
  includeArrivalGeofence?: boolean;
};

export function savedPlaceArrivalBoundaryFixture(
  options: SavedPlaceArrivalFixtureOptions = {}
): LocationEngineInput {
  const {
    includeVisit = true,
    visitAccuracyMeters = 120,
    visitEndedAt = ARRIVAL_BOUNDARY_VISIT_END,
    includeArrivalGeofence = true
  } = options;
  const evidence: LocationEvidence[] = [
    signal("origin-1", "2026-09-17T10:50:00.000Z", ARRIVAL_BOUNDARY_ORIGIN),
    signal("origin-2", "2026-09-17T10:58:00.000Z", ARRIVAL_BOUNDARY_ORIGIN),
    signal("origin-3", "2026-09-17T11:06:00.000Z", ARRIVAL_BOUNDARY_ORIGIN),
    signal("route-out-1", "2026-09-17T11:10:00.000Z", { latitude: 51.5, longitude: -0.097 }, { speedMetersPerSecond: 10 }),
    signal("route-out-2", "2026-09-17T11:20:00.000Z", { latitude: 51.5, longitude: -0.09 }, { speedMetersPerSecond: 10 }),
    signal("route-out-3", "2026-09-17T11:30:00.000Z", { latitude: 51.5, longitude: -0.083 }, { speedMetersPerSecond: 10 }),
    ...(includeVisit
      ? [signal("arrival-visit", ARRIVAL_BOUNDARY_VISIT_AT, ARRIVAL_BOUNDARY_PLACE, {
          kind: "visit",
          endedAt: visitEndedAt,
          horizontalAccuracyMeters: visitAccuracyMeters
        })]
      : []),
    ...(includeArrivalGeofence
      ? [signal("arrival-geofence-enter", "2026-09-17T11:33:26.000Z", null, {
          kind: "geofence_enter",
          savedPlaceId: ARRIVAL_BOUNDARY_PLACE.id,
          horizontalAccuracyMeters: null
        })]
      : []),
    signal("arrival-strong-1", "2026-09-17T11:33:30.000Z", ARRIVAL_BOUNDARY_PLACE),
    signal("arrival-strong-2", "2026-09-17T11:36:18.000Z", ARRIVAL_BOUNDARY_PLACE),
    signal("later-strong-1", "2026-09-17T12:21:00.000Z", ARRIVAL_BOUNDARY_PLACE),
    signal("later-strong-2", "2026-09-17T12:26:00.000Z", ARRIVAL_BOUNDARY_PLACE),
    signal("later-strong-3", "2026-09-17T12:31:00.000Z", ARRIVAL_BOUNDARY_PLACE),
    signal("route-back-1", "2026-09-17T12:36:00.000Z", { latitude: 51.5, longitude: -0.085 }, { speedMetersPerSecond: 10 }),
    signal("route-back-2", "2026-09-17T12:39:00.000Z", { latitude: 51.5, longitude: -0.095 }, { speedMetersPerSecond: 10 }),
    signal("route-back-3", "2026-09-17T12:41:00.000Z", { latitude: 51.5, longitude: -0.101 }, { speedMetersPerSecond: 10 }),
    signal("return-origin-1", "2026-09-17T12:42:00.000Z", ARRIVAL_BOUNDARY_ORIGIN),
    signal("return-origin-2", "2026-09-17T12:50:00.000Z", ARRIVAL_BOUNDARY_ORIGIN),
    signal("return-origin-3", "2026-09-17T12:58:00.000Z", ARRIVAL_BOUNDARY_ORIGIN)
  ];
  return {
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    evidence,
    savedPlaces: [ARRIVAL_BOUNDARY_ORIGIN, ARRIVAL_BOUNDARY_PLACE],
    acceptedLearnedPlaces: [],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt: ARRIVAL_BOUNDARY_PROCESSING_AT
  };
}

/**
 * A finite, synthetic arrival-rich workload for local cost regression checks.
 * Each of twenty episodes has 51 ordinary points and one less-precise Visit.
 */
export function savedPlaceArrivalBoundaryPerformanceFixture(): LocationEngineInput {
  const processingAt = "2026-01-20T00:00:00.000Z";
  const evidence: LocationEvidence[] = [];
  const baseAt = Date.parse("2026-01-01T00:00:00.000Z");
  for (let episode = 0; episode < 20; episode += 1) {
    const episodeAt = baseAt + episode * 6 * 60 * 60 * 1_000;
    for (let pointIndex = 0; pointIndex <= 50; pointIndex += 1) {
      const fraction = pointIndex < 3 ? 0 : pointIndex < 10 ? (pointIndex - 2) / 8 : 1;
      evidence.push(signal(
        `arrival-performance-${episode}-${pointIndex}`,
        new Date(episodeAt + pointIndex * 60_000).toISOString(),
        {
          latitude: 51.5,
          longitude: -0.1 + fraction * 0.02
        },
        {
          receivedAt: processingAt,
          speedMetersPerSecond: pointIndex >= 3 && pointIndex < 10 ? 8 : 0
        }
      ));
    }
    evidence.push(signal(
      `arrival-performance-${episode}-visit`,
      new Date(episodeAt + 10 * 60_000).toISOString(),
      ARRIVAL_BOUNDARY_PLACE,
      {
        kind: "visit",
        endedAt: new Date(episodeAt + 50 * 60_000).toISOString(),
        receivedAt: processingAt,
        horizontalAccuracyMeters: 120
      }
    ));
  }
  return {
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    evidence,
    savedPlaces: [ARRIVAL_BOUNDARY_ORIGIN, ARRIVAL_BOUNDARY_PLACE],
    acceptedLearnedPlaces: [],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt
  };
}
