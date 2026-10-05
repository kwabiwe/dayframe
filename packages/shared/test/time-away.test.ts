import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { deriveCommutes } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import { isTimeAway, timeAwayTitle, tripStopsHeading } from "../src/location/tripStopPresentation";
import type { ClassifiedEvidence, CommuteSegment, LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";
import { simulate, type Scenario, type SimPlace } from "./fixtures/captureSimulator";

// Synthetic geometry only: Home at the origin; positions in metres east/north.
const HOME_ID = "10000000-0000-4000-8000-0000000000c1";
const WORK_ID = "10000000-0000-4000-8000-0000000000c2";
const DEVICE = "20000000-0000-4000-8000-0000000000c1";
const t0 = Date.parse("2026-03-10T12:00:00Z");
const at = (minutes: number) => new Date(t0 + Math.round(minutes * 60_000)).toISOString();
const minutes = (iso: string) => (Date.parse(iso) - t0) / 60_000;
const north = (metres: number) => metres / 111_195;

function fix(id: string, minute: number, northMetres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(minute + 1), timeZone: "UTC", endedAt: null,
    latitude: north(northMetres), longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minute: number, kind: "geofence_enter" | "geofence_exit") =>
  fix(id, minute, 0, { kind, savedPlaceId: HOME_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
const homeFixes = (prefix: string, from: number, to: number) =>
  Array.from({ length: Math.floor((to - from) / 10) + 1 }, (_, i) => fix(`${prefix}-${i}`, from + i * 10, i % 2 * 3));

const home = { id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true };
const work = { id: WORK_ID, name: "Work", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true };
const input = (evidence: LocationEvidence[]): LocationEngineInput => ({
  priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
  config, processingAt: at(600), evidence, savedPlaces: [home, work], acceptedLearnedPlaces: []
});
const commutesOf = (value: LocationEngineInput) =>
  runLocationEngine(value).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
const outings = (value: LocationEngineInput) => commutesOf(value).filter((commute) => commute.qualificationReason === "same_place_outing");

const HOME_PLACE: SimPlace = { id: HOME_ID, name: "Home", at: { x: 0, y: 0 }, radius: 100, loggingEnabled: true };
const shopRun = (kind: "drive" | "walk", metres = 300, stopMinutes = 6): Scenario => ({
  start: "2026-03-10T12:00:00Z", origin: HOME_PLACE.at, places: [HOME_PLACE],
  legs: [{ kind: "stay", minutes: 60 }, { kind, to: { x: metres, y: 0 } }, { kind: "stay", minutes: stopMinutes },
    { kind, to: HOME_PLACE.at }, { kind: "stay", minutes: 90 }]
});

describe("time away from a saved place", () => {
  it.each([1, 2, 3, 4, 5])("offers one Review item for a short drive to a shop and back (seed %s)", (seed) => {
    const sim = simulate(shopRun("drive"), seed);
    const all = commutesOf(sim.input());
    const away = all.filter((commute) => commute.qualificationReason === "same_place_outing");
    expect(away).toHaveLength(1);
    expect(all).toHaveLength(1);
    const [outing] = away;
    expect(outing.fromPlaceId).toBe(HOME_ID);
    expect(outing.toPlaceId).toBe(HOME_ID);
    // The phone left a little after 13:00 and was back by about 13:07.
    expect(minutes(outing.startedAt)).toBeGreaterThanOrEqual(59.5);
    expect(minutes(outing.startedAt)).toBeLessThan(62);
    expect(minutes(outing.stoppedAt)).toBeGreaterThan(65);
    expect(minutes(outing.stoppedAt)).toBeLessThan(69);
    expect(outing.confidence).toBe("low");
    expect(assessAutomaticLocation("v2_enabled", { ...outing, status: "finalised" }))
      .toMatchObject({ action: "review", reason: "time_away_review_only" });
  });

  it.each([1, 2, 3])("names the stop when the phone stopped somewhere on a walk out and back (seed %s)", (seed) => {
    const away = outings(simulate(shopRun("walk"), seed).input());
    expect(away).toHaveLength(1);
    expect(away[0].stops).toHaveLength(1);
  });

  it("offers nothing from geofence callbacks alone, without readings away", () => {
    const evidence = [...homeFixes("am", 0, 60), crossing("exit", 61, "geofence_exit"), crossing("enter", 71, "geofence_enter"),
      ...homeFixes("pm", 72, 150)];
    expect(outings(input(evidence))).toEqual([]);
  });

  it("offers nothing when the readings away stay within 150 m of the place", () => {
    const evidence = [...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      fix("near-0", 62, 120), fix("near-1", 64, 130), fix("near-2", 66, 125), crossing("enter", 68, "geofence_enter"),
      ...homeFixes("pm", 69, 150)];
    expect(outings(input(evidence))).toEqual([]);
  });

  it("measures the 150 m from the place itself, not from where the stay was observed (review finding 2)", () => {
    // Home stay observed 60 m south of the pin; readings 140–145 m north of it are under 150 m from Home.
    const south = (prefix: string, from: number, to: number) => homeFixes(prefix, from, to).map((item) => ({ ...item, latitude: north(-60) }));
    const evidence = [...south("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      fix("near-0", 62, 140), fix("near-1", 65, 145), crossing("enter", 70, "geofence_enter"), ...south("pm", 71, 150)];
    expect(outings(input(evidence))).toEqual([]);
  });

  it("offers time away from an accepted learned place, measured from its centre", () => {
    const awayFixes = [fix("away-0", 62, 300, { speedMetersPerSecond: 10 }), fix("away-1", 64, 320), fix("away-2", 66, 310),
      fix("away-3", 68, 200, { speedMetersPerSecond: 10 })];
    const evidence = [...homeFixes("am", 0, 60), ...awayFixes, ...homeFixes("pm", 70, 150)];
    const learned = { ...home, id: "10000000-0000-4000-8000-0000000000c9", accepted: true as const };
    const away = outings({ ...input(evidence), savedPlaces: [], acceptedLearnedPlaces: [learned] });
    expect(away).toHaveLength(1);
    expect(away[0]).toMatchObject({ fromPlaceId: null, qualificationReason: "same_place_outing" });
  });

  it("offers nothing around a stop when neither stay was identified as the place (Fable review)", () => {
    const stay = (id: string, from: number, to: number, kind: StaySegment["placeMatchKind"]): StaySegment => ({
      kind: "stay", clientSegmentId: id, algorithmVersion: config.algorithmVersion, status: "finalised", startedAt: at(from), stoppedAt: at(to),
      placeId: kind === "unknown" ? null : HOME_ID, placeMatchKind: kind, candidatePlaceIds: [], centreLatitude: 0, centreLongitude: 0,
      radiusMeters: 100, sampleCount: 3, continuityStatus: "continuous", confidence: "medium", evidenceIds: []
    });
    const route = [fix("r-0", 61, 400, { speedMetersPerSecond: 3 }), fix("r-1", 69, 380, { speedMetersPerSecond: 3 })]
      .map((evidence): ClassifiedEvidence => ({ evidence, match: null, impliedSpeedMetersPerSecond: null }));
    const derive = (kind: StaySegment["placeMatchKind"]) => deriveCommutes([stay("a", 0, 60, kind), stay("b", 70, 150, kind)], route,
      config, at(600), { interiorStops: [stay("stop", 63, 67, "unknown")], savedPlaces: [home] })
      .filter((commute) => commute.qualificationReason === "same_place_outing");
    expect(derive("saved")).toHaveLength(1);
    expect(derive("ambiguous")).toEqual([]);
  });

  it("counts a reading and its mirrored copy as one observation (round 2 finding 2)", () => {
    const mirrored = (seconds: number) => [fix("std", 63, 300), fix("sig", 63 + seconds / 60, 301, { kind: "significant_change" })];
    const run = (seconds: number) => outings(input([...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      ...mirrored(seconds), crossing("enter", 70, "geofence_enter"), ...homeFixes("pm", 71, 150)]));
    expect(run(0)).toEqual([]);
    expect(run(4)).toEqual([]);
    expect(run(60)).toHaveLength(1);
  });

  it("counts two distinct readings from the same source seconds apart (round 3 finding 1)", () => {
    const run = (seconds: number) => outings(input([...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      fix("a", 63, 300), fix("b", 63 + seconds / 60, 375), crossing("enter", 70, "geofence_enter"), ...homeFixes("pm", 71, 150)]));
    expect(run(4)).toHaveLength(1);
  });

  it("offers nothing for an absence under five minutes", () => {
    const evidence = [...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      fix("away-0", 61.5, 300, { speedMetersPerSecond: 10 }), fix("away-1", 62.5, 320), fix("away-2", 63.5, 280, { speedMetersPerSecond: 10 }),
      crossing("enter", 64.5, "geofence_enter"), ...homeFixes("pm", 65, 150)];
    expect(outings(input(evidence))).toEqual([]);
  });

  it("offers nothing for an absence over six hours", () => {
    const evidence = [...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      fix("away-0", 62, 400, { speedMetersPerSecond: 10 }), fix("away-1", 64, 420), fix("away-2", 425, 410),
      fix("away-3", 427, 200, { speedMetersPerSecond: 10 }), crossing("enter", 428, "geofence_enter"), ...homeFixes("pm", 429, 500)];
    expect(outings(input(evidence))).toEqual([]);
  });

  it("leaves a qualifying round trip as a journey, not time away", () => {
    const sim = simulate({ ...shopRun("drive", 2_000, 0), legs: [{ kind: "stay", minutes: 60 }, { kind: "drive", to: { x: 0, y: 1_800 } },
      { kind: "drive", to: HOME_PLACE.at }, { kind: "stay", minutes: 90 }] }, 1);
    const all = commutesOf(sim.input());
    expect(all.filter((commute) => commute.qualificationReason === "same_place_meaningful_round_trip")).toHaveLength(1);
    expect(all.filter((commute) => commute.qualificationReason === "same_place_outing")).toEqual([]);
  });

  // Broad-accuracy outing through two unsaved stops: on these seeds the first
  // leg (Home to a stop) qualifies on its own; the rest does not.
  const broadOuting: Scenario = { start: "2026-03-10T12:00:00Z", origin: HOME_PLACE.at, places: [HOME_PLACE], legs: [
    { kind: "stay", minutes: 60 }, { kind: "drive", to: { x: 1_500, y: 300 }, accuracy: [100, 150] }, { kind: "stay", minutes: 6 },
    { kind: "drive", to: { x: 1_900, y: 900 }, accuracy: [100, 150] }, { kind: "stay", minutes: 7 },
    { kind: "drive", to: HOME_PLACE.at, via: [{ x: 900, y: 600 }], accuracy: [100, 150] }, { kind: "stay", minutes: 90 }] };
  it.each([6, 24, 29])("never folds a journey that qualified into time away (seed %s)", (seed) => {
    const all = commutesOf(simulate(broadOuting, seed).input());
    expect(all.filter((commute) => commute.qualificationReason !== "same_place_outing")).toHaveLength(1);
    expect(all.filter((commute) => commute.qualificationReason === "same_place_outing")).toEqual([]);
  });

  it("never offers time away between two different places", () => {
    const evidence = [...homeFixes("am", 0, 60), crossing("exit", 60.5, "geofence_exit"),
      ...[0, 1, 2, 3].map((i) => fix(`drive-${i}`, 61 + i, 600 + i * 600, { speedMetersPerSecond: 12 })),
      ...[66, 76, 86].map((m, i) => fix(`work-${i}`, m, 3_000 + i % 2 * 3))];
    expect(outings(input(evidence))).toEqual([]);
  });
});

describe("time away presentation", () => {
  it("names the place and recognises only time-away journeys", () => {
    expect(timeAwayTitle("Home")).toBe("Time away from Home");
    expect(timeAwayTitle("  ")).toBe("Time away");
    expect(timeAwayTitle(null)).toBe("Time away");
    expect(isTimeAway({ kind: "commute", qualificationReason: "same_place_outing" })).toBe(true);
    expect(isTimeAway({ kind: "commute", qualificationReason: "same_place_meaningful_round_trip" })).toBe(false);
    expect(isTimeAway({ kind: "stay" })).toBe(false);
    const stop = { startedAt: "2026-03-10T12:03:00.000Z", stoppedAt: "2026-03-10T12:09:00.000Z", durationSeconds: 360, approximate: false };
    expect(tripStopsHeading([stop], true)).toBe("1 stop while you were away");
    expect(tripStopsHeading([stop])).toBe("1 stop on this trip");
  });
});
