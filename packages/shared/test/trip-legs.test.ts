import { describe, expect, it } from "vitest";
import { credibleSpeedResolver } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { largeBuildingAt, largeBuildingVisitFixture } from "../src/location/largeBuildingVisitFixture";
import { deriveTripLegs, withTripLegs } from "../src/location/legs";
import { buildMotionTimeline } from "../src/location/motionActivity";
import { runLocationEngine } from "../src/location/segmenter";
import type { ClassifiedEvidence, CommuteSegment, LocationEvidence, MotionActivity } from "../src/location/types";

// Location v4 step 6, legs part 1: synthetic times, equatorial geometry in metres, synthetic identities.
const at = (minutes: number) => new Date(Date.UTC(2026, 1, 2, 8) + Math.round(minutes * 60_000)).toISOString();
const ms = (minutes: number) => Date.parse(at(minutes));

function motion(steps: Array<[number, MotionActivity]>): ClassifiedEvidence[] {
  return steps.map(([minutes, activity]) => ({ evidence: {
    clientEvidenceId: `motion-${minutes}`, deviceId: "device-l", algorithmVersion: config.algorithmVersion, kind: "motion_activity",
    occurredAt: at(minutes), receivedAt: at(200), timeZone: "UTC", latitude: null, longitude: null, horizontalAccuracyMeters: null,
    speedMetersPerSecond: null, isSimulated: false, metadata: { motionActivity: activity, motionConfidence: "high" } } as LocationEvidence,
    impliedSpeedMetersPerSecond: null, match: null }));
}

function reading(minutes: number, east: number, speed: number | null, accuracy = 8): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: `r-${minutes}`, deviceId: "device-l", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: at(minutes), receivedAt: at(200), timeZone: "UTC", latitude: 0,
    longitude: east / 111_320, horizontalAccuracyMeters: accuracy, speedMetersPerSecond: speed, isSimulated: false },
    impliedSpeedMetersPerSecond: null, match: null };
}

function legs(start: number, end: number, steps: Array<[number, MotionActivity]>, readings: ClassifiedEvidence[] = []) {
  const timeline = steps.length ? buildMotionTimeline(motion(steps), config, ms(300)) : null;
  return deriveTripLegs({ startMs: ms(start), endMs: ms(end), timeline, readings, speedOf: credibleSpeedResolver(readings, config), config })
    .map((leg) => ({ ...leg, from: (Date.parse(leg.startedAt) - ms(0)) / 60_000, to: (Date.parse(leg.stoppedAt) - ms(0)) / 60_000 }));
}

describe("trip legs, part 1 (location v4 step 6)", () => {
  it("splits a drive and the walk after it, sure when Core Motion and speed agree", () => {
    const readings = [reading(1, 0, 12), reading(4, 2_000, 13), reading(8, 5_000, 12), reading(12, 5_400, 1.3), reading(15, 5_700, 1.2)];
    const result = legs(0, 16, [[-5, "stationary"], [0, "automotive"], [10, "walking"], [16, "stationary"]], readings);
    expect(result.map(({ mode, from, to, confidence }) => ({ mode, from, to, confidence }))).toEqual([
      { mode: "automotive", from: 0, to: 10, confidence: "sure" },
      { mode: "walking", from: 10, to: 16, confidence: "sure" }
    ]);
    expect(result[0].distanceMeters).toBeGreaterThan(4_900);
  });

  it("keeps a wait between two modes out of both legs, and gives the trip's ends to its first and last legs", () => {
    const result = legs(0, 20, [[-1, "stationary"], [1, "walking"], [6, "stationary"], [10, "automotive"], [19, "stationary"]]);
    expect(result.map(({ mode, from, to }) => ({ mode, from, to }))).toEqual([
      { mode: "walking", from: 0, to: 6 },
      { mode: "automotive", from: 10, to: 20 }
    ]);
  });

  it("joins one mode across a stop (a car at lights) and a brief burst of another into the leg around it", () => {
    expect(legs(0, 20, [[0, "automotive"], [6, "stationary"], [8, "automotive"], [12, "walking"], [13, "automotive"]])
      .map(({ mode, from, to }) => ({ mode, from, to }))).toEqual([{ mode: "automotive", from: 0, to: 20 }]);
  });

  it("keeps a change walk between two vehicle legs, but not a minute's noise", () => {
    expect(legs(0, 25, [[0, "automotive"], [10, "walking"], [13, "automotive"]]).map(({ mode }) => mode))
      .toEqual(["automotive", "walking", "automotive"]);
    expect(legs(0, 25, [[0, "automotive"], [10, "walking"], [11, "automotive"]]).map(({ mode }) => mode)).toEqual(["automotive"]);
  });

  it("reads a vehicle's speed over walking or stillness, as on a smooth train", () => {
    const readings = [reading(1, 0, 25), reading(3, 3_000, 27), reading(5, 6_000, 26), reading(7, 9_000, 25)];
    expect(legs(0, 8, [[0, "stationary"]], readings).map(({ mode, confidence }) => ({ mode, confidence })))
      .toEqual([{ mode: "automotive", confidence: "likely" }]);
  });

  it("uses speed alone without Core Motion, and gives nothing without any evidence", () => {
    const readings = [reading(0.5, 0, 1.3), reading(2, 120, 1.4), reading(4, 300, 1.2), reading(6, 450, 11), reading(8, 1_800, 12), reading(10, 3_100, 12)];
    expect(legs(0, 11, [], readings).map(({ mode, confidence }) => ({ mode, confidence }))).toEqual([
      { mode: "walking", confidence: "likely" },
      { mode: "automotive", confidence: "likely" }
    ]);
    expect(legs(0, 11, [])).toEqual([]);
  });

  it("ignores broad readings' speed", () => {
    expect(legs(0, 8, [], [reading(1, 0, 25, 1_500), reading(4, 3_000, 25, 1_500)])).toEqual([]);
  });

  it("never lets indeterminate time hold a change of mode", () => {
    // Drive, 30 s cycling, 4½ min of nothing Core Motion could tell, drive again: one drive.
    expect(legs(0, 20, [[0, "automotive"], [8, "cycling"], [8.5, "unknown"], [13, "automotive"]]).map(({ mode }) => mode))
      .toEqual(["automotive"]);
  });

  it("merges a short leg into its moving neighbour across stops", () => {
    expect(legs(0, 20, [[0, "automotive"], [8, "stationary"], [9, "cycling"], [9.5, "stationary"], [11, "automotive"]])
      .map(({ mode, from, to }) => ({ mode, from, to }))).toEqual([{ mode: "automotive", from: 0, to: 20 }]);
  });

  it("never counts a carried Core Motion label as agreement", () => {
    // The whole trip sits in an unknown spell between two drives: the label is carried, so only speed agrees.
    const readings = [reading(31, 0, 12), reading(34, 2_000, 13), reading(38, 5_000, 12)];
    expect(legs(30, 40, [[0, "automotive"], [20, "unknown"], [50, "automotive"]], readings).map(({ mode, confidence }) => ({ mode, confidence })))
      .toEqual([{ mode: "automotive", confidence: "likely" }]);
  });

  it("measures distance along genuine fixes only", () => {
    const genuine = [reading(1, 0, 12), reading(4, 2_000, 13), reading(8, 5_000, 12)];
    const simulated = { ...reading(6, 40_000, 12), evidence: { ...reading(6, 40_000, 12).evidence, isSimulated: true } } as ClassifiedEvidence;
    const steps: Array<[number, MotionActivity]> = [[0, "automotive"]];
    expect(legs(0, 10, steps, [...genuine, simulated].sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt)))[0].distanceMeters)
      .toBe(legs(0, 10, steps, genuine)[0].distanceMeters);
  });

  it("stays fast on a long trip of alternating readings", () => {
    const readings = Array.from({ length: 20_000 }, (_, index) => reading(index * 0.018, index * 2.5, index % 2 ? 2.4 : 2.6));
    const started = performance.now();
    const result = legs(0, 361, [], readings);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.length).toBeGreaterThan(0);
  });

  it("gives legs to the journeys a trip replaced, so a restored one has them too", () => {
    const readings = [reading(1, 0, 12), reading(4, 2_000, 13), reading(8, 5_000, 12)];
    const commute = (id: string, from: number, to: number, ids: string[]) => ({ kind: "commute", clientSegmentId: id, startedAt: at(from),
      stoppedAt: at(to), evidenceIds: ids }) as unknown as CommuteSegment;
    const [trip] = withTripLegs([{ ...commute("trip", 0, 10, ["r-1", "r-4", "r-8"]), legs: [commute("leg-a", 0, 5, ["r-1", "r-4"]),
      commute("leg-b", 5, 10, ["r-8"])] }], [...readings, ...motion([[0, "automotive"]])], config, at(60));
    expect(trip.tripLegs?.map((leg) => leg.mode)).toEqual(["automotive"]);
    expect(trip.legs?.map((leg) => leg.tripLegs?.map((tripLeg) => tripLeg.mode))).toEqual([["automotive"], ["automotive"]]);
  });

  it("comes out of the engine on each trip", () => {
    const output = runLocationEngine(largeBuildingVisitFixture());
    const home = output.segmentUpserts.find((segment): segment is CommuteSegment =>
      segment.kind === "commute" && segment.startedAt === largeBuildingAt(297.5))!;
    expect(home.tripLegs?.map((leg) => leg.mode)).toEqual(["walking", "automotive"]);
    expect(home.tripLegs?.[0].startedAt).toBe(home.startedAt);
    expect(home.tripLegs?.at(-1)?.stoppedAt).toBe(home.stoppedAt);
  });
});
