import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import type { LocationEvidence, LocationEngineInput } from "./types";

// Synthetic Journey-1 shape: occurrence and receipt clocks are intentionally
// distinct. No private coordinates or historical client catalogue are used.
const deviceId = "20000000-0000-4000-8000-000000000211";
const processingAt = "2026-09-23T22:00:00.000Z";
const riverside = {
  id: "10000000-0000-4000-8000-000000000211",
  name: "Synthetic Riverside",
  latitude: 51.5,
  longitude: -0.1,
  radiusMeters: 90
};
const home = {
  id: "10000000-0000-4000-8000-000000000212",
  name: "Synthetic Home",
  latitude: 51.5,
  longitude: -0.08,
  radiusMeters: 90
};
const learned = {
  id: "10000000-0000-4000-8000-000000000213",
  name: "Synthetic learned Home",
  latitude: 51.5,
  longitude: -0.0798,
  radiusMeters: 90,
  accepted: true as const
};

function signal(
  id: string,
  at: string,
  longitude: number,
  extra: Partial<LocationEvidence> = {}
): LocationEvidence {
  return {
    clientEvidenceId: id,
    deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location",
    occurredAt: `2026-09-23T${at}.000Z`,
    receivedAt: processingAt,
    timeZone: "Europe/London",
    latitude: 51.5,
    longitude,
    horizontalAccuracyMeters: 25,
    ...extra
  };
}

export function journeyIdentityFixture(): LocationEngineInput {
  return {
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    evidence: [
      signal("riverside-1", "16:26:00", -0.1),
      signal("riverside-2", "16:36:00", -0.1),
      signal("riverside-3", "16:46:58", -0.1),
      signal("route-out-1", "16:49:00", -0.096, { speedMetersPerSecond: 10 }),
      signal("route-out-2", "16:52:00", -0.09, { speedMetersPerSecond: 10 }),
      signal("route-out-3", "16:54:00", -0.084, { speedMetersPerSecond: 10 }),
      signal("home-visit", "16:55:00", -0.0798, {
        kind: "visit",
        endedAt: "2026-09-23T17:13:00.000Z",
        horizontalAccuracyMeters: 120
      }),
      signal("home-early-1", "16:55:30", -0.0798),
      signal("home-early-2", "16:57:00", -0.0798),
      signal("home-late-1", "17:11:00", -0.0798),
      signal("home-late-2", "17:13:00", -0.0798),
      signal("station-route-1", "17:20:00", -0.071, { speedMetersPerSecond: 8 }),
      signal("station-dropoff", "17:25:00", -0.065),
      signal("return-route-1", "19:44:00", -0.069, { speedMetersPerSecond: 8 }),
      signal("return-route-2", "19:47:00", -0.074, { speedMetersPerSecond: 8 }),
      signal("return-route-3", "19:49:00", -0.078, { speedMetersPerSecond: 8 }),
      signal("home-final-1", "19:51:48", -0.0798),
      signal("home-final-2", "19:57:00", -0.0798),
      signal("home-final-3", "20:02:00", -0.0798)
    ],
    savedPlaces: [riverside, home],
    acceptedLearnedPlaces: [learned],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt
  };
}
