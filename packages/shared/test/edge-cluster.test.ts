import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { runLocationEngine } from "../src/location/segmenter";
import {
  SCHOOL_EDGE_HOME_ID,
  SCHOOL_EDGE_SCHOOL_ID,
  schoolEdgeStopAt as at,
  schoolEdgeStopFixture
} from "../src/location/schoolEdgeStopFixture";
import type { LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

const SCHOOL_METRES = 1_020;
const north = (metres: number) => metres / 111_195;

function run(input: LocationEngineInput) {
  const output = runLocationEngine(input);
  return {
    output,
    stays: output.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay"),
    commutes: output.segmentUpserts.filter((segment) => segment.kind === "commute")
  };
}
const parked = (stays: StaySegment[]) => stays.filter((stay) =>
  stay.startedAt > at("19:12:00") && stay.startedAt < at("19:30:00"));
function add(input: LocationEngineInput, patch: Partial<LocationEvidence> & Pick<LocationEvidence, "clientEvidenceId" | "occurredAt">) {
  const template = input.evidence.find((item) => item.clientEvidenceId === "drive-12")!;
  input.evidence.push({ ...template, sourceTimestamp: patch.occurredAt, receivedAt: patch.occurredAt, ...patch });
  return input;
}
function moveParked(input: LocationEngineInput, metresFromPin: (id: string) => number | null) {
  for (const item of input.evidence) {
    const metres = metresFromPin(item.clientEvidenceId);
    if (metres != null) item.latitude = north(SCHOOL_METRES - metres);
  }
  return input;
}

describe("a stationary cluster at a saved place's edge (4 Oct evening stop)", () => {
  it("is one stay through the phone's silence, described as unknown with the place as a candidate", () => {
    const { stays, commutes } = run(schoolEdgeStopFixture("20:30:00"));
    expect(parked(stays)).toEqual([expect.objectContaining({
      startedAt: at("19:13:16"), stoppedAt: expect.stringMatching(/T19:36:41\./),
      placeMatchKind: "unknown", placeId: null, candidatePlaceIds: expect.arrayContaining([SCHOOL_EDGE_SCHOOL_ID])
    })]);
    // The drive there ends where the stop begins; nothing is described as School.
    expect(commutes.some((commute) => commute.startedAt.startsWith("2026-01-31T19:09:11") && commute.stoppedAt === at("19:13:16"))).toBe(true);
    expect(stays.some((stay) => stay.placeId === SCHOOL_EDGE_SCHOOL_ID)).toBe(false);
    expect(stays.at(-1)).toMatchObject({ placeId: SCHOOL_EDGE_HOME_ID, startedAt: at("19:38:12") });
  });

  it("keeps the stop's identity from its first appearance to finalisation", () => {
    const closed = parked(run(schoolEdgeStopFixture("19:45:00")).stays);
    const finalised = parked(run(schoolEdgeStopFixture("20:30:00")).stays);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ status: "closed", placeMatchKind: "unknown" });
    expect(finalised[0]).toMatchObject({ status: "finalised", clientSegmentId: closed[0].clientSegmentId });
  });

  it("is deterministic for any input order", () => {
    const input = schoolEdgeStopFixture("20:30:00");
    const reversed = { ...input, evidence: [...input.evidence].reverse() };
    expect(runLocationEngine(reversed).segmentUpserts).toEqual(runLocationEngine(input).segmentUpserts);
  });

  it("keeps the saved place when iOS reports entering it before the device left", () => {
    const input = add(schoolEdgeStopFixture("20:30:00"), {
      clientEvidenceId: "school-enter-1913", kind: "geofence_enter", occurredAt: at("19:13:20"),
      savedPlaceId: SCHOOL_EDGE_SCHOOL_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null
    });
    expect(parked(run(input).stays)).toEqual([expect.objectContaining({
      startedAt: at("19:13:16"), stoppedAt: expect.stringMatching(/T19:36:41\./), placeMatchKind: "saved", placeId: SCHOOL_EDGE_SCHOOL_ID
    })]);
  });

  it("keeps the saved place when an accurate Visit callback places the device inside", () => {
    const input = add(schoolEdgeStopFixture("20:30:00"), {
      clientEvidenceId: "visit-inside", kind: "visit", occurredAt: at("19:13:30"), endedAt: null,
      latitude: north(SCHOOL_METRES - 60), horizontalAccuracyMeters: 10, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true }
    });
    const stays = parked(run(input).stays);
    expect(stays).toEqual([expect.objectContaining({ startedAt: at("19:13:16"), placeMatchKind: "saved", placeId: SCHOOL_EDGE_SCHOOL_ID })]);
    // The Visit's coordinate joins the cluster, so the drive away leaves it a few seconds later.
    expect(Math.abs(Date.parse(stays[0].stoppedAt!) - Date.parse(at("19:36:41")))).toBeLessThanOrEqual(10_000);
  });

  it("does not let the drive away (moving fixes and a geofence entry) decide the identity", () => {
    // The fixture's drive home crosses the circle at 86–91 m with a School geofence entry. Moving fixes in the
    // cluster join it without making it ordinary, and its own place's entry is not cluster evidence.
    const input = schoolEdgeStopFixture("20:30:00");
    expect(input.evidence.some((item) => item.clientEvidenceId === "school-enter-1936")).toBe(true);
    const [stay] = parked(run(input).stays);
    expect(stay.evidenceIds).toContain("away-0");
    expect(stay.evidenceIds).not.toContain("school-enter-1936");
    expect(stay.placeMatchKind).toBe("unknown");
  });

  it("is the saved place when the parked readings centre inside the circle", () => {
    const inside = moveParked(schoolEdgeStopFixture("20:30:00"), (id) => id.startsWith("parked-") ? 90 : null);
    expect(parked(run(inside).stays)).toEqual([expect.objectContaining({
      startedAt: at("19:13:16"), placeMatchKind: "saved", placeId: SCHOOL_EDGE_SCHOOL_ID
    })]);
  });

  it("stays one stay when still readings jitter across the tolerance band", () => {
    // 126 m at ±3.5 m is a plausible match; 129 m at ±2 m falls outside the band.
    const jitter = moveParked(schoolEdgeStopFixture("20:30:00"), (id) => id === "parked-1" ? 129 : null);
    jitter.evidence.find((item) => item.clientEvidenceId === "parked-1")!.horizontalAccuracyMeters = 2;
    add(jitter, { clientEvidenceId: "parked-jitter", occurredAt: at("19:20:00"), latitude: north(SCHOOL_METRES - 130),
      horizontalAccuracyMeters: 2, speedMetersPerSecond: 0 });
    expect(parked(run(jitter).stays)).toEqual([expect.objectContaining({
      startedAt: at("19:13:16"), stoppedAt: expect.stringMatching(/T19:36:41\./), placeMatchKind: "unknown"
    })]);
  });

  it("does not let an uncorroborated arrival Visit alone bridge silence as an edge cluster", () => {
    // Without its still fixes only the Visit callbacks and moving fixes remain near the School.
    const input = schoolEdgeStopFixture("20:30:00", { exclude: ["parked-0-slc", "parked-0", "parked-1", "parked-2"] });
    expect(run(input).stays.filter((stay) => stay.startedAt > at("19:10:00") && stay.startedAt < at("19:30:00"))).toEqual([]);
  });

  // Without the place saved: iOS reports no School geofence callbacks.
  const withoutSchool = (input: LocationEngineInput): LocationEngineInput => ({
    ...input,
    savedPlaces: input.savedPlaces.filter((place) => place.id !== SCHOOL_EDGE_SCHOOL_ID),
    evidence: input.evidence.filter((item) => item.savedPlaceId !== SCHOOL_EDGE_SCHOOL_ID)
  });
  // The same stays, neither split nor merged, at about the same times. Unknown
  // clusters also admit moving readings (parking, the drive away), so their
  // ends can differ by about a minute; an edge stay admits only still ones.
  const minutes = (input: LocationEngineInput) => run(input).stays.map((stay) =>
    [Date.parse(stay.startedAt), Date.parse(stay.stoppedAt ?? input.processingAt)].map((ms) => ms / 60_000));
  const expectParity = (input: LocationEngineInput) => {
    const saved = minutes(input);
    const unsaved = minutes(withoutSchool(input));
    expect(saved).toHaveLength(unsaved.length);
    saved.forEach(([start, stop], index) => {
      expect(Math.abs(start - unsaved[index][0])).toBeLessThanOrEqual(2);
      expect(Math.abs(stop - unsaved[index][1])).toBeLessThanOrEqual(2);
    });
  };

  it("has the same stay times as with no place saved there (tonight)", () => {
    expectParity(schoolEdgeStopFixture("20:30:00"));
  });

  it("has the same stay times as with no place saved after a strong reading in the tolerance band (review finding)", () => {
    // 115 m at ±3 m is a strong match by the 25 m tolerance, yet outside the 100 m circle.
    const input = add(schoolEdgeStopFixture("20:30:00"), { clientEvidenceId: "band-strong", occurredAt: at("19:14:00"),
      latitude: north(SCHOOL_METRES - 115), horizontalAccuracyMeters: 3, speedMetersPerSecond: 0 });
    expectParity(input);
    expect(parked(run(input).stays)).toEqual([expect.objectContaining({ placeMatchKind: "unknown", startedAt: at("19:13:16") })]);
  });

  it("does not let a nearby reading absorb a Visit elsewhere (review finding)", () => {
    const input = add(schoolEdgeStopFixture("20:30:00"), { clientEvidenceId: "visit-elsewhere", kind: "visit", occurredAt: at("19:16:00"),
      endedAt: at("19:21:00"), latitude: north(SCHOOL_METRES - 126 - 174), horizontalAccuracyMeters: 20, speedMetersPerSecond: null });
    add(input, { clientEvidenceId: "back-near", occurredAt: at("19:22:00"), latitude: north(SCHOOL_METRES - 128), horizontalAccuracyMeters: 2, speedMetersPerSecond: 0 });
    expectParity(input);
  });

  it("keeps valid bounds when nearby readings follow an exit (review finding)", () => {
    // After the last parked fix, iOS reports leaving the School; still readings just beyond the band follow.
    const input = add(schoolEdgeStopFixture("20:30:00"), { clientEvidenceId: "school-exit-1928", kind: "geofence_exit", occurredAt: at("19:28:00"),
      savedPlaceId: SCHOOL_EDGE_SCHOOL_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
    for (const [id, time, metres] of [["near-0", "19:29:00", 130], ["near-1", "19:30:00", 135], ["near-2", "19:34:00", 140]] as const) {
      add(input, { clientEvidenceId: id, occurredAt: at(time), latitude: north(SCHOOL_METRES - metres), horizontalAccuracyMeters: 2, speedMetersPerSecond: 0 });
    }
    for (const stay of run(input).stays) {
      if (stay.stopLowerBoundAt && stay.stopUpperBoundAt) expect(stay.stopLowerBoundAt <= stay.stopUpperBoundAt).toBe(true);
      if (stay.stopLowerBoundAt && stay.stoppedAt) expect(stay.stopLowerBoundAt <= stay.stoppedAt).toBe(true);
      if (stay.stopUpperBoundAt && stay.stoppedAt) expect(stay.stoppedAt <= stay.stopUpperBoundAt).toBe(true);
    }
  });

  it("does not make a lone Visit beside the circle the saved place (review finding)", () => {
    // A 25-minute completed Visit at 130 m ±10 m, with no still fix and no geofence entry.
    const input = schoolEdgeStopFixture("20:30:00", { exclude: ["parked-0-slc", "parked-0", "parked-1", "parked-2", "visit-1910-open", "visit-1910-done", "parking"] });
    add(input, { clientEvidenceId: "lone-visit", kind: "visit", occurredAt: at("19:12:00"), endedAt: at("19:37:00"),
      latitude: north(SCHOOL_METRES - 130), horizontalAccuracyMeters: 10, speedMetersPerSecond: null });
    expect(run(input).stays.some((stay) => stay.placeId === SCHOOL_EDGE_SCHOOL_ID)).toBe(false);
  });

  it.each([
    ["a Visit in the tolerance band but outside the circle", { clientEvidenceId: "band-visit", kind: "visit" as const, occurredAt: at("19:14:00"), endedAt: null,
      latitude: north(SCHOOL_METRES - 115), horizontalAccuracyMeters: 5, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true } }],
    ["a simulated geofence entry", { clientEvidenceId: "simulated-enter", kind: "geofence_enter" as const, occurredAt: at("19:13:20"),
      savedPlaceId: SCHOOL_EDGE_SCHOOL_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, isSimulated: true }]
  ])("is not kept as the saved place by %s (review finding)", (_label, patch) => {
    expect(parked(run(add(schoolEdgeStopFixture("20:30:00"), patch)).stays)).toEqual([expect.objectContaining({ placeMatchKind: "unknown" })]);
  });

  it.each([
    ["a registration snapshot pair", [["snapshot-exit", "19:13:20", "geofence_exit"], ["snapshot-enter", "19:13:21", "geofence_enter"]]],
    ["a drive through the circle before parking", [["through-enter", "19:11:00", "geofence_enter"], ["through-exit", "19:11:30", "geofence_exit"]]]
  ] as const)("is not kept as the saved place by %s", (_label, callbacks) => {
    const input = schoolEdgeStopFixture("20:30:00");
    for (const [id, time, kind] of callbacks) add(input, { clientEvidenceId: id, kind, occurredAt: at(time), savedPlaceId: SCHOOL_EDGE_SCHOOL_ID,
      latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
    expect(parked(run(input).stays)).toEqual([expect.objectContaining({ placeMatchKind: "unknown" })]);
  });

  it("does not treat a drop-off inside the circle as an edge cluster that bridges to a later stop", () => {
    // Shape of the 4 Oct morning, in two dimensions around a School pin: a moving drop-off inside the circle
    // (no native speed), slow readings in the band about 50 m away while driving round, an exit, then a
    // return to park inside. The drop-off stays part of the journey.
    const school = { id: SCHOOL_EDGE_SCHOOL_ID, name: "School", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true };
    const t = (seconds: number) => new Date(Date.parse(at("19:00:00")) + seconds * 1_000).toISOString();
    const reading = (id: string, seconds: number, x: number, y: number, accuracy: number, speed: number | null = null): LocationEvidence => ({
      clientEvidenceId: id, deviceId: "20000000-0000-4000-8000-000000000061", algorithmVersion: "location-v2.0", kind: "standard_location",
      occurredAt: t(seconds), sourceTimestamp: t(seconds), receivedAt: t(seconds), endedAt: null, timeZone: "UTC",
      latitude: north(y), longitude: north(x), horizontalAccuracyMeters: accuracy, speedMetersPerSecond: speed, savedPlaceId: null, isSimulated: false, metadata: {}
    });
    const callback = (id: string, seconds: number, kind: "geofence_enter" | "geofence_exit"): LocationEvidence => ({
      ...reading(id, seconds, 0, 0, 0), kind, latitude: null, longitude: null, horizontalAccuracyMeters: null, savedPlaceId: school.id
    });
    const evidence = [
      reading("drive-0", 0, 0, -600, 5, 11), reading("drive-1", 30, 0, -270, 5, 11),
      reading("dropoff-0", 60, 0, 74, 23), callback("enter-0", 61, "geofence_enter"), reading("dropoff-1", 70, 0, 97, 25),
      reading("round-0", 113, 30, 140, 21), reading("round-1", 122, 32, 143, 23), reading("round-2", 127, 35, 150, 22),
      callback("exit-0", 180, "geofence_exit"), reading("round-3", 180, 60, 235, 21),
      { ...reading("return-visit", 187, 0, 67, 12), kind: "visit" as const, metadata: { visitDepartureOpen: true } },
      reading("return-0", 228, 0, 76, 22), callback("enter-1", 229, "geofence_enter"),
      reading("return-1", 316, 0, 67, 33), reading("return-2", 900, 0, 70, 20), reading("return-3", 1_500, 0, 68, 15),
      reading("leave-0", 1_560, 0, -300, 5, 11), callback("exit-1", 1_561, "geofence_exit"), reading("leave-1", 1_590, 0, -650, 5, 11)
    ];
    const input: LocationEngineInput = {
      priorState: { algorithmVersion: "location-v2.0", mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
      config: schoolEdgeStopFixture().config, processingAt: t(5_000), savedPlaces: [school], acceptedLearnedPlaces: [], evidence
    };
    const stays = run(input).stays;
    expect(stays.some((stay) => stay.startedAt <= t(70) && (stay.stoppedAt ?? input.processingAt) > t(187))).toBe(false);
    expect(stays.some((stay) => stay.placeId === school.id && stay.startedAt >= t(187))).toBe(true);
  });
});

// Review round 2: compact evidence around a School pin at the origin (seconds from 19:00, metres north).
describe("identity proof at a saved place's edge (review round 2)", () => {
  const school = { id: SCHOOL_EDGE_SCHOOL_ID, name: "School", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true };
  const t = (seconds: number) => new Date(Date.parse("2026-01-31T19:00:00Z") + seconds * 1_000).toISOString();
  const fix = (id: string, seconds: number, metres: number, accuracy = 5, speed: number | null = 0, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: id, deviceId: "20000000-0000-4000-8000-000000000061", algorithmVersion: "location-v2.0", kind: "standard_location",
    occurredAt: t(seconds), sourceTimestamp: t(seconds), receivedAt: t(seconds), endedAt: null, latitude: north(metres), longitude: 0,
    horizontalAccuracyMeters: accuracy, speedMetersPerSecond: speed, savedPlaceId: null, isSimulated: false, timeZone: "UTC", metadata: {}, ...patch
  });
  const cb = (id: string, seconds: number, kind: "geofence_enter" | "geofence_exit", patch: Partial<LocationEvidence> = {}) =>
    fix(id, seconds, 0, 0, null, { kind, savedPlaceId: school.id, latitude: null, longitude: null, horizontalAccuracyMeters: null, ...patch });
  const visit = (id: string, seconds: number, metres: number, accuracy = 5, end: number | null = null) =>
    fix(id, seconds, metres, accuracy, null, { kind: "visit", endedAt: end == null ? null : t(end), metadata: end == null ? { visitDepartureOpen: true } : {} });
  const compact = (evidence: LocationEvidence[], patch: Partial<LocationEngineInput> = {}): LocationEngineInput => ({
    priorState: { algorithmVersion: "location-v2.0", mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config: schoolEdgeStopFixture().config, processingAt: t(5_000), savedPlaces: [school], acceptedLearnedPlaces: [], evidence, ...patch
  });
  const staysOf = (value: LocationEngineInput) => run(value).stays;
  const base = [fix("still-0", 0, 126), fix("still-1", 300, 126), fix("still-2", 900, 126), fix("leave-0", 1_000, 300, 5, 10), fix("leave-1", 1_010, 400, 5, 10)];
  const automatic = (stay: StaySegment) => assessAutomaticLocation("v2_enabled", stay).reason;

  it.each([
    ["an outside-circle Visit corroborated by a tolerance-band fix", [visit("band-visit", 10, 115), fix("strong-band", 20, 115)]],
    ["an outside-circle Visit corroborated by a simulated entry", [visit("band-visit", 10, 115), cb("simulated-enter", 11, "geofence_enter", { isSimulated: true })]],
    ["an outside-circle Visit corroborated by a snapshot pair", [cb("snapshot-exit", 1, "geofence_exit"), cb("snapshot-enter", 2, "geofence_enter"), visit("band-visit", 3, 115)]],
    ["a snapshot pair straddling the last still fix", [cb("snapshot-enter", 899, "geofence_enter"), cb("snapshot-exit", 901, "geofence_exit")]]
  ])("stays unknown and never automatic with %s", (_label, extra) => {
    const [stay] = staysOf(compact([...base, ...extra]));
    expect(stay.placeMatchKind).toBe("unknown");
    expect(automatic(stay)).toBe("untrusted_place");
  });

  it("does not let a Visit reused after leaving and returning prove identity", () => {
    const value = compact([visit("old-inside", 0, 60, 10, 2_400), cb("exit", 600, "geofence_exit"), fix("elsewhere-0", 610, 1_000, 5, 10),
      fix("elsewhere-1", 620, 1_200, 5, 10), fix("elsewhere-2", 1_000, 1_200), fix("edge-0", 1_200, 115), fix("edge-1", 1_500, 115),
      fix("edge-2", 1_800, 115), fix("leave-0", 1_900, 300, 5, 10), fix("leave-1", 1_910, 400, 5, 10)]);
    const stay = staysOf(value).find((candidate) => candidate.startedAt === t(1_200))!;
    expect(stay).toBeDefined();
    expect(stay.placeMatchKind).toBe("unknown");
    expect(automatic(stay)).toBe("untrusted_place");
  });

  it("separates a Visit elsewhere even when the return reading is in the band", () => {
    const value = schoolEdgeStopFixture("20:30:00");
    add(value, { clientEvidenceId: "visit-elsewhere", kind: "visit", occurredAt: at("19:16:00"), endedAt: at("19:21:00"),
      latitude: north(SCHOOL_METRES - 300), horizontalAccuracyMeters: 20, speedMetersPerSecond: null });
    add(value, { clientEvidenceId: "back-in-band", occurredAt: at("19:22:00"), latitude: north(SCHOOL_METRES - 126), horizontalAccuracyMeters: 2, speedMetersPerSecond: 0 });
    expect(run(value).stays.some((stay) => stay.startedAt > at("19:12:00") && stay.startedAt < at("19:16:00") &&
      (stay.stoppedAt ?? value.processingAt) > at("19:21:00"))).toBe(false);
  });

  it("broad-Visit corroboration shapes timing, not identity", () => {
    const value = compact([visit("broad-visit", 0, 115, 70, 3_600), fix("early-0", 30, 115), fix("early-1", 160, 115), fix("late-0", 2_800, 115),
      fix("late-1", 3_100, 115), fix("late-2", 3_400, 115), fix("leave-0", 3_601, 300, 5, 10), fix("leave-1", 3_610, 400, 5, 10)]);
    expect(staysOf(value)[0].placeMatchKind).toBe("unknown");
  });

  it.each([
    ["an ordinary edge cluster is unknown", () => compact(base), "unknown"],
    ["a snapshot pair wholly before the last still fix leaves it unknown",
      () => compact([...base, cb("snapshot-enter", 890, "geofence_enter"), cb("snapshot-exit", 892, "geofence_exit")]), "unknown"],
    ["a genuine entry before the last still fix keeps the place", () => compact([...base, cb("real-enter", 800, "geofence_enter")]), "saved"],
    ["a Visit wholly inside with no GPS keeps the place", () => compact([visit("inside-visit", 0, 60, 10, 1_800)]), "saved"],
    ["a Visit not wholly inside with no GPS is unknown", () => compact([visit("edge-visit", 0, 95, 10, 1_800)]), "unknown"],
    ["Home edge readings centred inside stay Home",
      () => compact([fix("h0", 0, 99), fix("h1", 300, 101), fix("h2", 600, 99), fix("h3", 900, 99), ...base.slice(-2)],
        { savedPlaces: [{ ...school, name: "Home", loggingEnabled: false }] }), "saved"],
    ["a gym-sized circle with readings centred at 75 m stays the gym",
      () => compact([fix("g0", 0, 74), fix("g1", 300, 75), fix("g2", 900, 76), ...base.slice(-2)], { savedPlaces: [{ ...school, name: "Gym", radiusMeters: 80 }] }), "saved"]
  ] as const)("control: %s", (_label, build, kind) => {
    expect(staysOf(build())[0].placeMatchKind).toBe(kind);
  });

  // Review round 3.
  it("keeps an edge cluster and a different stop on the circle's far side as two unknown stays", () => {
    const evidence = [fix("a0", 0, 126), fix("a1", 600, 126), fix("a2", 1_200, 126), fix("x0", 1_260, 230), fix("x1", 1_560, 230), fix("x2", 1_860, 230),
      fix("b0", 1_920, -126), fix("b1", 2_520, -126), fix("b2", 3_120, -126), fix("b3", 3_720, -126), fix("l0", 3_730, 600, 5, 10), fix("l1", 3_740, 700, 5, 10)];
    expect(staysOf(compact(evidence, { savedPlaces: [] }))).toHaveLength(2);
    const saved = staysOf(compact(evidence));
    expect(saved).toHaveLength(2);
    expect(saved.every((stay) => stay.placeMatchKind === "unknown")).toBe(true);
  });

  it("does not let a displaced completion shorten its own stay when it sorts before its arrival", () => {
    const evidence = [fix("p0", 0, 126), fix("p1", 300, 126), visit("z-arrival", 600, 126, 5), visit("m-complete", 600, 320, 20, 1_800),
      fix("p2", 900, 126), fix("p3", 1_200, 126), fix("p4", 1_800, 126), fix("l0", 1_900, 600, 5, 10), fix("l1", 1_910, 700, 5, 10)];
    const [without] = staysOf(compact(evidence.filter((item) => item.clientEvidenceId !== "m-complete")));
    const [stay] = staysOf(compact(evidence));
    expect(without.startedAt).toBe(t(0));
    expect(stay.startedAt).toBe(without.startedAt);
    expect(stay.clientSegmentId).toBe(without.clientSegmentId);
  });

  it("keeps ordered stop bounds when an exit is followed by readings in the band", () => {
    const evidence = [fix("p0", 0, 126), fix("p1", 300, 126), fix("p2", 600, 126), cb("exit", 650, "geofence_exit"),
      fix("p3", 700, 126), fix("p4", 750, 126)];
    // The exit is the edge cluster's own place's callback, so nothing has ended the stay yet (review round 4).
    expect(staysOf(compact(evidence, { processingAt: t(2_000) }))).toEqual([expect.objectContaining({
      status: "open", stoppedAt: null, stopLowerBoundAt: null, stopUpperBoundAt: null
    })]);
    const [stay] = staysOf(compact([...evidence, fix("l0", 800, 600, 5, 10), fix("l1", 810, 700, 5, 10)], { processingAt: t(2_000) }));
    expect(stay.status).toBe("finalised");
    expect([stay.stopLowerBoundAt, stay.stoppedAt, stay.stopUpperBoundAt].every((value) => value != null)).toBe(true);
    expect(stay.stopLowerBoundAt! <= stay.stoppedAt! && stay.stoppedAt! <= stay.stopUpperBoundAt!).toBe(true);
    expect(stay.stopLowerBoundAt! >= t(750) && stay.stopUpperBoundAt! <= t(800)).toBe(true);
  });

  // Review round 4.
  const quiet = [fix("q0", 0, 126), fix("q1", 300, 126), fix("q2", 600, 126), fix("q3", 2_400, 126), fix("q4", 2_700, 126),
    fix("q5", 3_000, 126), fix("l0", 3_100, 600, 5, 10), fix("l1", 3_110, 700, 5, 10)];
  it.each([
    ["exit", [cb("exit", 1_500, "geofence_exit")]],
    ["registration snapshot", [cb("snapshot-exit", 1_500, "geofence_exit"), cb("snapshot-enter", 1_501, "geofence_enter")]]
  ])("does not split a quiet edge cluster at its own place's %s during silence", (_label, extra) => {
    const plain = staysOf(compact(quiet));
    expect(plain).toEqual([expect.objectContaining({ startedAt: t(0), placeMatchKind: "unknown" })]);
    expect(staysOf(compact([...quiet, ...extra])).map(({ clientSegmentId, startedAt, stoppedAt }) => [clientSegmentId, startedAt, stoppedAt]))
      .toEqual(plain.map(({ clientSegmentId, startedAt, stoppedAt }) => [clientSegmentId, startedAt, stoppedAt]));
  });

  it.each([true, false])("keeps a stay whose own Visit completion matches a neighbouring saved place (completion sorts first: %s)", (completionFirst) => {
    const coffee = { ...school, id: "10000000-0000-4000-8000-000000000072", name: "Coffee", latitude: north(320), radiusMeters: 40 };
    const completion = visit(completionFirst ? "a-complete" : "z-complete", 600, 320, 20, 1_800);
    const evidence = [fix("p0", 0, 126), fix("p1", 300, 126), fix("p2", 550, 126), visit(completionFirst ? "z-arrival" : "a-arrival", 600, 126),
      completion, fix("p3", 900, 126), fix("p4", 1_200, 126), fix("p5", 1_800, 126), fix("l0", 1_900, 600, 5, 10), fix("l1", 1_910, 700, 5, 10)];
    const summary = (value: LocationEngineInput) => staysOf(value).map(({ clientSegmentId, startedAt, stoppedAt }) => [clientSegmentId, startedAt, stoppedAt]);
    const without = summary(compact(evidence.filter((item) => item !== completion), { savedPlaces: [school, coffee] }));
    expect(without).toEqual([[expect.any(String), t(0), expect.any(String)]]);
    expect(summary(compact(evidence, { savedPlaces: [school, coffee] }))).toEqual(without);
  });

  it("keeps two stops on opposite sides of the circle separate when the car drives through it", () => {
    const evidence = [fix("a0", 0, 126), fix("a1", 600, 126), fix("a2", 1_200, 126),
      fix("cross0", 1_260, 60, 5, 3), fix("cross1", 1_280, 0, 5, 3), fix("cross2", 1_300, -60, 5, 3), fix("cross3", 1_320, -115, 5, 3),
      fix("b0", 1_400, -126), fix("b1", 1_700, -126), fix("b2", 2_000, -126), fix("b3", 2_600, -126),
      fix("l0", 2_700, -400, 5, 10), fix("l1", 2_710, -600, 5, 10)];
    const without = staysOf(compact(evidence, { savedPlaces: [] }));
    expect(without).toHaveLength(2);
    const saved = staysOf(compact(evidence));
    expect(saved).toHaveLength(2);
    // Each within two minutes of the unsaved stays; the far-side stop starts at its first still fix (b0), where the
    // unsaved cluster restarted at a moving fix through the circle.
    saved.forEach((stay, index) => {
      expect(Math.abs(Date.parse(stay.startedAt) - Date.parse(without[index].startedAt))).toBeLessThanOrEqual(120_000);
      expect(Math.abs(Date.parse(stay.stoppedAt!) - Date.parse(without[index].stoppedAt!))).toBeLessThanOrEqual(120_000);
    });
    expect(saved[1].startedAt).toBe(t(1_400));
    expect(saved.every((stay) => stay.placeMatchKind === "unknown" && automatic(stay) === "untrusted_place")).toBe(true);
  });

  it("gives a stay a new ID when a late iOS entry proves it was at the saved place, so replay retires its earlier Review", () => {
    // Home is not logged, so an open "unknown place" proposal for the same segment would otherwise stay in Review.
    const home = { ...school, name: "Home", loggingEnabled: false };
    const evidence = [fix("p0", 0, 126), fix("p1", 600, 126), fix("p2", 1_200, 126), fix("l0", 1_300, 600, 5, 10), fix("l1", 1_310, 700, 5, 10)];
    const [before] = staysOf(compact(evidence, { savedPlaces: [home], processingAt: t(2_000) }));
    const lateEnter = { ...cb("late-enter", 1_100, "geofence_enter"), receivedAt: t(4_000) };
    const [after] = staysOf(compact([...evidence, lateEnter], { savedPlaces: [home] }));
    expect(before).toMatchObject({ placeMatchKind: "unknown", status: "finalised" });
    expect(after).toMatchObject({ placeMatchKind: "saved", placeId: home.id, startedAt: before.startedAt, stoppedAt: before.stoppedAt });
    expect(after.clientSegmentId).not.toBe(before.clientSegmentId);
  });

  // Review round 5.
  const coffee400 = { ...school, id: "10000000-0000-4000-8000-000000000072", name: "Coffee", latitude: north(400), radiusMeters: 40 };
  const parkedHalfHour = [fix("p0", 0, 126), fix("p1", 300, 126), fix("p2", 600, 126), fix("p3", 1_200, 126), fix("p4", 1_800, 126),
    fix("l0", 1_900, 600, 5, 10), fix("l1", 1_910, 700, 5, 10)];
  const spans = (stays: StaySegment[]) => stays.map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]);

  it("skips its own Visit's displaced completion before a quiet gap can split the cluster", () => {
    const completion = visit("a-completion", 2_400, 400, 20, 3_600);
    const evidence = [fix("p0", 0, 126), fix("p1", 300, 126), fix("p2", 600, 126), visit("z-arrival", 2_400, 126), completion,
      fix("p3", 2_700, 126), fix("p4", 3_000, 126), fix("p5", 3_600, 126), fix("l0", 3_700, 600, 5, 10), fix("l1", 3_710, 700, 5, 10)];
    const without = staysOf(compact(evidence.filter((item) => item !== completion), { savedPlaces: [school, coffee400] }));
    expect(without).toHaveLength(1);
    expect(staysOf(compact(evidence, { savedPlaces: [school, coffee400] }))).toEqual(without);
  });

  it("starts an edge stay at its cluster, not at the drive through the circle before it", () => {
    const evidence = [fix("m0", 0, -80, 5, 4), fix("m1", 20, -60, 5, 4), fix("m2", 40, 0, 5, 4), fix("p0", 60, 126), fix("p1", 360, 126),
      fix("p2", 960, 140), fix("p3", 1_260, 140), fix("l0", 1_360, 600, 5, 10), fix("l1", 1_370, 700, 5, 10)];
    const [without] = staysOf(compact(evidence, { savedPlaces: [] }));
    const saved = staysOf(compact(evidence));
    expect(without.startedAt).toBe(t(60));
    expect(spans(saved)).toEqual(spans([without]));
    expect(saved[0].evidenceIds).not.toContain("m2");
  });

  it("does not turn ten minutes of moving readings at Home into a twenty-minute visit beside it", () => {
    const home = { ...school, name: "Home", loggingEnabled: false };
    const evidence = [fix("d0", 0, 60, 5, 3), fix("d1", 300, 0, 5, 3), fix("d2", 600, 60, 5, 3), fix("p0", 660, 126), fix("p1", 960, 126),
      fix("p2", 1_260, 126), fix("l0", 1_300, 600, 5, 10), fix("l1", 1_310, 700, 5, 10)];
    const [without] = staysOf(compact(evidence, { savedPlaces: [] }));
    const saved = staysOf(compact(evidence, { savedPlaces: [home] }));
    expect(without.startedAt).toBe(t(660));
    expect(spans(saved)).toEqual(spans([without]));
    // Under the twenty minutes an unknown stay needs for Review either way; the movement alone is no stay.
    expect(Date.parse(saved[0].stoppedAt!) - Date.parse(saved[0].startedAt)).toBeLessThan(20 * 60_000);
  });

  it.each([
    ["an inside fix during silence", [fix("q0", 0, 126), fix("q1", 300, 126), fix("q2", 600, 126), fix("q3", 2_400, 126), fix("q4", 2_700, 126),
      fix("q5", 3_000, 126), fix("l0", 3_100, 600, 5, 10), fix("l1", 3_110, 700, 5, 10)], [fix("sim", 1_800, 0, 5, 0, { isSimulated: true })]],
    ["a fix at a neighbouring saved place", parkedHalfHour, [fix("sim", 650, 400, 5, 0, { isSimulated: true })]],
    ["two moving fixes far away", parkedHalfHour, [fix("sim-0", 650, 600, 5, 10, { isSimulated: true }), fix("sim-1", 660, 700, 5, 10, { isSimulated: true })]]
  ])("is never ended or split by simulated evidence: %s", (_label, evidence, simulated) => {
    const plain = staysOf(compact(evidence, { savedPlaces: [school, coffee400] }));
    expect(plain).toHaveLength(1);
    expect(spans(staysOf(compact([...evidence, ...simulated], { savedPlaces: [school, coffee400] })))).toEqual(spans(plain));
  });

  it.each([
    ["broad", { horizontalAccuracyMeters: 150 }],
    ["simulated", { isSimulated: true }]
  ])("does not let a %s callback in the cluster make a genuine Visit elsewhere its own", (_label, patch) => {
    const far = visit("a-completion", 650, 400, 5, 1_100);
    const near = { ...visit("z-arrival", 650, 126), ...patch };
    // The genuine completion at the café still ends the edge stay, as it does with no callback in the cluster.
    const edgeStay = (evidence: LocationEvidence[]) => staysOf(compact(evidence, { savedPlaces: [school, coffee400] }))
      .filter((stay) => stay.startedAt === t(0));
    const [withFar] = edgeStay([...parkedHalfHour, far]);
    expect(withFar.stoppedAt! <= t(650)).toBe(true);
    expect(edgeStay([...parkedHalfHour, far, near])).toEqual([withFar]);
  });

  it("does not let a simulated fix inside the circle end edge continuity", () => {
    const evidence = [fix("p0", 0, 126), fix("p1", 300, 126), fix("p2", 600, 126), fix("p3", 1_800, 126), fix("p4", 2_100, 126),
      fix("p5", 2_700, 126), fix("l0", 3_100, 600, 5, 10), fix("l1", 3_110, 700, 5, 10)];
    const times = (stays: StaySegment[]) => stays.map(({ startedAt, stoppedAt, placeMatchKind }) => [startedAt, stoppedAt, placeMatchKind]);
    const plain = staysOf(compact(evidence));
    expect(plain).toHaveLength(1);
    expect(times(staysOf(compact([...evidence, fix("simulated-inside", 660, 0, 5, 0, { isSimulated: true })])))).toEqual(times(plain));
  });

  it("control: bare geofence callbacks cannot make a stay", () => {
    expect(staysOf(compact([cb("enter", 0, "geofence_enter"), cb("exit", 1_800, "geofence_exit")]))).toEqual([]);
  });

  it("control: strong fixes still bridge exactly thirty minutes", () => {
    const before = [fix("p0", 0, 60), fix("p1", 300, 60)];
    expect(staysOf(compact([...before, fix("p2", 2_100, 60), fix("p3", 2_400, 60)]))).toHaveLength(1);
    expect(staysOf(compact([...before, fix("p2", 2_101, 60), fix("p3", 2_401, 60)]))).toHaveLength(2);
  });

  it("control: a learned place keeps the twelve-minute gap", () => {
    const value = compact([fix("p0", 0, 60), fix("p1", 300, 60), fix("p2", 1_080, 60), fix("p3", 1_380, 60)],
      { savedPlaces: [], acceptedLearnedPlaces: [{ ...school, accepted: true } as never] });
    expect(staysOf(value)).toHaveLength(2);
  });

  it("control: shuffled evidence and saved-place order give the same output", () => {
    const value = schoolEdgeStopFixture();
    const expected = runLocationEngine(value).segmentUpserts;
    for (let seed = 1; seed <= 20; seed += 1) {
      const evidence = [...value.evidence];
      let state = seed;
      for (let index = evidence.length - 1; index > 0; index -= 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        const other = state % (index + 1);
        [evidence[index], evidence[other]] = [evidence[other], evidence[index]];
      }
      expect(runLocationEngine({ ...value, evidence, savedPlaces: [...value.savedPlaces].reverse() }).segmentUpserts).toEqual(expected);
    }
  });
});
