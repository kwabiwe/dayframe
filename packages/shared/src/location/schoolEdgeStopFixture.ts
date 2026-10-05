import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

// Shape-derived from a staging evening stop parked just outside the School's
// radius (times, accuracy, speed, distances from the School pin and receipt
// times). Geometry is synthetic: every observation sits on one axis at its
// observed distance from the School, with Home at the origin. No real
// coordinates. The parked fixes are 123–126 m from the pin, so they are only
// plausible School matches; the phone was silent for just over twelve minutes
// between two of them, and the drive away passed inside the radius.
export const SCHOOL_EDGE_HOME_ID = "10000000-0000-4000-8000-000000000061";
export const SCHOOL_EDGE_SCHOOL_ID = "10000000-0000-4000-8000-000000000062";
const SCHOOL_EDGE_GYM_ID = "10000000-0000-4000-8000-000000000063";
const DAY = "2026-01-31";
const SCHOOL_METRES = 1_020;
const at = (time: string) => new Date(`${DAY}T${time}Z`).toISOString();
const metresNorth = (metres: number) => metres / 111_195;
/** On the Home side of the School, at an observed distance from its pin. */
const fromSchool = (metres: number) => SCHOOL_METRES - metres;

type Observation = {
  id: string;
  time: string;
  metres?: number;
  accuracy?: number;
  speed?: number;
  kind?: LocationEvidence["kind"];
  endedAt?: string;
  place?: "home" | "school" | "gym";
  received: string;
};

const observations: Observation[] = [
  // At Home (synthetic anchors for the afternoon-long stay).
  { id: "home-0", time: "18:20:00", metres: 0, accuracy: 5, received: "18:20:01" },
  { id: "home-1", time: "18:50:00", metres: 0, accuracy: 5, received: "18:50:01" },
  // The new build starts: provider status and a registration snapshot, then the drive.
  { id: "provider-0808", time: "19:08:16", kind: "provider_status", received: "19:09:55.908" },
  { id: "leave-0-slc", time: "19:08:16", metres: 52, accuracy: 9.3, kind: "significant_change", received: "19:09:55.908" },
  { id: "leave-0", time: "19:08:16.041", metres: 52, accuracy: 9.3, received: "19:10:02.091" },
  { id: "leave-1", time: "19:08:18.109", metres: 55, accuracy: 8.6, received: "19:10:02.091" },
  { id: "gym-exit-0808", time: "19:08:18.337", kind: "geofence_exit", place: "gym", received: "19:08:18.337" },
  { id: "home-enter-0808", time: "19:08:18.385", kind: "geofence_enter", place: "home", received: "19:08:18.385" },
  { id: "school-exit-0808", time: "19:08:18.397", kind: "geofence_exit", place: "school", received: "19:08:18.397" },
  { id: "drive-0", time: "19:09:02.999", metres: 326, accuracy: 4.9, speed: 5.87, received: "19:10:02.091" },
  { id: "drive-1", time: "19:09:10.999", metres: 396, accuracy: 4.7, speed: 10.19, received: "19:10:02.091" },
  { id: "home-exit-0809", time: "19:09:11.185", kind: "geofence_exit", place: "home", received: "19:09:11.185" },
  { id: "drive-2", time: "19:09:13.999", metres: 426, accuracy: 4.7, speed: 10.99, received: "19:10:02.091" },
  { id: "drive-3", time: "19:09:19.999", metres: 505, accuracy: 3.4, speed: 13.38, received: "19:10:02.091" },
  // Past the School and round the block before parking.
  { id: "drive-4", time: "19:09:54.999", metres: fromSchool(148), accuracy: 2.2, speed: 11.87, received: "19:10:02.091" },
  { id: "drive-5", time: "19:10:01.999", metres: fromSchool(105), accuracy: 2.7, speed: 11.3, received: "19:10:02.091" },
  { id: "drive-6", time: "19:10:09.999", metres: fromSchool(116), accuracy: 2.1, speed: 10.6, received: "19:10:10.096" },
  { id: "drive-7", time: "19:10:17.999", metres: fromSchool(177), accuracy: 2.1, speed: 10.37, received: "19:10:18.167" },
  { id: "drive-8", time: "19:10:26.999", metres: fromSchool(252), accuracy: 2.6, speed: 8.34, received: "19:10:27.097" },
  // iOS dates the Visit from while the car was still circling; both callbacks sit at the parking spot.
  { id: "visit-1910-open", time: "19:10:35", metres: fromSchool(126), accuracy: 6.5, kind: "visit", received: "19:27:18.063" },
  { id: "visit-1910-done", time: "19:10:35", metres: fromSchool(123), accuracy: 53.4, kind: "visit", endedAt: "19:36:35", received: "19:37:49.36" },
  { id: "drive-9", time: "19:10:35.999", metres: fromSchool(299), accuracy: 2.8, speed: 10.11, received: "19:10:36.095" },
  { id: "drive-10", time: "19:10:44.999", metres: fromSchool(337), accuracy: 2.7, speed: 6.71, received: "19:10:45.093" },
  { id: "drive-11", time: "19:11:00.999", metres: fromSchool(297), accuracy: 2.4, speed: 6.18, received: "19:11:01.098" },
  { id: "drive-12", time: "19:11:18.999", metres: fromSchool(229), accuracy: 2.1, speed: 8.42, received: "19:11:19.097" },
  { id: "drive-13", time: "19:11:28", metres: fromSchool(168), accuracy: 2.1, speed: 8.76, received: "19:11:28.093" },
  { id: "parking", time: "19:11:41", metres: fromSchool(128), accuracy: 2.2, speed: 3.5, received: "19:11:41.1" },
  // Parked: three stationary fixes and a mirror, then silence for twelve minutes before the last one.
  { id: "parked-0-slc", time: "19:13:16", metres: fromSchool(126), accuracy: 3.5, kind: "significant_change", received: "19:13:17.36" },
  { id: "parked-0", time: "19:13:16.089", metres: fromSchool(126), accuracy: 3.5, speed: 0, received: "19:36:35.098" },
  { id: "parked-1", time: "19:15:06", metres: fromSchool(126), accuracy: 5.1, speed: 0, received: "19:36:35.099" },
  { id: "parked-2", time: "19:27:16.999", metres: fromSchool(123), accuracy: 7.8, speed: 0.06, received: "19:36:35.099" },
  // The drive home passes inside the School's radius.
  { id: "away-0", time: "19:36:26.999", metres: SCHOOL_METRES - 91, accuracy: 2.4, speed: 8.85, received: "19:36:35.099" },
  { id: "school-enter-1936", time: "19:36:27.231", kind: "geofence_enter", place: "school", received: "19:36:27.231" },
  { id: "away-1", time: "19:36:34.999", metres: SCHOOL_METRES - 86, accuracy: 2.1, speed: 10.72, received: "19:36:35.099" },
  { id: "away-2", time: "19:36:47.999", metres: fromSchool(158), accuracy: 2.2, speed: 10.91, received: "19:41:30.012" },
  { id: "school-exit-1936", time: "19:36:48.293", kind: "geofence_exit", place: "school", received: "19:36:48.293" },
  { id: "away-3", time: "19:36:55.999", metres: fromSchool(226), accuracy: 2.5, speed: 10.53, received: "19:41:30.012" },
  { id: "away-4-slc", time: "19:37:23", metres: 542, accuracy: 2.6, kind: "significant_change", received: "19:37:24.669" },
  { id: "away-4", time: "19:37:23.09", metres: 542, accuracy: 2.6, speed: 12.86, received: "19:41:30.012" },
  { id: "away-5", time: "19:37:28.999", metres: 460, accuracy: 2.5, speed: 13.5, received: "19:41:30.012" },
  { id: "away-6", time: "19:37:46.999", metres: 297, accuracy: 2, speed: 6.78, received: "19:41:30.012" },
  { id: "away-7", time: "19:37:47.999", metres: 292, accuracy: 2, speed: 6.57, received: "19:41:30.012" },
  // Home.
  { id: "visit-1938-open", time: "19:38:12", metres: 6, accuracy: 2.5, kind: "visit", received: "19:40:03.985" },
  { id: "arrive-0", time: "19:38:21.999", metres: 92, accuracy: 2.3, speed: 9.59, received: "19:41:30.012" },
  { id: "home-enter-1938", time: "19:38:22.28", kind: "geofence_enter", place: "home", received: "19:38:22.28" },
  { id: "arrive-1", time: "19:38:30.999", metres: 22, accuracy: 2.6, speed: 6.66, received: "19:41:30.012" },
  { id: "arrive-2", time: "19:39:35.999", metres: 7, accuracy: 6.9, speed: 0.41, received: "19:41:30.012" },
  { id: "arrive-3", time: "19:40:02.999", metres: 4, accuracy: 8.8, speed: 0.78, received: "19:41:30.013" },
  { id: "arrive-4", time: "19:41:23.985", metres: 0, accuracy: 5, received: "19:41:30.013" },
  { id: "arrive-5", time: "19:41:29.991", metres: 0, accuracy: 5, received: "19:41:30.013" },
  { id: "arrive-6-slc", time: "19:42:27", metres: 0, accuracy: 5, kind: "significant_change", received: "19:42:27.897" },
  { id: "arrive-6", time: "19:42:27.51", metres: 0, accuracy: 5, received: "19:42:27.676" }
];

/** Evidence as the server would hold it at `processingTime`, using recorded receipt times. */
export function schoolEdgeStopFixture(processingTime = "20:30:00", options: { exclude?: string[] } = {}): LocationEngineInput {
  const savedPlaces = [
    { id: SCHOOL_EDGE_HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false },
    { id: SCHOOL_EDGE_SCHOOL_ID, name: "School", latitude: metresNorth(SCHOOL_METRES), longitude: 0, radiusMeters: 100, loggingEnabled: true },
    { id: SCHOOL_EDGE_GYM_ID, name: "Gym", latitude: metresNorth(-3_000), longitude: 0, radiusMeters: 80, loggingEnabled: true }
  ];
  const placeIds = { home: SCHOOL_EDGE_HOME_ID, school: SCHOOL_EDGE_SCHOOL_ID, gym: SCHOOL_EDGE_GYM_ID };
  const processingAt = at(processingTime);
  const evidence = observations
    .filter((item) => !options.exclude?.includes(item.id) && at(item.received) <= processingAt)
    .map((item): LocationEvidence => ({
      clientEvidenceId: item.id,
      deviceId: "20000000-0000-4000-8000-000000000061",
      algorithmVersion: config.algorithmVersion,
      kind: item.kind ?? "standard_location",
      occurredAt: at(item.time),
      sourceTimestamp: at(item.time),
      endedAt: item.endedAt ? at(item.endedAt) : null,
      latitude: item.metres == null ? null : metresNorth(item.metres),
      longitude: item.metres == null ? null : 0,
      horizontalAccuracyMeters: item.accuracy ?? null,
      speedMetersPerSecond: item.speed ?? null,
      savedPlaceId: item.place ? placeIds[item.place] : null,
      receivedAt: at(item.received),
      timeZone: "Europe/London",
      isSimulated: false,
      metadata: item.kind === "visit" && !item.endedAt ? { visitDepartureOpen: true } : {}
    }));
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt, savedPlaces, acceptedLearnedPlaces: [], evidence
  };
}

export const schoolEdgeStopAt = at;
