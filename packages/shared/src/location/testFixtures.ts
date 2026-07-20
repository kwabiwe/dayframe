import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import type { LocationEngineInput, LocationEvidence, SavedPlaceForMatching } from "./types";

export const LOCATION_ACCEPTANCE_PLACE_IDS = {
  home: "10000000-0000-4000-8000-000000000001",
  nearbySchool: "10000000-0000-4000-8000-000000000002",
  sportsVenue: "10000000-0000-4000-8000-000000000003",
  shortStop: "10000000-0000-4000-8000-000000000004",
  roundTripHome: "10000000-0000-4000-8000-000000000005"
} as const;

export const LOCATION_ACCEPTANCE_PLACES: SavedPlaceForMatching[] = [
  { id: LOCATION_ACCEPTANCE_PLACE_IDS.home, name: "HOME", latitude: 51.5007, longitude: -0.1246, radiusMeters: 80, priority: 10 },
  { id: LOCATION_ACCEPTANCE_PLACE_IDS.nearbySchool, name: "NEARBY_SCHOOL_POI", latitude: 51.50221, longitude: -0.1246, radiusMeters: 65, priority: 0 },
  { id: LOCATION_ACCEPTANCE_PLACE_IDS.sportsVenue, name: "SPORTS_VENUE", latitude: 51.5097, longitude: -0.1246, radiusMeters: 90, priority: 5 },
  { id: LOCATION_ACCEPTANCE_PLACE_IDS.shortStop, name: "SHORT_STOP", latitude: 51.5, longitude: -0.02, radiusMeters: 90, priority: 5 },
  { id: LOCATION_ACCEPTANCE_PLACE_IDS.roundTripHome, name: "ROUND_TRIP_HOME", latitude: 51.5, longitude: 0.08, radiusMeters: 85, priority: 5 }
];

// Synthetic London-relative points only. Do not copy real investigation addresses into fixtures.
const ROUND_TRIP_POI = { latitude: 51.503, longitude: 0.08 };

function sample(
  id: string,
  occurredAt: string,
  point: { latitude: number; longitude: number },
  options: Partial<LocationEvidence> = {}
): LocationEvidence {
  return {
    clientEvidenceId: id,
    deviceId: "20000000-0000-4000-8000-000000000001",
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location",
    occurredAt,
    latitude: point.latitude,
    longitude: point.longitude,
    horizontalAccuracyMeters: 25,
    receivedAt: "2026-07-20T20:00:00.000Z",
    timeZone: "Europe/London",
    ...options
  };
}

function atPlace(
  prefix: string,
  localTimes: string[],
  place: SavedPlaceForMatching,
  accuracy = 25
) {
  return localTimes.map((time, index) =>
    sample(`${prefix}-${index + 1}`, `2026-07-20T${time}.000Z`, place, {
      horizontalAccuracyMeters: accuracy
    })
  );
}

export function locationAcceptanceFixture(): LocationEngineInput {
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const sports = LOCATION_ACCEPTANCE_PLACES[2];
  const shortStop = LOCATION_ACCEPTANCE_PLACES[3];
  const roundTripHome = LOCATION_ACCEPTANCE_PLACES[4];
  const route = (id: string, time: string, latitude: number, longitude: number) =>
    sample(id, `2026-07-20T${time}.000Z`, { latitude, longitude }, { speedMetersPerSecond: 12 });
  const evidence = [
    ...atPlace("home-a", ["08:00:00", "08:08:00", "08:16:00"], home),
    ...atPlace("sport-a", ["08:37:00", "08:45:00", "08:53:00"], sports),
    ...atPlace("home-b", ["09:05:00", "09:13:00", "09:21:00", "09:29:00"], home),
    ...atPlace("sport-b", ["09:44:00", "09:52:00", "10:00:00"], sports),
    ...atPlace("home-c", ["10:18:00", "10:26:00", "10:34:00", "10:39:00"], home),
    route("journey-a-1", "10:40:00", 51.5, -0.09),
    route("journey-a-2", "10:55:00", 51.5, -0.06),
    route("journey-a-3", "11:05:00", 51.5, -0.03),
    ...atPlace("short-stop", ["11:12:00", "11:19:00", "11:25:00"], shortStop),
    route("journey-b-1", "11:27:00", 51.5, 0.0),
    route("journey-b-2", "11:35:00", 51.5, 0.03),
    route("journey-b-3", "11:55:00", 51.5, 0.06),
    ...atPlace("round-trip-home-a", ["12:27:00", "12:35:00", "12:43:00", "12:48:00"], roundTripHome),
    ...["12:50:00", "12:58:00", "13:08:00", "13:18:00", "13:28:00", "13:38:00", "13:48:00", "13:58:00", "14:08:00", "14:17:00"].map(
      (time, index) => sample(`round-trip-poi-${index + 1}`, `2026-07-20T${time}.000Z`, ROUND_TRIP_POI, { horizontalAccuracyMeters: 20 })
    ),
    route("round-trip-return", "14:28:00", 51.5015, 0.08),
    ...atPlace("round-trip-home-b", ["14:38:00", "14:46:00", "14:54:00", "15:02:00", "15:10:00", "15:18:00"], roundTripHome)
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
    savedPlaces: LOCATION_ACCEPTANCE_PLACES,
    acceptedLearnedPlaces: [],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt: "2026-07-20T20:00:00.000Z"
  };
}

export function nearbySavedPlaceFixture() {
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  return {
    input: {
      latitude: home.latitude + 0.0003,
      longitude: home.longitude,
      horizontalAccuracyMeters: 45,
      savedPlaceIdHint: home.id
    },
    places: LOCATION_ACCEPTANCE_PLACES.slice(0, 2)
  };
}
