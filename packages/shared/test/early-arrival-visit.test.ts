import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

const HOME_ID = "10000000-0000-4000-8000-0000000000e1";
const DEVICE = "20000000-0000-4000-8000-0000000000e1";
const t0 = Date.parse("2026-03-09T18:00:00Z");
const at = (seconds: number) => new Date(t0 + seconds * 1_000).toISOString();
const north = (metres: number) => metres / 111_195;

function reading(id: string, seconds: number, metres: number | null, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(seconds), sourceTimestamp: at(seconds), receivedAt: at(seconds + 60), endedAt: null, timeZone: "UTC",
    latitude: metres == null ? null : north(metres), longitude: metres == null ? null : 0, horizontalAccuracyMeters: metres == null ? null : 4,
    speedMetersPerSecond: metres == null ? null : 11, savedPlaceId: null, isSimulated: false, metadata: {}, ...patch
  };
}

/**
 * A drive home from 2 km at 11 m/s, arriving at `arrival` seconds. iOS dates the arrival Visit
 * `visitEarlySeconds` before that, while the car is still on the road; the phone is then silent at Home.
 */
function homecoming(options: { visitEarlySeconds?: number; exitInWindow?: boolean; noPlaceEvidence?: boolean } = {}) {
  const evidence: LocationEvidence[] = [];
  let seconds = 0;
  for (let metres = 2_000; metres > 100; metres -= 77, seconds += 7) evidence.push(reading(`approach-${metres}`, seconds, metres));
  const arrival = seconds;
  if (!options.noPlaceEvidence) {
    evidence.push(reading("home-enter", arrival + 2, null, { kind: "geofence_enter", savedPlaceId: HOME_ID }),
      reading("home-0", arrival + 30, 8, { speedMetersPerSecond: 0.1 }));
  }
  if (options.exitInWindow) evidence.push(reading("home-exit", arrival - 60, null, { kind: "geofence_exit", savedPlaceId: HOME_ID }));
  evidence.push(reading("arrival-visit", arrival - (options.visitEarlySeconds ?? 100), 6, {
    kind: "visit", horizontalAccuracyMeters: 8, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true }
  }));
  const value: LocationEngineInput = {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(arrival + 3 * 3_600), acceptedLearnedPlaces: [], evidence,
    savedPlaces: [{ id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false }]
  };
  return { value, arrival };
}
const homeStays = (value: LocationEngineInput) => runLocationEngine(value).segmentUpserts
  .filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID);

describe("an arrival Visit iOS dates before the car arrives", () => {
  it.each([45, 100, 157])("keeps Home presence from the observed arrival through the silence (dated %i s early)", (early) => {
    const { value, arrival } = homecoming({ visitEarlySeconds: early });
    const [home, ...others] = homeStays(value);
    expect(others).toEqual([]);
    // The stay begins at the entry, not at the Visit's earlier time while the car was still on the road.
    expect(home).toMatchObject({ startedAt: at(arrival + 2), status: "open", stoppedAt: null });
    expect(home.evidenceIds).toContain("arrival-visit");
  });

  it("is unchanged when the Visit is dated more than three minutes early", () => {
    const { value } = homecoming({ visitEarlySeconds: 200 });
    expect(homeStays(value)).toEqual([]);
  });

  it("is unchanged when Home's exit falls between the Visit and the arrival", () => {
    const { value } = homecoming({ exitInWindow: true });
    expect(homeStays(value)).toEqual([]);
  });

  it("is unchanged when nothing at Home follows the approach", () => {
    const { value } = homecoming({ noPlaceEvidence: true });
    expect(homeStays(value)).toEqual([]);
  });

  it("leaves an arrival Visit dated at the arrival on the ordinary corroborated path", () => {
    const { value, arrival } = homecoming({ visitEarlySeconds: -1 });
    const [home] = homeStays(value);
    expect(home).toMatchObject({ status: "open", stoppedAt: null });
    expect(home.startedAt <= at(arrival + 2)).toBe(true);
  });
});
