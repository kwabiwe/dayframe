import { LOCATION_ENGINE_V2_CONFIG as config } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

// Shape-derived from a staging gym visit (times, accuracy, speed, distance from
// the Gym and drain/receipt times). Geometry is synthetic: every observation sits
// on one axis at its observed distance from an equatorial Gym. No real coordinates.
// The completed Visit drained 29 minutes after the device left, ending about a
// minute after the first departure evidence.
export const GYM_VISIT_PLACE_ID = "10000000-0000-4000-8000-000000000041";
const DAY = "2026-01-17";
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
  received: string;
  gym?: boolean;
};

const observations: Observation[] = [
  // Drives in: arrival-only Visit, geofence entry and a still fix, then a silent phone.
  { id: "arrive-0", time: "06:07:17.999", metres: 323, accuracy: 2.29, speed: 12.5, received: "06:07:18.281" },
  { id: "arrive-1-slc", time: "06:07:18", metres: 323, accuracy: 2.29, kind: "significant_change", received: "06:22:05.718" },
  { id: "arrive-2", time: "06:07:18.077", metres: 323, accuracy: 2.29, speed: 12.5, received: "06:12:18.429" },
  { id: "arrive-3", time: "06:07:23.999", metres: 326, accuracy: 3.61, speed: 12.21, received: "06:12:18.429" },
  { id: "gym-visit-open", time: "06:07:48", metres: 75, accuracy: 5.73, kind: "visit", received: "06:22:05.718" },
  { id: "gym-visit", time: "06:07:48", metres: 26, accuracy: 41.81, kind: "visit", endedAt: "07:15:12", received: "07:43:43.268" },
  { id: "arrive-4", time: "06:07:58.999", metres: 74, accuracy: 2.86, speed: 10.63, received: "06:12:18.429" },
  { id: "gym-enter", time: "06:07:59.163", kind: "geofence_enter", gym: true, received: "06:07:59.163" },
  { id: "arrive-5", time: "06:12:18", metres: 75, accuracy: 5.69, speed: 0.019, received: "06:12:18.429" },
  // An hour later: outside fixes and the exit, a pass back by the entrance, then away.
  { id: "leave-0", time: "07:14:08.435", metres: 198, accuracy: 13.81, received: "07:16:51.802" },
  { id: "gym-exit", time: "07:14:10.031", kind: "geofence_exit", gym: true, received: "07:14:10.031" },
  { id: "leave-1-slc", time: "07:14:14", metres: 211, accuracy: 29.52, kind: "significant_change", received: "07:16:49.021" },
  { id: "leave-2", time: "07:14:14.454", metres: 211, accuracy: 29.52, received: "07:16:51.803" },
  { id: "leave-3", time: "07:15:08.042", metres: 53, accuracy: 36.65, received: "07:16:51.803" },
  { id: "gym-reenter", time: "07:15:08.058", kind: "geofence_enter", gym: true, received: "07:15:08.058" },
  { id: "leave-4", time: "07:15:10.467", metres: 77, accuracy: 39.97, received: "07:16:51.803" },
  { id: "leave-5", time: "07:15:21.789", metres: 320, accuracy: 39.73, received: "07:16:51.803" },
  { id: "gym-exit-2", time: "07:15:21.833", kind: "geofence_exit", gym: true, received: "07:15:21.833" },
  // A short stop elsewhere; its Visits drain in the same batch as the completed Gym Visit.
  { id: "stop-visit-open", time: "07:15:51", metres: 500, accuracy: 58.38, kind: "visit", received: "07:43:43.268" },
  { id: "stop-visit", time: "07:15:51", metres: 522, accuracy: 54.38, kind: "visit", endedAt: "07:30:55", received: "07:43:43.268" },
  { id: "stop-0", time: "07:16:45.551", metres: 527, accuracy: 20, received: "07:16:51.803" },
  { id: "stop-1", time: "07:16:51.307", metres: 534, accuracy: 24.19, received: "07:16:51.803" },
  { id: "stop-2", time: "07:17:40.223", metres: 514, accuracy: 18.49, received: "07:17:46.991" },
  { id: "stop-3", time: "07:17:46.95", metres: 512, accuracy: 17.33, received: "07:17:46.991" },
  { id: "stop-4-slc", time: "07:19:40", metres: 499, accuracy: 25.05, kind: "significant_change", received: "07:43:43.268" },
  { id: "stop-5", time: "07:19:40.489", metres: 499, accuracy: 25.05, received: "07:32:19.336" },
];

/** Evidence as the server would hold it at `processingTime`, using recorded receipt times. */
export function gymVisitDepartureFixture(processingTime = "08:05:00", options: { visitEndedAt?: string; exclude?: string[] } = {}): LocationEngineInput {
  const gym = { id: GYM_VISIT_PLACE_ID, name: "Gym", latitude: 0, longitude: 0, radiusMeters: 80, loggingEnabled: false };
  const processingAt = at(processingTime);
  const evidence = observations
    .filter((item) => !options.exclude?.includes(item.id) && at(item.received) <= processingAt)
    .map((item): LocationEvidence => ({
      clientEvidenceId: item.id,
      deviceId: "20000000-0000-4000-8000-000000000041",
      algorithmVersion: config.algorithmVersion,
      kind: item.kind ?? "standard_location",
      occurredAt: at(item.time),
      sourceTimestamp: at(item.time),
      endedAt: item.endedAt ? at(item.id === "gym-visit" ? options.visitEndedAt ?? item.endedAt : item.endedAt) : null,
      latitude: item.metres == null ? null : metresNorth(item.metres),
      longitude: item.metres == null ? null : 0,
      horizontalAccuracyMeters: item.accuracy ?? null,
      speedMetersPerSecond: item.speed ?? null,
      savedPlaceId: item.gym ? GYM_VISIT_PLACE_ID : null,
      receivedAt: at(item.received),
      timeZone: "Europe/London",
      isSimulated: false,
      metadata: item.kind === "visit" && !item.endedAt ? { visitDepartureOpen: true } : {}
    }));
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt, savedPlaces: [gym], acceptedLearnedPlaces: [], evidence
  };
}

export const gymVisitAt = at;
