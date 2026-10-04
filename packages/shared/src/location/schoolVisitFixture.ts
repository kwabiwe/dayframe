import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

// Shape-derived from a staging school drop-off then a 24-minute stop (times,
// accuracy, speed, distances and drain/receipt times). Geometry is synthetic:
// every observation sits on one axis at its observed distance from the School,
// with Home at the origin. No real coordinates. The stop's arrival-only Visit is
// accurate and corroborated by the School geofence; its completed callback is
// 94 m broad and drained 30 minutes after the device left.
export const SCHOOL_VISIT_HOME_ID = "10000000-0000-4000-8000-000000000051";
export const SCHOOL_VISIT_SCHOOL_ID = "10000000-0000-4000-8000-000000000052";
const SCHOOL_VISIT_GYM_ID = "10000000-0000-4000-8000-000000000053";
const DAY = "2026-01-24";
const at = (time: string) => new Date(`${DAY}T${time}Z`).toISOString();
const metresNorth = (metres: number) => metres / 111_195;

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
  // At Home; the School place is saved at 06:44 (its registration callbacks).
  { id: "home-0", time: "06:08:25.446", metres: 0, accuracy: 5, received: "06:49:31.431" },
  { id: "home-1", time: "06:26:25.727", metres: 0, accuracy: 5, received: "06:49:31.431" },
  { id: "home-2", time: "06:26:28.591", metres: 0, accuracy: 5, received: "06:49:31.431" },
  { id: "home-3", time: "06:27:12.896", metres: 0, accuracy: 5, received: "06:49:31.431" },
  { id: "home-4", time: "06:27:13.216", metres: 0, accuracy: 5, received: "06:49:31.431" },
  { id: "home-5", time: "06:27:17.115", metres: 6, accuracy: 14.7, received: "06:49:31.431" },
  { id: "home-6", time: "06:27:27.957", metres: 6, accuracy: 15, received: "06:49:31.432" },
  { id: "home-7", time: "06:27:32.292", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "home-8", time: "06:27:35.504", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "home-9", time: "06:27:35.525", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "home-10", time: "06:27:38.714", metres: 6, accuracy: 12, received: "06:49:31.432" },
  { id: "home-11", time: "06:34:02.31", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "home-12", time: "06:35:05.827", metres: 6, accuracy: 14.1, received: "06:49:31.432" },
  { id: "home-13", time: "06:43:16.712", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "home-14", time: "06:43:20.092", metres: 0, accuracy: 5, received: "06:49:31.432" },
  { id: "gym-exit-0644", time: "06:44:42.732", kind: "geofence_exit", place: "gym", received: "06:44:42.732" },
  { id: "home-enter-0644", time: "06:44:42.847", kind: "geofence_enter", place: "home", received: "06:44:42.847" },
  { id: "school-exit-0644", time: "06:44:42.849", kind: "geofence_exit", place: "school", received: "06:44:42.849" },
  { id: "home-15", time: "06:46:17.029", metres: 6, accuracy: 43.7, received: "06:49:31.433" },
  { id: "home-16", time: "06:46:17.394", metres: 0, accuracy: 5, received: "06:49:31.433" },
  { id: "home-17", time: "06:46:20.007", metres: 6, accuracy: 18.3, received: "06:49:31.433" },
  // Leaves Home, a one-minute drop-off at the School, then on to a stop just inside its radius.
  { id: "home-18", time: "06:49:26.928", metres: 197, accuracy: 27, received: "06:49:31.433" },
  { id: "home-exit-0649", time: "06:49:32.461", kind: "geofence_exit", place: "home", received: "06:49:32.461" },
  { id: "out-0", time: "06:49:48.925", metres: 318, accuracy: 22.2, received: "06:55:10.277" },
  { id: "out-1-slc", time: "06:50:05", metres: 426, accuracy: 25.7, kind: "significant_change", received: "06:52:01.15" },
  { id: "out-2", time: "06:50:05.349", metres: 426, accuracy: 25.7, received: "06:55:10.277" },
  { id: "out-3", time: "06:50:13.868", metres: 562, accuracy: 64.1, received: "06:55:10.277" },
  { id: "out-4", time: "06:50:53.992", metres: 842, accuracy: 23, received: "06:55:10.277" },
  { id: "school-enter-0650", time: "06:50:54.283", kind: "geofence_enter", place: "school", received: "06:50:54.283" },
  { id: "out-5", time: "06:51:03.075", metres: 819, accuracy: 25.3, received: "06:55:10.277" },
  { id: "out-6", time: "06:51:46.061", metres: 1061, accuracy: 21.1, received: "06:55:10.277" },
  { id: "out-7", time: "06:51:55.196", metres: 1064, accuracy: 23, received: "06:55:10.277" },
  { id: "out-8", time: "06:52:00.792", metres: 1069, accuracy: 22.4, received: "06:55:10.277" },
  { id: "out-9", time: "06:52:53.497", metres: 1157, accuracy: 21, received: "06:55:10.277" },
  // Arrival-only Visit (accurate) and its broad completed callback, both drained at 07:47:58; then a silent phone.
  { id: "school-exit-0652", time: "06:52:53.676", kind: "geofence_exit", place: "school", received: "06:52:53.676" },
  { id: "visit-0653-open", time: "06:53:00", metres: 983, accuracy: 12.2, kind: "visit", received: "07:47:58.667" },
  { id: "visit-0653-done", time: "06:53:00", metres: 996, accuracy: 93.9, kind: "visit", endedAt: "07:17:43", received: "07:47:58.667" },
  { id: "stop-0", time: "06:53:41.131", metres: 992, accuracy: 22, received: "06:55:10.277" },
  { id: "school-enter-0653", time: "06:53:41.329", kind: "geofence_enter", place: "school", received: "06:53:41.329" },
  { id: "stop-1-slc", time: "06:55:09", metres: 982, accuracy: 32.7, kind: "significant_change", received: "07:47:58.667" },
  { id: "stop-2", time: "06:55:09.631", metres: 982, accuracy: 32.7, received: "06:55:10.277" },
  // Leaves 22 minutes later: an outside fix and the School exit, then the drive home.
  { id: "back-0", time: "07:17:47.589", metres: 721, accuracy: 29.7, received: "07:23:22.775" },
  { id: "school-exit-0717", time: "07:17:48.218", kind: "geofence_exit", place: "school", received: "07:17:48.218" },
  { id: "gym-exit-0717", time: "07:17:48.224", kind: "geofence_exit", place: "gym", received: "07:17:48.224" },
  { id: "home-exit-0717", time: "07:17:48.227", kind: "geofence_exit", place: "home", received: "07:17:48.227" },
  { id: "back-1", time: "07:17:55.791", metres: 684, accuracy: 20, received: "07:23:22.777" },
  { id: "back-2-slc", time: "07:18:18", metres: 441, accuracy: 22.9, kind: "significant_change", received: "07:47:58.667" },
  { id: "back-3", time: "07:18:18.53", metres: 441, accuracy: 22.9, received: "07:23:22.778" },
  { id: "back-4", time: "07:18:18.563", metres: 441, accuracy: 22.9, received: "07:23:22.778" },
  { id: "back-5", time: "07:18:44.347", metres: 289, accuracy: 21, received: "07:23:22.778" },
  { id: "back-6", time: "07:18:51.14", metres: 289, accuracy: 25, received: "07:23:22.779" },
  // Home arrival.
  { id: "visit-0721-open", time: "07:21:35", metres: 13, accuracy: 10.4, kind: "visit", received: "07:47:58.667" },
  { id: "arrive-0", time: "07:21:52", metres: 99, accuracy: 2.4, speed: 9.37, received: "07:23:22.779" },
  { id: "home-enter-0721", time: "07:21:52.166", kind: "geofence_enter", place: "home", received: "07:21:52.166" },
  { id: "arrive-1", time: "07:22:02", metres: 25, accuracy: 2.3, speed: 7.12, received: "07:23:22.779" },
  { id: "arrive-2", time: "07:22:40", metres: 13, accuracy: 6.9, speed: 0.4, received: "07:23:22.78" },
  { id: "arrive-3-slc", time: "07:23:19", metres: 2, accuracy: 16.2, kind: "significant_change", received: "07:47:58.667" },
  { id: "arrive-4", time: "07:23:19.08", metres: 2, accuracy: 16.2, speed: 0.13, received: "07:23:22.78" },
];

/** Evidence as the server would hold it at `processingTime`, using recorded receipt times. */
export function schoolVisitFixture(processingTime = "08:30:00", options: { exclude?: string[]; visitEndedAt?: string } = {}): LocationEngineInput {
  const savedPlaces = [
    { id: SCHOOL_VISIT_HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false },
    { id: SCHOOL_VISIT_SCHOOL_ID, name: "School", latitude: metresNorth(916), longitude: 0, radiusMeters: 100, loggingEnabled: true },
    { id: SCHOOL_VISIT_GYM_ID, name: "Gym", latitude: metresNorth(-3_000), longitude: 0, radiusMeters: 80, loggingEnabled: true }
  ];
  const placeIds = { home: SCHOOL_VISIT_HOME_ID, school: SCHOOL_VISIT_SCHOOL_ID, gym: SCHOOL_VISIT_GYM_ID };
  const processingAt = at(processingTime);
  const evidence = observations
    .filter((item) => !options.exclude?.includes(item.id) && at(item.received) <= processingAt)
    .map((item): LocationEvidence => ({
      clientEvidenceId: item.id,
      deviceId: "20000000-0000-4000-8000-000000000051",
      algorithmVersion: config.algorithmVersion,
      kind: item.kind ?? "standard_location",
      occurredAt: at(item.time),
      sourceTimestamp: at(item.time),
      endedAt: item.endedAt ? at(item.id === "visit-0653-done" ? options.visitEndedAt ?? item.endedAt : item.endedAt) : null,
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

export const schoolVisitAt = at;
