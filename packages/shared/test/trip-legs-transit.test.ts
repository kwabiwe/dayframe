import { describe, expect, it } from "vitest";
import { credibleSpeedResolver } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { distanceMeters } from "../src/location/geo";
import { deriveTripLegs, mergeSameModeLegs } from "../src/location/legs";
import { buildMotionTimeline } from "../src/location/motionActivity";
import { runLocationEngine } from "../src/location/segmenter";
import { nearestStation, type StationKind } from "../src/location/stations";
import { STATIONS_PACKED } from "../src/location/stations.generated";
import { DAYFRAME_GLYPHS } from "../src/iconGlyphs";
import { DAYFRAME_LEG_MODE_ICONS } from "../src/icons";
import type { ClassifiedEvidence, CommuteSegment, LocationEvidence, MotionActivity, TripLeg } from "../src/location/types";

// Location v4 step 7, legs part 2. Station positions come from the bundled public list itself (no
// coordinates are written here); everything else is synthetic.
const at = (minutes: number) => new Date(Date.UTC(2026, 1, 9, 8) + Math.round(minutes * 60_000)).toISOString();
const ms = (minutes: number) => Date.parse(at(minutes));
const packed = STATIONS_PACKED.split(";").map((entry) => {
  const [latitude, longitude] = entry.slice(1).split(",").map((value) => Number(value) / 1e5);
  return { kind: entry[0], latitude, longitude };
});
/** Two bundled stations of one kind, 6–12 km apart (a 13-minute silence between them is 7–15 m/s). */
function pairOf(kind: string, awayFrom: StationKind[] = [], maximumMeters = 12_000) {
  const list = packed.filter((station) => station.kind === kind &&
    (!awayFrom.length || !nearestStation(station, awayFrom, config.tripStationRadiusMeters)));
  for (const a of list) for (const b of list) {
    const meters = distanceMeters(a, b);
    if (meters >= 6_000 && meters <= maximumMeters) return [a, b];
  }
  throw new Error(`no ${kind} pair`);
}
/** An Underground station away from rail and a rail station away from the Underground, 6–12 km apart. */
function mixedPair() {
  const tubes = packed.filter((station) => station.kind === "u" && !nearestStation(station, ["rail"], config.tripStationRadiusMeters));
  const rails = packed.filter((station) => station.kind === "r" && !nearestStation(station, ["underground"], config.tripStationRadiusMeters));
  for (const a of tubes) for (const b of rails) {
    const meters = distanceMeters(a, b);
    if (meters >= 6_000 && meters <= 12_000) return [a, b];
  }
  throw new Error("no mixed pair");
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

  it("reads a silence between rail stations as a likely train, and between one of each as unsure Underground, train the runner-up", () => {
    const [from, to] = pairOf("r", ["underground"]);
    const rail = [reading(0, toward(from, to, 0), 1.3), reading(3, toward(from, to, 0.02), 1.2), reading(16, to, 1.2)];
    expect(legs(rail, [], 17).find((leg) => leg.unobserved)).toMatchObject({ mode: "train", confidence: "likely" });
    const [tube, station] = mixedPair();
    const mixed = [reading(0, toward(tube, station, 0), 1.3), reading(3, toward(tube, station, 0.02), 1.2), reading(16, station, 1.2)];
    expect(legs(mixed, [], 17).find((leg) => leg.unobserved)).toMatchObject({ mode: "underground", confidence: "unsure", runnerUp: "train" });
  });

  it("reads each silence by its own anchors (Codex r1 on #590)", () => {
    // Rail station → Underground station, a wait there, Underground station → rail station: either, not a train.
    const [tube, rail] = mixedPair();
    const other = packed.find((station) => station.kind === "r" && station !== rail && !nearestStation(station, ["underground"], config.tripStationRadiusMeters) &&
      distanceMeters(station, tube) >= 6_000 && distanceMeters(station, tube) <= 12_000)!;
    const there = [reading(0, rail, 1.2), reading(13, tube, 0), reading(15, tube, 0), reading(28, other, 1.2)];
    expect(legs(there, [], 28).filter((leg) => leg.unobserved).map(({ mode, confidence, runnerUp }) => ({ mode, confidence, runnerUp })))
      .toEqual([{ mode: "underground", confidence: "unsure", runnerUp: "train" }]);
    // A silence between rail stations inside a longer trip (walks either side): a train.
    const [from, to] = pairOf("r", ["underground"]);
    const padded = [reading(1, toward(from, to, -0.01), 1.3), reading(3, from, 1.2), reading(16, to, 1.2), reading(18, toward(to, from, -0.01), 1.3)];
    expect(legs(padded, [[0, "walking"], [3, "unknown"], [16, "walking"]], 20).find((leg) => leg.unobserved))
      .toMatchObject({ mode: "train", confidence: "likely" });
  });

  it("keeps a rail silence and an Underground silence apart across a change (Codex r3 on #590)", () => {
    // A silence between rail stations, a minute's wait, then one between Underground stations: a likely train,
    // then the sure Underground, never one unsure leg.
    const [railFrom, railTo] = pairOf("r", ["underground"]);
    const [tubeFrom, tubeTo] = pairOf("u", ["rail"]);
    const readings = [reading(0, railFrom, 1.2), reading(13, railTo, 0), reading(14, tubeFrom, 0), reading(27, tubeTo, 1.2)];
    const result = legs(readings, [], 27).filter((leg) => leg.unobserved);
    expect(result.map(({ mode, confidence }) => ({ mode, confidence })))
      .toEqual([{ mode: "train", confidence: "likely" }, { mode: "underground", confidence: "sure" }]);
  });

  it("never guesses a mode from a silence alone: without a station near both ends it joins the leg around it (card A, 24 Oct)", () => {
    // Two drives with a 1.8 km silence between them, beyond the northernmost bundled station: one drive.
    const north = packed.reduce((best, station) => station.latitude > best.latitude ? station : best);
    const along = (metres: number) => ({ latitude: north.latitude + (5_000 + metres) / 111_000, longitude: north.longitude });
    const readings = [reading(0, along(0), 12), reading(1, along(720), 12), reading(2, along(1_440), 12),
      reading(7.5, along(3_240), 12), reading(8.5, along(3_960), 12)];
    expect(readings.some(({ evidence }) => nearestStation(evidence as never, ["rail", "underground", "metro"], 2_000))).toBe(false);
    expect(legs(readings, [[0, "automotive"]], 8.5).map(({ mode, unobserved }) => ({ mode, unobserved })))
      .toEqual([{ mode: "automotive", unobserved: undefined }]);
    // The same silence between Underground stations is the Underground.
    const [from, to] = pairOf("u", ["rail"]);
    expect(legs([reading(0, from, 1.3), reading(3, toward(from, to, 0.02), 1.2), reading(16, to, 1.2)], [], 17)
      .some((leg) => leg.unobserved && leg.mode === "underground")).toBe(true);
    // With the station list off (replays of relative positions) no silence is ever a leg.
    expect(legs([reading(0, from, 1.3), reading(3, toward(from, to, 0.02), 1.2), reading(16, to, 1.2)], [], 17, false)
      .some((leg) => leg.unobserved)).toBe(false);
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
    const [tubeFrom, tubeTo] = pairOf("u", ["rail"]);
    const sparse = [reading(0, tubeFrom, 1.2), reading(6, toward(tubeFrom, tubeTo, 0.5), null, 120), reading(13, tubeTo, 1.2)];
    expect(legs(sparse, [], 13).map(({ mode }) => mode)).toEqual(["underground"]);
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
    const tube = legs(readings, [], 27).filter((leg) => leg.mode === "underground");
    const total = tube.reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0);
    expect(total).toBeGreaterThan(each * 1.95);
  });

  it("lets readings too broad to accept still break a silence, through the whole engine (Codex r2 on #563)", () => {
    // A seven-minute ride, its accurate fixes six minutes apart near two Underground stations, seen six times at 300 m in between.
    const [from, to] = pairOf("u", ["rail"], 9_000);
    const metres = distanceMeters(from, to);
    const point = (along: number) => toward(from, to, along / metres);
    const fix = (id: string, minutes: number, along: number, speed: number | null, accuracy = 8) =>
      ({ ...reading(minutes, point(along), speed, accuracy).evidence, clientEvidenceId: id });
    const stay = (id: string, start: number, end: number, along: number) => Array.from({ length: 8 }, (_, index) =>
      fix(`${id}-${index}`, start + index * ((end - start) / 7), along, 0));
    const anchors = [fix("x-0", 101, 0, 12), fix("x-1", 101.5, 400, 13), fix("x-2", 107.5, metres - 400, 13), fix("x-3", 108, metres, 12)];
    const broad = [102, 103, 104, 105, 106, 107].map((minute) => fix(`broad-${minute}`, minute, (minute - 101) * metres / 7, null, 300));
    const driving = motion([[0, "stationary"], [101, "automotive"], [108, "stationary"]]).map((item) => item.evidence);
    const run = (extra: LocationEvidence[]) => runLocationEngine({ priorState: { algorithmVersion: config.algorithmVersion, mode: "idle",
      activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null }, config, processingAt: at(400),
      acceptedLearnedPlaces: [], savedPlaces: [], evidence: [...stay("a", 70, 100, 0), ...anchors, ...stay("b", 109, 140, metres), ...driving, ...extra] })
      .segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute")
      .flatMap((trip) => trip.tripLegs?.filter((leg) => leg.unobserved).map((leg) => leg.mode) ?? []);
    expect(run([])).toContain("underground");
    expect(run(broad)).toEqual([]);
  });

  it("lets even one or two readings too broad to accept break a silence, from replay's stored times (Codex r4 on #563)", () => {
    const [from, to] = pairOf("u", ["rail"], 9_000);
    const metres = distanceMeters(from, to);
    const fixes = [reading(101, from, 12), reading(101.5, toward(from, to, 400 / metres), 13),
      reading(107.5, toward(from, to, 1 - 400 / metres), 13), reading(108, to, 12)];
    const derive = (broadReadingTimes: number[]) => deriveTripLegs({ startMs: ms(101), endMs: ms(108), timeline: null, readings: fixes,
      speedOf: credibleSpeedResolver(fixes, config), config, broadReadingTimes }).filter((leg) => leg.unobserved).map((leg) => leg.mode);
    expect(derive([])).toEqual(["underground"]);
    expect(derive([ms(103), ms(106)])).toEqual([]);
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

describe("consecutive legs of one mode (card A, owner feedback 25 Oct)", () => {
  const leg = (from: number, to: number, mode: TripLeg["mode"], confidence: TripLeg["confidence"], extra: Partial<TripLeg> = {}): TripLeg =>
    ({ startedAt: at(from), stoppedAt: at(to), mode, confidence, distanceMeters: (to - from) * 1_000, ...extra });

  it("joins them into one leg, keeping the longest part's confidence", () => {
    expect(mergeSameModeLegs([
      leg(0, 5, "walking", "sure"),
      leg(5, 20, "underground", "sure"), leg(20, 30, "underground", "unsure", { runnerUp: "train", unobserved: true }),
      leg(31, 45, "underground", "sure", { unobserved: true }), leg(45, 52, "walking", "likely")
    ])).toEqual([
      leg(0, 5, "walking", "sure"),
      { startedAt: at(5), stoppedAt: at(45), mode: "underground", confidence: "sure", distanceMeters: 39_000 },
      leg(45, 52, "walking", "likely")
    ]);
  });

  it("keeps an unsure part's runner-up when it lasted longest, and unobserved only when every part was", () => {
    expect(mergeSameModeLegs([leg(0, 4, "underground", "sure", { unobserved: true }), leg(4, 20, "underground", "unsure", { runnerUp: "train", unobserved: true })]))
      .toEqual([{ startedAt: at(0), stoppedAt: at(20), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: 20_000 }]);
  });

  it("never joins legs of different modes, and leaves a single leg as it is", () => {
    const legs = [leg(0, 10, "automotive", "sure"), leg(10, 12, "walking", "sure"), leg(12, 30, "automotive", "likely")];
    expect(mergeSameModeLegs(legs)).toEqual(legs);
    expect(mergeSameModeLegs([legs[0]])).toEqual([legs[0]]);
  });

  it("gives a ride between Underground stations and the silence after it one Underground leg", () => {
    const [from, to] = pairOf("u", ["rail"]);
    const minutes = Math.ceil(distanceMeters(from, to) / 20 / 60);
    // A ride seen at 20 m/s to halfway, then no signal to the far station.
    const half = Math.floor(minutes / 2);
    const seen = Array.from({ length: half + 1 }, (_, minute) => reading(minute, toward(from, to, minute / (2 * half)), 20));
    const result = legs([...seen, reading(half + 9, to, 1.2)], [[0, "automotive"]], half + 9);
    expect(result.filter((item) => item.mode === "underground")).toHaveLength(1);
  });
});
