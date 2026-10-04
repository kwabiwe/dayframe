import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

// Shape-derived from a staging school run (times, accuracy, speed, distance from
// Home and drain/receipt times). Geometry is synthetic: every observation sits on
// one axis at its observed distance from an equatorial Home. No real coordinates.
export const SCHOOL_RUN_HOME_ID = "10000000-0000-4000-8000-000000000031";
const DAY = "2026-01-12";
const at = (time: string) => `${DAY}T${time}.000Z`;
const metresNorth = (metres: number) => metres / 111_195;

type Observation = {
  id: string;
  time: string;
  metres?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  kind?: LocationEvidence["kind"];
  endedAt?: string;
  received?: string;
  home?: boolean;
};

const observations: Observation[] = [
  // Already at Home.
  ...["06:40:00", "06:50:00", "07:00:00", "07:10:00", "07:20:00", "07:26:00"].map((time, i) =>
    ({ id: `home-before-${i}`, time, metres: 5, accuracy: 5, speed: 0, received: time })),
  // Leaves Home and drives to school.
  { id: "home-exit", time: "07:26:56", kind: "geofence_exit", home: true, received: "07:26:56" },
  { id: "out-0", time: "07:26:56", metres: 257, accuracy: 7, received: "07:26:56" },
  { id: "out-1", time: "07:27:12", metres: 262, accuracy: 10, received: "07:32:32" },
  { id: "out-2", time: "07:27:16", metres: 327, accuracy: 3, speed: 9.8, received: "07:32:32" },
  { id: "out-3", time: "07:27:21", metres: 397, accuracy: 5, speed: 13, received: "07:32:32" },
  { id: "out-3-slc", time: "07:27:22", metres: 397, accuracy: 5, kind: "significant_change", received: "07:46:52" },
  { id: "out-4", time: "07:27:22", metres: 397, accuracy: 5, speed: 13, received: "07:32:32" },
  { id: "out-5", time: "07:27:23", metres: 427, accuracy: 5, speed: 13, received: "07:32:32" },
  { id: "out-6", time: "07:27:29", metres: 516, accuracy: 5, speed: 14.3, received: "07:32:32" },
  // About fourteen minutes at an unsaved school.
  { id: "school-visit-open", time: "07:27:57", metres: 869, accuracy: 17, kind: "visit", received: "07:46:52" },
  { id: "school-visit", time: "07:27:57", metres: 880, accuracy: 49, kind: "visit", endedAt: "07:41:57", received: "07:46:52" },
  { id: "school-0", time: "07:32:32", metres: 869, accuracy: 14, received: "07:32:32" },
  { id: "school-0-slc", time: "07:32:33", metres: 873, accuracy: 12, kind: "significant_change", received: "07:46:52" },
  { id: "school-1", time: "07:32:33", metres: 873, accuracy: 12, received: "07:42:31" },
  // Two-minute drive back.
  { id: "back-0-slc", time: "07:42:31", metres: 396, accuracy: 2, kind: "significant_change", received: "07:46:52" },
  { id: "back-0", time: "07:42:31", metres: 396, accuracy: 2, speed: 13.1, received: "07:42:31" },
  { id: "back-1", time: "07:42:37", metres: 329, accuracy: 2, speed: 7.9, received: "08:23:25" },
  { id: "back-2", time: "07:42:48", metres: 276, accuracy: 2, speed: 8.5, received: "08:23:25" },
  { id: "back-3", time: "07:42:49", metres: 271, accuracy: 2, speed: 7.6, received: "08:23:25" },
  // Arrives Home: arrival-only Visit, geofence entry, slowing fixes, then a still phone.
  { id: "home-visit-open", time: "07:43:15", metres: 19, accuracy: 15, kind: "visit", received: "07:46:52" },
  { id: "arrive-0", time: "07:43:22", metres: 88, accuracy: 2, speed: 8.6, received: "08:23:25" },
  { id: "home-enter", time: "07:43:23", kind: "geofence_enter", home: true, received: "07:43:23" },
  { id: "arrive-1", time: "07:43:32", metres: 20, accuracy: 2, speed: 5.7, received: "08:23:25" },
  { id: "arrive-2", time: "07:45:32", metres: 10, accuracy: 20, speed: 0, received: "08:23:25" },
  { id: "arrive-3", time: "07:46:51", metres: 15, accuracy: 15, speed: 0, received: "08:23:25" },
  // Thirty-six minutes later the phone reports Home again.
  { id: "home-later-0", time: "08:22:56", metres: 0, accuracy: 5, received: "08:23:25" },
  { id: "home-later-1", time: "08:23:05", metres: 0, accuracy: 5, received: "08:56:42" },
  { id: "home-later-2", time: "08:38:00", metres: 1, accuracy: 5, speed: 0.1, received: "08:56:42" },
  { id: "home-later-3", time: "08:38:42", metres: 1, accuracy: 9, received: "08:56:42" },
  { id: "home-later-4", time: "09:00:58", metres: 0, accuracy: 5, received: "09:01:03" }
];

/** Evidence as the server would hold it at `processingTime`, using recorded receipt times. */
export function schoolRunArrivalFixture(processingTime = "09:30:00", options: { exclude?: string[] } = {}): LocationEngineInput {
  const home = { id: SCHOOL_RUN_HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false };
  const processingAt = at(processingTime);
  const evidence = observations
    .filter((item) => !options.exclude?.includes(item.id) && at(item.received ?? item.time) <= processingAt)
    .map((item): LocationEvidence => ({
      clientEvidenceId: item.id,
      deviceId: "20000000-0000-4000-8000-000000000031",
      algorithmVersion: config.algorithmVersion,
      kind: item.kind ?? "standard_location",
      occurredAt: at(item.time),
      sourceTimestamp: at(item.time),
      endedAt: item.endedAt ? at(item.endedAt) : null,
      latitude: item.metres == null ? null : metresNorth(item.metres),
      longitude: item.metres == null ? null : 0,
      horizontalAccuracyMeters: item.accuracy ?? null,
      speedMetersPerSecond: item.speed ?? null,
      savedPlaceId: item.home ? SCHOOL_RUN_HOME_ID : null,
      receivedAt: at(item.received ?? item.time),
      timeZone: "Europe/London",
      isSimulated: false,
      metadata: item.kind === "visit" && !item.endedAt ? { visitDepartureOpen: true } : {}
    }));
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt, savedPlaces: [home], acceptedLearnedPlaces: [], evidence
  };
}

export const schoolRunAt = at;
