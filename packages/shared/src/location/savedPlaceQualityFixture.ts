import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import type { LocationEngineInput, LocationEvidence } from "./types";

// Synthetic coordinates; only the times are derived from the supplied incident summary.
export const place = { id: "10000000-0000-4000-8000-000000000091", name: "Synthetic gym", latitude: 51.5, longitude: -0.1, radiusMeters: 90 };
export function signal(id: string, time: string, options: Partial<LocationEvidence> = {}): LocationEvidence {
  return { clientEvidenceId: id, deviceId: "20000000-0000-4000-8000-000000000099", algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt: `2026-09-15T${time}.000Z`, receivedAt: "2026-09-15T14:00:00.000Z", timeZone: "Europe/London",
    latitude: place.latitude, longitude: place.longitude, horizontalAccuracyMeters: 25, ...options };
}
export function input(evidence: LocationEvidence[]): LocationEngineInput {
  return { evidence, savedPlaces: [place], acceptedLearnedPlaces: [], config: LOCATION_ENGINE_V2_CONFIG, processingAt: "2026-09-15T14:00:00.000Z",
    priorState: { algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null } };
}
export function incident(visit = true) {
  return input([
    ...(visit ? [signal("visit", "11:55:29", { kind: "visit", endedAt: "2026-09-15T12:46:44.000Z" })] : []),
    signal("inside-1", "11:55:35"),
    signal("exit", "11:56:43", { kind: "geofence_exit", savedPlaceId: place.id, latitude: null, longitude: null, horizontalAccuracyMeters: null }),
    signal("inside-2", "11:58:52"), signal("inside-3", "12:05:48"), signal("inside-4", "12:32:26"), signal("inside-5", "12:40:47")
  ]);
}
