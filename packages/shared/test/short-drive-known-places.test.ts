import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, LocationEvidence } from "../src/location/types";

// The 5 Oct school run, with synthetic geometry: Home at the origin and School 900 m north. iOS sent no native speed
// and went quiet mid-drive, so the 100-second drive home has only two fast readings.
const HOME_ID = "10000000-0000-4000-8000-0000000000a1";
const SCHOOL_ID = "10000000-0000-4000-8000-0000000000a2";
const DEVICE = "20000000-0000-4000-8000-0000000000a1";
const t0 = Date.parse("2026-03-09T08:00:00Z");
const at = (minutes: number) => new Date(t0 + Math.round(minutes * 60_000)).toISOString();
const north = (metres: number) => metres / 111_195;

function fix(id: string, minutes: number, metres: number, accuracy: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes + 1), timeZone: "UTC", endedAt: null,
    latitude: north(metres), longitude: 0, horizontalAccuracyMeters: accuracy, speedMetersPerSecond: null, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minutes: number, kind: "geofence_enter" | "geofence_exit", placeId: string) =>
  fix(id, minutes, 0, 0, { kind, savedPlaceId: placeId, latitude: null, longitude: null, horizontalAccuracyMeters: null });
const visit = (id: string, minutes: number, metres: number, accuracy: number, endedMinutes?: number) =>
  fix(id, minutes, metres, accuracy, { kind: "visit", endedAt: endedMinutes == null ? null : at(endedMinutes),
    metadata: endedMinutes == null ? { visitDepartureOpen: true } : {} });

function schoolRun({ withoutReading, learnedHome = false }: { withoutReading?: string; learnedHome?: boolean } = {}): LocationEngineInput {
  const evidence = [
    ...[0, 5, 10, 15, 20, 25, 30, 35].map((m, i) => fix(`home-am-${i}`, m, i % 3, 5)),
    crossing("home-exit", 36.33, "geofence_exit", HOME_ID),
    fix("out-0", 36.34, 184, 25), fix("out-1", 36.95, 312, 26), fix("out-2", 37.02, 320, 22), fix("out-3", 37.35, 513, 22), fix("out-4", 37.47, 651, 24),
    visit("school-visit", 38.03, 846, 20), visit("school-visit-done", 38.03, 804, 67, 47.42),
    fix("school-0", 40.53, 830, 37), crossing("school-enter", 40.53, "geofence_enter", SCHOOL_ID), fix("school-1", 42.67, 857, 14),
    crossing("school-exit", 47.78, "geofence_exit", SCHOOL_ID),
    fix("back-0", 47.78, 753, 46), fix("back-1", 47.9, 632, 24), fix("back-2", 49.07, 164, 35),
    visit("home-visit", 49.08, 19, 20), crossing("home-enter", 49.18, "geofence_enter", HOME_ID),
    fix("home-3", 49.23, 44, 20), fix("home-4", 49.35, 22, 20), fix("home-5", 49.87, 6, 20),
    ...[55, 60, 65, 70, 75, 80].map((m, i) => fix(`home-pm-${i}`, m, i % 3, 5))
  ].filter((item) => item.clientEvidenceId !== withoutReading)
    // A learned place has no geofence; still readings (speed 0) anchor its stays instead.
    .filter((item) => !learnedHome || item.savedPlaceId !== HOME_ID)
    .map((item) => learnedHome && item.clientEvidenceId.startsWith("home-") ? { ...item, speedMetersPerSecond: 0 } : item);
  const home = { id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false };
  const school = { id: SCHOOL_ID, name: "School", latitude: north(900), longitude: 0, radiusMeters: 100, loggingEnabled: true };
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(120), evidence,
    savedPlaces: learnedHome ? [school] : [home, school],
    acceptedLearnedPlaces: learnedHome ? [{ ...home, accepted: true as const }] : []
  };
}
const commutes = (input: LocationEngineInput) =>
  runLocationEngine(input).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
const minutes = (iso: string) => (Date.parse(iso) - t0) / 60_000;

describe("a short drive between two known places with few readings", () => {
  it("keeps the 100-second drive home from School for Review", () => {
    const trips = commutes(schoolRun());
    expect(trips).toHaveLength(2);
    const home = trips[1];
    expect(minutes(home.startedAt)).toBeGreaterThan(47);
    expect(minutes(home.startedAt)).toBeLessThan(48);
    expect(minutes(home.stoppedAt)).toBeCloseTo(49.08, 1);
    expect(Date.parse(home.stoppedAt) - Date.parse(home.startedAt)).toBeLessThan(config.commuteMinimumDurationMs);
    expect(assessAutomaticLocation("v2_enabled", home)).toMatchObject({ action: "review", reason: "short_journey_review_only" });
  });

  it("keeps it when Home is a learned place", () => {
    expect(commutes(schoolRun({ learnedHome: true }))).toHaveLength(2);
  });

  it("still needs two independent fast readings: one is a lone jump", () => {
    const trips = commutes(schoolRun({ withoutReading: "back-1" }));
    expect(trips).toHaveLength(1);
    expect(minutes(trips[0].stoppedAt)).toBeLessThan(40);
  });

  it("is deterministic and order-independent", () => {
    const input = schoolRun();
    const result = runLocationEngine(input).segmentUpserts;
    expect(runLocationEngine({ ...input, evidence: [...input.evidence].reverse() }).segmentUpserts).toEqual(result);
  });
});
