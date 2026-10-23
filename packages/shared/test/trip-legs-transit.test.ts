import { describe, expect, it } from "vitest";
import { credibleSpeedResolver } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { distanceMeters } from "../src/location/geo";
import { deriveTripLegs } from "../src/location/legs";
import { buildMotionTimeline } from "../src/location/motionActivity";
import { nearestStation } from "../src/location/stations";
import { STATIONS_PACKED } from "../src/location/stations.generated";
import { DAYFRAME_GLYPHS } from "../src/iconGlyphs";
import { DAYFRAME_LEG_MODE_ICONS } from "../src/icons";
import type { ClassifiedEvidence, LocationEvidence, MotionActivity } from "../src/location/types";

// Location v4 step 7, legs part 2. Station positions come from the bundled public list itself (no
// coordinates are written here); everything else is synthetic.
const at = (minutes: number) => new Date(Date.UTC(2026, 1, 9, 8) + Math.round(minutes * 60_000)).toISOString();
const ms = (minutes: number) => Date.parse(at(minutes));
const packed = STATIONS_PACKED.split(";").map((entry) => {
  const [latitude, longitude] = entry.slice(1).split(",").map((value) => Number(value) / 1e5);
  return { kind: entry[0], latitude, longitude };
});
/** Two bundled stations of one kind, 6–12 km apart (a 13-minute silence between them is 7–15 m/s). */
function pairOf(kind: string) {
  const list = packed.filter((station) => station.kind === kind);
  for (const a of list) for (const b of list) {
    const meters = distanceMeters(a, b);
    if (meters >= 6_000 && meters <= 12_000) return [a, b];
  }
  throw new Error(`no ${kind} pair`);
}
const toward = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }, share: number) =>
  ({ latitude: a.latitude + (b.latitude - a.latitude) * share, longitude: a.longitude + (b.longitude - a.longitude) * share });

function reading(minutes: number, point: { latitude: number; longitude: number }, speed: number | null): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: `r-${minutes}`, deviceId: "device-t", algorithmVersion: config.algorithmVersion,
    // Only the position: a bundled station's own fields (its kind) never reach the reading.
    kind: "standard_location", occurredAt: at(minutes), receivedAt: at(300), timeZone: "UTC", latitude: point.latitude, longitude: point.longitude,
    horizontalAccuracyMeters: 8, speedMetersPerSecond: speed, isSimulated: false } as LocationEvidence,
    impliedSpeedMetersPerSecond: null, match: null };
}
function motion(steps: Array<[number, MotionActivity]>): ClassifiedEvidence[] {
  return steps.map(([minutes, activity]) => ({ evidence: { clientEvidenceId: `m-${minutes}`, deviceId: "device-t",
    algorithmVersion: config.algorithmVersion, kind: "motion_activity", occurredAt: at(minutes), receivedAt: at(300), timeZone: "UTC",
    latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, isSimulated: false,
    metadata: { motionActivity: activity, motionConfidence: "high" } } as LocationEvidence, impliedSpeedMetersPerSecond: null, match: null }));
}
function legs(readings: ClassifiedEvidence[], steps: Array<[number, MotionActivity]>, end: number, stations = true) {
  const timeline = steps.length ? buildMotionTimeline(motion(steps), config, ms(300)) : null;
  return deriveTripLegs({ startMs: ms(0), endMs: ms(end), timeline, readings, speedOf: credibleSpeedResolver(readings, config),
    config: { ...config, tripStationsEnabled: stations } });
}

describe("bundled stations (location v4 step 7)", () => {
  it("finds the nearest station of a kind within a radius, and nothing beyond it", () => {
    const [station] = pairOf("u");
    const nearby = { latitude: station.latitude + 0.001, longitude: station.longitude };
    expect(nearestStation(nearby, ["underground"], 500)?.kind).toBe("underground");
    expect(nearestStation(nearby, ["underground"], 50)).toBeNull();
    expect(packed.length).toBeGreaterThan(3_000);
    expect(new Set(packed.map((entry) => entry.kind))).toEqual(new Set(["r", "u", "m"]));
  });
});

describe("trip legs, part 2 (location v4 step 7)", () => {
  it("reads a silence between distant readings as an Underground leg: sure between Underground stations", () => {
    const [from, to] = pairOf("u");
    const readings = [reading(0, toward(from, to, 0), 1.3), reading(2, toward(from, to, 0.01), 1.3),
      reading(3, toward(from, to, 0.02), 1.2), reading(16, to, 1.2), reading(18, toward(to, from, -0.01), 1.3)];
    const result = legs(readings, [[0, "walking"], [3, "unknown"], [16, "walking"]], 19);
    const tube = result.find((leg) => leg.mode === "underground")!;
    expect(tube).toMatchObject({ confidence: "sure", unobserved: true, startedAt: at(3), stoppedAt: at(16) });
    expect(tube.runnerUp).toBeUndefined();
    expect(result.map((leg) => leg.mode)).toEqual(["walking", "underground", "walking"]);
  });

  it("keeps an Underground guess unsure, with train as runner-up, away from Underground stations", () => {
    const [from, to] = pairOf("u");
    const readings = [reading(0, toward(from, to, 0), 1.3), reading(3, toward(from, to, 0.02), 1.2), reading(16, to, 1.2)];
    const tube = legs(readings, [], 17, false).find((leg) => leg.mode === "underground")!;
    expect(tube).toMatchObject({ confidence: "unsure", runnerUp: "train", unobserved: true });
  });

  it("makes a fast leg between rail stations a train (sure), and one above any road speed a likely train", () => {
    const [from, to] = pairOf("r");
    const readings = [0, 1, 2, 3, 4, 5, 6].map((minute) => reading(minute, toward(from, to, minute / 6), 30));
    expect(legs(readings, [[0, "automotive"]], 6).map(({ mode, confidence }) => ({ mode, confidence }))).toEqual([{ mode: "train", confidence: "sure" }]);
    expect(legs(readings, [[0, "automotive"]], 6, false).map(({ mode }) => mode)).toEqual(["automotive"]);
    const fast = [0, 1, 2, 3, 4, 5, 6].map((minute) => reading(minute, toward(from, to, minute / 6), 36));
    expect(legs(fast, [[0, "automotive"]], 6, false).map(({ mode, confidence }) => ({ mode, confidence }))).toEqual([{ mode: "train", confidence: "likely" }]);
  });

  it("makes a slower leg between metro or tram stops a tram, and leaves a drive elsewhere a drive", () => {
    const [from, to] = pairOf("m");
    const readings = [0, 2, 4, 6, 8, 10].map((minute) => reading(minute, toward(from, to, minute / 10), 9));
    expect(legs(readings, [[0, "automotive"]], 10).map(({ mode }) => mode)).toEqual(["tram"]);
    const away = readings.map((item) => ({ ...item, evidence: { ...item.evidence, latitude: item.evidence.latitude! + 0.2 } }));
    expect(legs(away, [[0, "automotive"]], 10).map(({ mode }) => mode)).toEqual(["automotive"]);
  });

  it("draws every leg mode from the shared glyph registry", () => {
    for (const glyph of Object.values(DAYFRAME_LEG_MODE_ICONS)) expect(DAYFRAME_GLYPHS[glyph]).toBeDefined();
  });
});
