import { LOCATION_ENGINE_V2_CONFIG as config } from "../../src/location/config";
import type { LocationEngineInput, LocationEvidence } from "../../src/location/types";

// Arbitrary equatorial geometry, synthetic identities, exact diagnostic durations.
export const shortAt = (ms: number) => new Date(Date.UTC(2026, 0, 10) + ms).toISOString();
export function shortJourneysFixture(savedDestination = false): LocationEngineInput {
  const home = { id: "10000000-0000-4000-8000-000000000011", name: "Origin", latitude: 0, longitude: 0, radiusMeters: 60, loggingEnabled: false };
  const destination = { ...home, id: "10000000-0000-4000-8000-000000000012", name: "Destination", latitude: 0.009 };
  const point = (id: string, ms: number, latitude: number, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: id, deviceId: "20000000-0000-4000-8000-000000000011", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: shortAt(ms), sourceTimestamp: shortAt(ms), receivedAt: shortAt(3_000_000),
    timeZone: "UTC", latitude, longitude: 0, horizontalAccuracyMeters: 10, speedMetersPerSecond: 0, isSimulated: false, ...patch
  });
  const visit = (id: string, start: number, stop: number, latitude: number) => point(id, start, latitude, {kind: "visit", endedAt: shortAt(stop)});
  return {
    priorState: {algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null},
    config, processingAt: shortAt(3_000_000), savedPlaces: savedDestination ? [home, destination] : [home], acceptedLearnedPlaces: [],
    evidence: [visit("origin-visit", 0, 600_000, 0), point("origin-a", 0, 0), point("origin-b", 300_000, 0), point("origin-c", 600_000, 0),
      ...[20_000,40_000,60_000].map((offset,i)=>point(`out-${i}`,600_000+offset,0.0025*(i+1),{speedMetersPerSecond:12})),
      visit("destination-visit",684_496,1_284_496,0.009), ...[684_496,984_496,1_284_496].map((ms,i)=>point(`destination-${i}`,ms,0.009)),
      ...[20_000,40_000,60_000].map((offset,i)=>point(`back-${i}`,1_284_496+offset,0.009-0.0025*(i+1),{speedMetersPerSecond:12})),
      visit("return-visit",1_365_496,1_965_496,0), ...[1_365_496,1_665_496,1_965_496].map((ms,i)=>point(`return-${i}`,ms,0))]
  };
}
