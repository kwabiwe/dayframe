import { describe, expect, it } from "vitest";
import { credibleSpeedResolver } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { distanceMeters } from "../src/location/geo";
import { deriveTripLegs } from "../src/location/legs";
import { buildMotionTimeline } from "../src/location/motionActivity";
import { nearestStation, type StationKind } from "../src/location/stations";
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
function pairOf(kind: string, awayFrom: StationKind[] = []) {
  const list = packed.filter((station) => station.kind === kind &&
    (!awayFrom.length || !nearestStation(station, awayFrom, config.tripStationRadiusMeters)));
  for (const a of list) for (const b of list) {
    const meters = distanceMeters(a, b);
    if (meters >= 6_000 && meters <= 12_000) return [a, b];
  }
  throw new Error(`no ${kind} pair`);
}
const toward = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }, share: number) =>
  ({ latitude: a.latitude + (b.latitude - a.latitude) * share, longitude: a.longitude + (b.longitude - a.longitude) * share });

function reading(minutes: number, point: { latitude: number; longitude: number }, speed: number | null, accuracy = 8): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: `r-${minutes}`, deviceId: "device-t", algorithmVersion: config.algorithmVersion,
    // Only the position: a bundled station's own fields (its kind) never reach the reading.
    kind: "standard_location", occurredAt: at(minutes), receivedAt: at(300), timeZone: "UTC", latitude: point.latitude, longitude: point.longitude,
    horizontalAccuracyMeters: accuracy, speedMetersPerSecond: speed, isSimulated: false } as LocationEvidence,
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

  it("makes a fast leg between rail stations a train (sure), and one above any road speed an unsure train, car the runner-up", () => {
    const [from, to] = pairOf("r");
    const readings = [0, 1, 2, 3, 4, 5, 6].map((minute) => reading(minute, toward(from, to, minute / 6), 30));
    expect(legs(readings, [[0, "automotive"]], 6).map(({ mode, confidence }) => ({ mode, confidence }))).toEqual([{ mode: "train", confidence: "sure" }]);
    expect(legs(readings, [[0, "automotive"]], 6, false).map(({ mode }) => mode)).toEqual(["automotive"]);
    const fast = [0, 1, 2, 3, 4, 5, 6].map((minute) => reading(minute, toward(from, to, minute / 6), 36));
    // A drive at 36 m/s matches it too (Codex r1 on #563): the person settles it.
    expect(legs(fast, [[0, "automotive"]], 6, false).map(({ mode, confidence, runnerUp }) => ({ mode, confidence, runnerUp })))
      .toEqual([{ mode: "train", confidence: "unsure", runnerUp: "automotive" }]);
  });

  it("keeps a drive seen every minute at 100 m a drive, never a silence (Codex r1 on #563)", () => {
    const [from, to] = pairOf("r");
    const readings = [reading(0, from, 15), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((minute) => reading(minute, toward(from, to, minute / 10), 15, 100)),
      reading(10, to, 15)];
    expect(legs(readings, [[0, "automotive"]], 10, false).map(({ mode }) => mode)).toEqual(["automotive"]);
    // Station Wi-Fi now and then underground leaves the silence a silence.
    const sparse = [reading(0, from, 1.2), reading(6, toward(from, to, 0.5), null, 120), reading(13, to, 1.2)];
    expect(legs(sparse, [], 13, false).map(({ mode }) => mode)).toEqual(["underground"]);
  });

  it("keeps Underground and tram between their own stations, never a train (Codex r1 on #563)", () => {
    const [from, to] = pairOf("u", ["rail"]);
    const minutes = Math.ceil(distanceMeters(from, to) / 20 / 60);
    const tube = Array.from({ length: minutes + 1 }, (_, minute) => reading(minute, toward(from, to, minute / minutes), 20));
    expect(legs(tube, [[0, "automotive"]], minutes).map(({ mode, confidence }) => ({ mode, confidence })))
      .toEqual([{ mode: "underground", confidence: "sure" }]);
    const [stop, next] = pairOf("m", ["rail", "underground"]);
    const tramMinutes = Math.ceil(distanceMeters(stop, next) / 18 / 60);
    const tram = Array.from({ length: tramMinutes + 1 }, (_, minute) => reading(minute, toward(stop, next, minute / tramMinutes), 18));
    expect(legs(tram, [[0, "automotive"]], tramMinutes).map(({ mode }) => mode)).toEqual(["tram"]);
  });

  it("needs a sustained train speed with few stops (Codex r1 on #563)", () => {
    const [from, to] = pairOf("r");
    // An hour's drive between stations with one fast departure reading and a stopped arrival.
    expect(legs([reading(0, from, 20), reading(60, to, 0)], [[0, "automotive"]], 60).map(({ mode }) => mode)).toEqual(["automotive"]);
    // Stopping every 20 seconds, hundreds of metres apart: not a train.
    const stopping = Array.from({ length: 31 }, (_, step) => reading(step / 3, toward(from, to, step / 30), step % 2 ? 0 : 20));
    expect(legs(stopping, [[0, "automotive"]], 10).map(({ mode }) => mode)).not.toContain("train");
  });

  it("never lets one fix passing a station prove both ends (Codex r1 on #563)", () => {
    // A four-minute drive whose only fix is at an Underground station, midway: it passed the station.
    const [station] = pairOf("u", ["rail"]);
    expect(legs([reading(2, station, 12)], [[0, "automotive"]], 4).map(({ mode }) => mode)).toEqual(["automotive"]);
    // Fixes at both ends, at stations, still make it the Underground.
    const [from, to] = pairOf("u", ["rail"]);
    expect(legs([reading(0, from, 12), reading(4, to, 12)], [[0, "automotive"]], 4).map(({ mode }) => mode)).toEqual(["underground"]);
  });

  it("needs end witnesses inside the leg, near its own ends (Codex r2 on #563)", () => {
    // Two fixes near one station, mid-leg, 12 seconds apart: it passed the station.
    const [station] = pairOf("u", ["rail"]);
    const nearby = { latitude: station.latitude + 0.0013, longitude: station.longitude };
    expect(legs([reading(1.9, station, 12), reading(2.1, nearby, 12)], [[0, "automotive"]], 4).map(({ mode }) => mode)).toEqual(["automotive"]);
    // A half-hour fast drive whose station fixes sit two minutes outside it, in the walks either side.
    const [from, to] = pairOf("r");
    const aside = (share: number) => ({ ...toward(from, to, share), latitude: toward(from, to, share).latitude + 0.02 });
    const readings = [reading(0, from, 1.2), ...[6, 10, 14, 18, 22, 26, 28].map((minute) => reading(minute, aside((minute - 2) / 30), 25)),
      reading(34, to, 1.2)];
    const result = legs(readings, [[0, "walking"], [2, "automotive"], [32, "walking"]], 34);
    expect(result.map(({ mode }) => mode)).not.toContain("train");
  });

  it("keeps every silence's distance when two Underground runs join across a stop (Codex r1 on #563)", () => {
    const [from, to] = pairOf("u");
    const each = distanceMeters(from, to);
    const readings = [reading(0, from, 1.2), reading(13, to, 0), reading(14, to, 0), reading(27, from, 1.2)];
    const tube = legs(readings, [], 27, false).filter((leg) => leg.mode === "underground");
    const total = tube.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0);
    expect(total).toBeGreaterThan(each * 1.95);
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
