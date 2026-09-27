import { LOCATION_ENGINE_V2_CONFIG } from "../../src/location/config";
import type { LocationEngineInput, LocationEvidence } from "../../src/location/types";

const at = (time: string) => `2026-09-27T${time}Z`;
const deviceId = "synthetic-visit-device";

function observation(
  clientEvidenceId: string,
  kind: LocationEvidence["kind"],
  time: string,
  latitude: number,
  longitude: number,
  accuracy: number,
  speed: number | null = null,
  endedAt: string | null = null
): LocationEvidence {
  return {
    clientEvidenceId,
    deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind,
    occurredAt: at(time),
    endedAt: endedAt ? at(endedAt) : null,
    latitude,
    longitude,
    horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: speed,
    receivedAt: at("12:00:00.000"),
    sourceTimestamp: at(time),
    timeZone: "Europe/London",
    isSimulated: false,
    metadata: kind === "visit" ? { visitDepartureOpen: !endedAt } : undefined
  };
}

/** Sanitised geometry and identifiers; timing/quality relationships mirror the reported failure. */
export function unknownVisitArrivalFixture(): LocationEngineInput {
  return {
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt: at("12:00:00.000"),
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    savedPlaces: [{
      id: "10000000-0000-4000-8000-000000000010",
      name: "Synthetic origin",
      latitude: 51.5,
      longitude: -0.14,
      radiusMeters: 80,
      loggingEnabled: false
    }],
    acceptedLearnedPlaces: [],
    evidence: [
      observation("origin-visit", "visit", "10:00:00.000", 51.5, -0.14, 25, null, "10:08:00.000"),
      observation("route-1", "standard_location", "10:12:00.000", 51.502, -0.137, 18, 6.2),
      observation("route-2", "standard_location", "10:21:00.000", 51.507, -0.127, 16, 5.1),
      observation("route-last-moving", "standard_location", "10:27:44.000", 51.50835, -0.12, 18, 2.79),
      observation("visit-arrival", "visit", "10:28:03.000", 51.51, -0.12, 30.3),
      observation("visit-completed", "visit", "10:28:03.000", 51.51, -0.12, 70.4, null, "10:51:38.000"),
      observation("later-slow", "standard_location", "10:32:44.000", 51.51003, -0.12001, 14, 0.76)
    ]
  };
}
