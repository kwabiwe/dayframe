import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { deriveCommutes } from "../src/location/commute";
import { buildMotionTimeline, motionArrivalMs, motionDepartureMs } from "../src/location/motionActivity";
import { EMPTY_MOTION_CAPTURE_CURSOR, motionQueryStartMs, motionTransitionsFromRecords } from "../src/location/motionCapture";
import { LocationEvidenceSchema } from "../src/location/schemas";
import { runLocationEngine } from "../src/location/segmenter";
import type {
  CommuteSegment, LocationEngineInput, LocationEvidence, MotionActivity, MotionConfidence, StaySegment
} from "../src/location/types";

// Synthetic geometry only: Home at the origin, School 3 km north, a shop 2 km east.
const HOME_ID = "10000000-0000-4000-8000-0000000000b1";
const SCHOOL_ID = "10000000-0000-4000-8000-0000000000b2";
const DEVICE = "20000000-0000-4000-8000-0000000000b1";
const t0 = Date.parse("2026-03-10T07:00:00Z");
const at = (minutes: number) => new Date(t0 + Math.round(minutes * 60_000)).toISOString();
const minutes = (iso: string | null | undefined) => (Date.parse(iso ?? "") - t0) / 60_000;
const north = (metres: number) => metres / 111_195;
const east = (metres: number) => metres / 111_195;

function fix(id: string, minute: number, northMetres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(minute + 1), timeZone: "UTC", endedAt: null,
    latitude: north(northMetres), longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minute: number, kind: "geofence_enter" | "geofence_exit", placeId: string) =>
  fix(id, minute, 0, { kind, savedPlaceId: placeId, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });

/** Core Motion transitions as the app records them: one item per change, received when the app next queried. */
function motion(steps: Array<[minute: number, activity: MotionActivity, confidence?: MotionConfidence]>, queriedAtMinute: number): LocationEvidence[] {
  return steps.map(([minute, activity, confidence = "high"], index) => ({
    clientEvidenceId: `motion-${index}`, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "motion_activity",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(Math.max(minute, queriedAtMinute)), timeZone: "UTC",
    endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null,
    savedPlaceId: null, isSimulated: null, metadata: { motionActivity: activity, motionConfidence: confidence }
  }));
}

const home = { id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true };
const school = { id: SCHOOL_ID, name: "School", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true };

function input(evidence: LocationEvidence[], processingMinute = 240): LocationEngineInput {
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(processingMinute), evidence, savedPlaces: [home, school], acceptedLearnedPlaces: []
  };
}
const run = (evidence: LocationEvidence[]) => runLocationEngine(input(evidence));
const commutesOf = (evidence: LocationEvidence[]) =>
  run(evidence).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
const staysOf = (evidence: LocationEvidence[]) =>
  run(evidence).segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");

/**
 * Home until about 08:07, a drive north with accurate fast fixes from 08:12,
 * School from 08:22. The phone recorded nothing at Home after 08:00, and
 * Home's exit callback came at 08:09:30.
 */
function schoolRun() {
  return [
    ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
    crossing("home-exit", 69.5, "geofence_exit", HOME_ID),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => fix(`drive-${i}`, 72 + i, 600 + i * 330, { speedMetersPerSecond: 12 })),
    crossing("school-enter", 81.9, "geofence_enter", SCHOOL_ID),
    ...[82, 90, 100, 110, 120].map((m, i) => fix(`school-${i}`, m, 3_000 + i % 2 * 4))
  ];
}
// Core Motion: still at Home, walking to the car at 08:07, driving 08:08–08:19, walking in, still from 08:20.
const schoolRunMotion = (queriedAtMinute = 125) => motion([
  [0, "stationary"], [67, "walking"], [68, "automotive"], [79, "walking"], [80, "stationary"]
], queriedAtMinute);

describe("Motion & Fitness activity times journeys", () => {
  it("ends a stay and starts the journey when Core Motion saw the device start moving", () => {
    const [homeStay] = staysOf(schoolRun());
    const [commute] = commutesOf(schoolRun());
    // Without motion: the stay ends at the last Home fix and the journey at Home's exit callback.
    expect(minutes(homeStay.stoppedAt)).toBe(60);
    expect(minutes(commute.startedAt)).toBe(69.5);

    const evidence = [...schoolRun(), ...schoolRunMotion()];
    const [refinedHome] = staysOf(evidence);
    const [refined] = commutesOf(evidence);
    expect(minutes(refinedHome.stoppedAt)).toBe(67);
    expect(minutes(refined.startedAt)).toBe(67);
    // Bounds and identities do not change, so neither can automatic eligibility.
    expect(refinedHome.stopLowerBoundAt).toBe(homeStay.stopLowerBoundAt);
    expect(refinedHome.stopUpperBoundAt).toBe(homeStay.stopUpperBoundAt);
    expect(refinedHome.clientSegmentId).toBe(homeStay.clientSegmentId);
    expect(refined.clientSegmentId).toBe(commute.clientSegmentId);
    expect(refined.startLowerBoundAt).toBe(commute.startLowerBoundAt);
    expect(refined.startUpperBoundAt).toBe(commute.startUpperBoundAt);
  });

  it("ends the journey when Core Motion saw stillness before the first reading at the destination", () => {
    const evidence = [...schoolRun(), ...schoolRunMotion()];
    // The School geofence entry came at 08:21:54; stillness began at 08:20.
    const [commute] = commutesOf(evidence);
    expect(minutes(commute.stoppedAt)).toBe(80);
    expect(minutes(commute.stopLowerBoundAt)).toBe(80);
    expect(commute.stopUpperBoundAt).toBe(at(81.9));
    expect(commute.travelMode).toBe("automotive");
    expect(commute.motionSupported).toBeUndefined();
    // Time at School still starts when the device was observed there.
    const schoolStay = staysOf(evidence)[1];
    expect(minutes(schoolStay.startedAt)).toBeCloseTo(81.9, 1);
  });

  it("changes nothing with only stationary, unknown or low-confidence activity", () => {
    const baseline = run(schoolRun()).segmentUpserts;
    for (const steps of [
      [[0, "stationary"]],
      [[0, "stationary"], [67, "unknown"], [80, "stationary"]],
      [[0, "stationary"], [67, "automotive", "low"], [80, "stationary"]]
    ] as Array<Array<[number, MotionActivity, MotionConfidence?]>>) {
      expect(run([...schoolRun(), ...motion(steps, 125)]).segmentUpserts).toEqual(baseline);
    }
  });

  it("keeps the stay's end when two separate moving blocks make the departure ambiguous", () => {
    const evidence = [...schoolRun(), ...motion([
      [0, "stationary"], [62, "walking"], [63.5, "stationary"], [67, "walking"], [68, "automotive"], [79, "walking"], [80, "stationary"]
    ], 125)];
    expect(minutes(staysOf(evidence)[0].stoppedAt)).toBe(60);
    // Two separate movements before the first route fix: the location-only start stands.
    expect(minutes(commutesOf(evidence)[0].startedAt)).toBe(69.5);
  });

  it("never takes a walk around the place during a long silence for the departure", () => {
    // A parked phone: silent from 08:00 until the first fix away at 08:40. Core Motion saw a
    // 70-second walk at 08:20 and noticed the drive six seconds after that first fix.
    const parked = [
      ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => fix(`drive-${i}`, 100 + i, 600 + i * 330, { speedMetersPerSecond: 12 })),
      ...[110, 120, 130, 140].map((m, i) => fix(`school-${i}`, m, 3_000 + i % 2 * 4))
    ];
    const withoutMotion = staysOf(parked)[0];
    const evidence = [...parked, ...motion([
      [0, "stationary"], [80, "walking"], [81.2, "stationary"], [100.1, "walking"], [101, "automotive"], [107, "walking"], [108, "stationary"]
    ], 150)];
    expect(staysOf(evidence)[0].stoppedAt).toBe(withoutMotion.stoppedAt);
  });

  it("does not reach back from an exit callback to movement long before it", () => {
    // Pottering from 08:03 joins the walk out; the exit at 08:09:30 is over three minutes later.
    const evidence = [...schoolRun(), ...motion([
      [0, "stationary"], [63, "walking"], [64.5, "stationary"], [66, "walking"], [68, "automotive"], [79, "walking"], [80, "stationary"]
    ], 125)];
    expect(minutes(commutesOf(evidence)[0].startedAt)).toBe(69.5);
  });

  it("does not time a departure from a block that began before the last observation at the place", () => {
    // Moving at 07:58, before the 08:00 Home fix: the device was still Home then.
    const evidence = [...schoolRun(), ...motion([[0, "stationary"], [58, "walking"], [68, "automotive"], [80, "stationary"]], 125)];
    expect(minutes(staysOf(evidence)[0].stoppedAt)).toBe(60);
    expect(minutes(commutesOf(evidence)[0].startedAt)).toBe(69.5);
  });

  it("does not confirm an arrival until Core Motion has covered the stillness after it", () => {
    // Queried a minute after the stillness began: movement could still resume.
    const evidence = [...schoolRun(), ...schoolRunMotion(81)];
    const [commute] = commutesOf(evidence);
    expect(minutes(commute.startedAt)).toBe(67);
    expect(commute.stoppedAt).toBe(at(81.9));
  });

  it("never shortens a stay below a dwell threshold it met", () => {
    // Home from 08:00 with fixes until 08:05:30 and the first evidence away at 08:07;
    // the midpoint gives 6.25 minutes of dwell, motion at 08:04:30 would give 4.5.
    const evidence = [
      fix("home-0", 60, 0), fix("home-1", 62, 3), fix("home-2", 65.5, 1),
      fix("away-0", 67, 600, { speedMetersPerSecond: 12 }),
      ...[0, 1, 2, 3, 4, 5].map((i) => fix(`drive-${i}`, 68 + i, 900 + i * 330, { speedMetersPerSecond: 12 })),
      ...[75, 85, 95].map((m, i) => fix(`school-${i}`, m, 3_000 + i % 2 * 4)),
      ...motion([[0, "stationary"], [64.5, "automotive"], [74.5, "stationary"]], 125)
    ];
    const [homeStay] = staysOf(evidence);
    expect(Date.parse(homeStay.stoppedAt!) - Date.parse(homeStay.startedAt)).toBeGreaterThanOrEqual(config.savedPlaceMinimumDwellMs);
  });

  it("never starts the journey before later evidence of being at the origin", () => {
    // A Home fix at 08:08 after motion began at 08:07 means the device was still Home.
    const evidence = [...schoolRun(), fix("home-late", 68, 2), ...schoolRunMotion()];
    const [commute] = commutesOf(evidence);
    expect(Date.parse(commute.startedAt)).toBeGreaterThanOrEqual(Date.parse(at(68)));
  });
});

describe("a journey during a GPS gap", () => {
  const SHOP_EAST = 2_000;
  // Home, then nothing until a stay 2 km east: no route observation at all.
  const gapDrive = () => [
    ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
    ...[90, 95, 100, 105, 110, 115].map((m, i) =>
      fix(`shop-${i}`, m, i % 2 * 4, { longitude: east(SHOP_EAST), speedMetersPerSecond: 0 })),
    ...[140, 150, 160].map((m, i) => fix(`home-pm-${i}`, m, i % 2 * 3))
  ];

  it("is not a journey from location evidence alone", () => {
    const commutes = commutesOf(gapDrive()).filter((commute) => minutes(commute.stoppedAt) < 120);
    expect(commutes).toHaveLength(0);
  });

  it("becomes one low-confidence Review-only drive when Core Motion saw one", () => {
    const evidence = [...gapDrive(), ...motion([[0, "stationary"], [70, "walking"], [71, "automotive"], [77, "walking"], [78, "stationary"]], 125)];
    const [drive] = commutesOf(evidence).filter((commute) => minutes(commute.stoppedAt) < 120);
    expect(drive).toBeDefined();
    expect(minutes(drive.startedAt)).toBe(70);
    expect(minutes(drive.stoppedAt)).toBe(78);
    expect(drive).toMatchObject({ confidence: "low", motionSupported: true, travelMode: "automotive", routeSampleCount: 0,
      continuityStatus: "uncertain_gap", qualificationReason: "significant_endpoint_displacement" });
    expect(drive.evidenceIds).toEqual([]);
    expect(assessAutomaticLocation("v2_enabled", { ...drive, status: "finalised" }).action).toBe("review");
  });

  it("stays unexplained when Core Motion saw two moving blocks (a stop may lie between them)", () => {
    const evidence = [...gapDrive(), ...motion([
      [0, "stationary"], [70, "automotive"], [74, "stationary"], [79, "automotive"], [83, "stationary"]
    ], 125)];
    expect(commutesOf(evidence).filter((commute) => minutes(commute.stoppedAt) < 120)).toHaveLength(0);
  });

  it("stays unexplained when the mode could not cover the distance in time", () => {
    // Two minutes of walking cannot cover 2 km.
    const evidence = [...gapDrive(), ...motion([[0, "stationary"], [70, "walking"], [72, "stationary"]], 125)];
    expect(commutesOf(evidence).filter((commute) => minutes(commute.stoppedAt) < 120)).toHaveLength(0);
  });

  it("labels a long walk as walking", () => {
    const evidence = [...gapDrive(), ...motion([[0, "stationary"], [65, "walking"], [88, "stationary"]], 125)];
    const [walk] = commutesOf(evidence).filter((commute) => minutes(commute.stoppedAt) < 120);
    expect(walk).toMatchObject({ travelMode: "walking", motionSupported: true, confidence: "low" });
  });
});

describe("a short drive with too few fast readings", () => {
  // Two unknown stays 1 km apart; one fast fix on a 100-second drive.
  const shortHop = () => [
    ...[0, 6, 12, 18, 24].map((m, i) => fix(`a-${i}`, m, i % 2 * 3, { latitude: north(10_000), longitude: east(10_000 + i % 2 * 3) })),
    fix("fast", 25.9, 0, { latitude: north(10_000), longitude: east(10_500), speedMetersPerSecond: 11 }),
    ...[27, 33, 39, 45, 51].map((m, i) => fix(`b-${i}`, m, 0, { latitude: north(10_000), longitude: east(11_000 + i % 2 * 3) }))
  ];
  const shortCommutes = (evidence: LocationEvidence[]) =>
    runLocationEngine({ ...input(evidence), savedPlaces: [] }).segmentUpserts
      .filter((segment): segment is CommuteSegment => segment.kind === "commute");

  it("is dropped without motion", () => {
    expect(shortCommutes(shortHop())).toHaveLength(0);
  });

  it("is kept for Review when Core Motion saw one drive", () => {
    const evidence = [...shortHop(), ...motion([[0, "stationary"], [25.2, "automotive"], [26.8, "stationary"]], 60)];
    const [hop] = shortCommutes(evidence);
    expect(hop).toMatchObject({ motionSupported: true, travelMode: "automotive" });
    expect(assessAutomaticLocation("v2_enabled", { ...hop, status: "finalised" }).action).toBe("review");
  });

  it("is not kept for a walk", () => {
    const evidence = [...shortHop(), ...motion([[0, "stationary"], [25.2, "running"], [26.8, "stationary"]], 60)];
    expect(shortCommutes(evidence)).toHaveLength(0);
  });
});

describe("the motion timeline", () => {
  const timeline = (steps: Array<[number, MotionActivity, MotionConfidence?]>, queried: number) =>
    buildMotionTimeline(motion(steps, queried).map((evidence) => ({ evidence, match: null, impliedSpeedMetersPerSecond: null })),
      config, t0 + 1_000 * 60_000);

  it("bridges short stillness inside one journey and splits at longer stillness", () => {
    const bridged = timeline([[0, "stationary"], [10, "walking"], [12, "stationary"], [13.5, "walking"], [16, "stationary"]], 30)!;
    expect(bridged.blocks).toHaveLength(1);
    const split = timeline([[0, "stationary"], [10, "walking"], [12, "stationary"], [15, "walking"], [17, "stationary"]], 30)!;
    expect(split.blocks).toHaveLength(2);
  });

  it("keeps the most confident report of one instant", () => {
    const steps: Array<[number, MotionActivity, MotionConfidence?]> = [[0, "stationary"], [10, "automotive", "low"], [10, "automotive", "high"], [20, "stationary"]];
    const result = timeline(steps, 30)!;
    expect(result.intervals.filter((interval) => interval.fromMs === t0 + 10 * 60_000)).toEqual([
      expect.objectContaining({ confidence: "high" })
    ]);
  });

  it("needs observed stillness on the side it times", () => {
    const result = timeline([[0, "unknown"], [10, "automotive"], [20, "unknown"]], 30)!;
    expect(motionDepartureMs(result, t0 + 5 * 60_000, t0 + 15 * 60_000, config)).toBeNull();
    expect(motionArrivalMs(result, t0 + 15 * 60_000, t0 + 25 * 60_000, config)).toBeNull();
  });
});

describe("motion activity evidence", () => {
  const item = motion([[0, "walking"]], 1)[0];

  it("carries an activity and confidence and never a position or end", () => {
    expect(LocationEvidenceSchema.safeParse(item).success).toBe(true);
    expect(LocationEvidenceSchema.safeParse({ ...item, latitude: 1, longitude: 1 }).success).toBe(false);
    expect(LocationEvidenceSchema.safeParse({ ...item, endedAt: at(5) }).success).toBe(false);
    expect(LocationEvidenceSchema.safeParse({ ...item, metadata: { motionActivity: "walking" } }).success).toBe(false);
    expect(LocationEvidenceSchema.safeParse({ ...fix("f", 0, 0), metadata: { motionActivity: "walking", motionConfidence: "high" } }).success).toBe(false);
  });

  it("is accepted on its own (an upload batch of motion only) and forms nothing", () => {
    const output = run(schoolRunMotion());
    expect(output.acceptedEvidence).toHaveLength(schoolRunMotion().length);
    expect(output.rejectedEvidence).toEqual([]);
    expect(output.segmentUpserts).toEqual([]);
  });

  it("is accepted and processed but never joins a segment's evidence", () => {
    const output = run([...schoolRun(), ...schoolRunMotion()]);
    const motionIds = new Set(schoolRunMotion().map((evidence) => evidence.clientEvidenceId));
    expect(output.acceptedEvidence.filter((item) => motionIds.has(item.evidence.clientEvidenceId))).toHaveLength(motionIds.size);
    expect(output.nextState.processedEvidenceIds).toEqual(expect.arrayContaining([...motionIds]));
    expect(output.segmentUpserts.flatMap((segment) => segment.evidenceIds).filter((id) => motionIds.has(id))).toEqual([]);
  });
});

describe("review round 1: motion never makes a journey more eligible or revokes one", () => {
  const NEAR_SCHOOL = { ...school, latitude: north(1_000) };
  const nearInput = (evidence: LocationEvidence[]) => ({ ...input(evidence), savedPlaces: [home, NEAR_SCHOOL] });
  const nearCommutes = (evidence: LocationEvidence[]) => runLocationEngine(nearInput(evidence)).segmentUpserts
    .filter((segment): segment is CommuteSegment => segment.kind === "commute");
  // Saved endpoints 1 km apart; Home's exit at 08:05, three fast fixes, School observed at 08:07:48.
  const shortSchoolRun = () => [
    ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
    crossing("home-exit", 65, "geofence_exit", HOME_ID),
    fix("route-0", 65.5, 300, { speedMetersPerSecond: 12 }), fix("route-1", 66.3, 600, { speedMetersPerSecond: 12 }),
    fix("route-2", 67, 850, { speedMetersPerSecond: 12 }),
    crossing("school-enter", 67.8, "geofence_enter", SCHOOL_ID),
    ...[67.8, 75, 85, 95].map((m, i) => fix(`school-${i}`, m, 1_000 + i % 2 * 4))
  ];

  it("keeps a short GPS journey Review-only when motion lengthens it past three minutes", () => {
    const [gpsOnly] = nearCommutes(shortSchoolRun());
    expect(assessAutomaticLocation("v2_enabled", { ...gpsOnly, status: "finalised" }).reason).toBe("short_journey_review_only");
    const [timed] = nearCommutes([...shortSchoolRun(), ...motion([[0, "stationary"], [63, "automotive"], [67.5, "stationary"]], 120)]);
    expect(Date.parse(timed.stoppedAt) - Date.parse(timed.startedAt)).toBeGreaterThanOrEqual(config.commuteMinimumDurationMs);
    expect(timed.motionTimed).toBe(true);
    expect(assessAutomaticLocation("v2_enabled", { ...timed, status: "finalised" })).toMatchObject({ action: "review", reason: "motion_review_only" });
  });

  it("never revokes a journey location evidence qualified, even when motion has not yet confirmed its stop", () => {
    const evidence = [
      ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      fix("route", 69, 1_500, { speedMetersPerSecond: 12 }),
      ...[70, 80, 90, 100].map((m, i) => fix(`school-${i}`, m, 3_000 + i % 2 * 4))
    ];
    expect(commutesOf(evidence)).toHaveLength(1);
    const withMotion = commutesOf([...evidence, ...motion([[0, "stationary"], [68.5, "automotive"], [69.9, "stationary"]], 71)]);
    expect(withMotion).toHaveLength(1);
    expect(minutes(withMotion[0].stoppedAt)).toBe(70);
  });

  it("never starts the departure before a later sign of being at the origin in the gap", () => {
    const evidence = [
      ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      fix("home-again", 100, 2),
      crossing("home-exit-late", 101, "geofence_exit", HOME_ID),
      ...[0, 1, 2, 3, 4, 5].map((i) => fix(`drive-${i}`, 102 + i, 600 + i * 400, { speedMetersPerSecond: 12 })),
      ...[110, 120, 130].map((m, i) => fix(`school-${i}`, m, 3_000 + i % 2 * 4)),
      ...motion([[0, "stationary"], [99.5, "automotive"], [109.5, "stationary"]], 140)
    ];
    const output = run(evidence);
    const [commute] = output.segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    expect(Date.parse(commute.startedAt)).toBeGreaterThanOrEqual(Date.parse(at(100)));
    // The same holds when the server re-derives the journey from a decided Home stay ending at 08:00.
    const stays = output.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const rebuilt = deriveCommutes([{ ...stays[0], stoppedAt: at(60), stopLowerBoundAt: at(60), stopUpperBoundAt: at(60) }, stays[1]],
      output.acceptedEvidence, config, at(240));
    expect(rebuilt.every((leg) => Date.parse(leg.startedAt) >= Date.parse(at(100)))).toBe(true);
  });

  it("caps a motion-qualified short drive at low confidence with an explicit Review reason", () => {
    const evidence = [
      ...[0, 15, 30, 45, 60, 65].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      fix("slow-0", 65.6, 400), fix("slow-1", 66.4, 700),
      ...[67.8, 75, 85, 95].map((m, i) => fix(`school-${i}`, m, 1_000 + i % 2 * 4))
    ];
    // Native speed reports zero: no fast-fix proof for this 2.5-minute journey.
    expect(nearCommutes(evidence)).toEqual([]);
    const [hop] = nearCommutes([...evidence, ...motion([[0, "stationary"], [65.2, "automotive"], [67.6, "stationary"]], 120)]);
    expect(hop).toMatchObject({ motionSupported: true, confidence: "low" });
    expect(assessAutomaticLocation("v2_enabled", { ...hop, status: "finalised", stoppedAt: at(80) }))
      .toMatchObject({ action: "review", reason: "motion_review_only" });
  });

  it("never qualifies a round trip through a stop from motion-only legs", () => {
    // Home → a stop 835 m east → Home, 1,675 m of route: a same-place round trip too short to qualify.
    const east835 = (id: string, minute: number, metres: number, patch: Partial<LocationEvidence> = {}) =>
      fix(id, minute, 0, { longitude: east(metres), ...patch });
    const evidence = [
      ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      east835("out", 61, 400, { speedMetersPerSecond: 11 }),
      ...[62, 64, 66, 68, 70].map((m, i) => east835(`stop-${i}`, m, 835 + i % 2 * 3)),
      east835("back-0", 70.6, 600, { speedMetersPerSecond: 11 }), east835("back-1", 71.1, 300, { speedMetersPerSecond: 11 }),
      ...[72, 80, 90, 100].map((m, i) => fix(`home-pm-${i}`, m, i % 2 * 3)),
      ...motion([[0, "stationary"], [60.5, "automotive"], [61.8, "stationary"], [70.3, "automotive"], [71.8, "stationary"]], 120)
    ];
    const trips = commutesOf(evidence).filter((commute) => commute.stops?.length);
    expect(trips).toEqual([]);
  });

  it("never observes a boundary from low-confidence stillness", () => {
    const gap = [
      ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
      ...[90, 95, 100, 105, 110].map((m, i) => fix(`shop-${i}`, m, i % 2 * 4, { longitude: east(2_000) }))
    ];
    const evidence = [...gap, ...motion([[0, "stationary", "low"], [70, "automotive"], [80, "stationary", "low"]], 125)];
    expect(commutesOf(evidence).filter((commute) => minutes(commute.stoppedAt) < 120)).toEqual([]);
  });
});

describe("review round 1: capture records history deterministically and completely", () => {
  const record = (minute: number, activity: MotionActivity, confidence: MotionConfidence = "high") =>
    ({ startMs: t0 + minute * 60_000, activity, confidence });

  it("resolves records sharing an instant the same way whatever their order", () => {
    const records = [record(0, "stationary"), record(10, "automotive", "low"), record(10, "automotive", "high"), record(20, "stationary")];
    const forward = motionTransitionsFromRecords(records, EMPTY_MOTION_CAPTURE_CURSOR, t0 + 30 * 60_000, t0, config);
    const reversed = motionTransitionsFromRecords([...records].reverse(), EMPTY_MOTION_CAPTURE_CURSOR, t0 + 30 * 60_000, t0, config);
    expect(reversed).toEqual(forward);
    expect(forward.transitions.find((transition) => transition.startMs === t0 + 10 * 60_000)?.confidence).toBe("high");
  });

  it("records a record iOS filed late when the next query re-reads the lookback", () => {
    const first = motionTransitionsFromRecords([record(0, "stationary"), record(20, "walking")],
      EMPTY_MOTION_CAPTURE_CURSOR, t0 + 25 * 60_000, t0, config);
    const fromMs = motionQueryStartMs(first.cursor, t0);
    expect(fromMs).toBeLessThanOrEqual(t0 + 10 * 60_000);
    const second = motionTransitionsFromRecords([record(0, "stationary"), record(10, "automotive"), record(20, "walking"), record(30, "stationary")],
      first.cursor, t0 + 40 * 60_000, t0, config);
    expect(second.transitions.map((transition) => transition.startMs)).toContain(t0 + 10 * 60_000);
  });

  it("never records activity before the floor, even when re-reading", () => {
    const result = motionTransitionsFromRecords([record(0, "walking"), record(10, "automotive"), record(20, "stationary")],
      EMPTY_MOTION_CAPTURE_CURSOR, t0 + 30 * 60_000, t0 + 15 * 60_000, config);
    expect(result.transitions.filter((transition) => !transition.continuation).map((transition) => transition.startMs))
      .toEqual([t0 + 20 * 60_000]);
  });
});
