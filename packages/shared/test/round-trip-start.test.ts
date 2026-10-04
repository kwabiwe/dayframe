import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { physicalStopAt, physicalStopFixture, PHYSICAL_STOP_PICKUP } from "../src/location/physicalStopFixture";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, LocationEvidence } from "../src/location/types";
import { simulate, type Scenario, type SimPlace } from "./fixtures/captureSimulator";

const HOME_ID = "10000000-0000-4000-8000-0000000000f1";
const DEVICE = "20000000-0000-4000-8000-0000000000f1";
const t0 = Date.parse("2026-03-09T08:00:00Z");
const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
const north = (metres: number) => metres / 111_195;

/** A reading `metres` north of Home (east via `longitude`), received a minute later. */
function e(id: string, minutes: number, metres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes + 1), timeZone: "UTC", endedAt: null,
    latitude: north(metres), longitude: 0, horizontalAccuracyMeters: 4, speedMetersPerSecond: 11, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const geofence = (id: string, minutes: number, kind: "geofence_enter" | "geofence_exit") =>
  e(id, minutes, 0, { kind, savedPlaceId: HOME_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
const homeVisit = (id: string, minutes: number) =>
  e(id, minutes, 5, { kind: "visit", horizontalAccuracyMeters: 10, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true } });
const input = (evidence: LocationEvidence[], processingMinutes = 250): LocationEngineInput => ({
  priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
  config, processingAt: at(processingMinutes), acceptedLearnedPlaces: [], evidence,
  savedPlaces: [{ id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false }]
});
const commutes = (value: LocationEngineInput) =>
  runLocationEngine(value).segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
const times = (trips: CommuteSegment[]) => trips.map(({ startedAt, stoppedAt, stops }) => [startedAt, stoppedAt, stops?.length ?? 0]);

/** Drives in 75 m steps at 11 m/s from the current position, appending fixes. */
function driver(evidence: LocationEvidence[], prefix: string, startMinutes: number) {
  let clock = startMinutes;
  let position = { x: 0, y: 0 };
  let sequence = 0;
  return {
    get clock() { return clock; },
    set clock(value: number) { clock = value; },
    to(target: { x: number; y: number }) {
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const length = Math.hypot(dx, dy);
      const from = { ...position };
      const steps = Math.ceil(length / 75);
      for (let step = 1; step <= steps; step += 1) {
        clock += (step === steps ? length - (step - 1) * 75 : 75) / 11 / 60;
        const fraction = Math.min(1, (step * 75) / length);
        position = { x: from.x + dx * fraction, y: from.y + dy * fraction };
        evidence.push(e(`${prefix}-${sequence++}`, clock, position.y, { longitude: north(position.x) }));
      }
    }
  };
}

/** Home, a 2 km drive out and straight back, and a return arrival Visit dated while still 400 m away. */
function roundTrip(options: { returnVisit?: boolean; extra?: LocationEvidence[] } = {}): LocationEngineInput {
  const evidence: LocationEvidence[] = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 3, { speedMetersPerSecond: 0 }),
    e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("home-exit", 30.2, "geofence_exit")];
  let minutes = 30.3;
  for (let metres = 120; metres <= 2_000; metres += 75, minutes += 75 / 11 / 60) evidence.push(e(`out-${metres}`, minutes, metres));
  for (let metres = 1_925; metres >= 120; metres -= 75, minutes += 75 / 11 / 60) evidence.push(e(`back-${metres}`, minutes, metres));
  const backAt = minutes;
  // iOS dates the arrival before the car stops; its coordinate is at Home.
  if (options.returnVisit !== false) evidence.push({ ...homeVisit("return-visit", backAt - 0.6), receivedAt: at(backAt + 5) });
  evidence.push(e("arrive-0", backAt, 60, { speedMetersPerSecond: 6 }), geofence("home-enter", backAt + 0.05, "geofence_enter"),
    e("home-3", backAt + 1, 2, { speedMetersPerSecond: 0 }), e("home-4", backAt + 15, 0, { speedMetersPerSecond: 0 }),
    e("home-5", backAt + 40, 3, { speedMetersPerSecond: 0 }), ...(options.extra ?? []));
  return input(evidence, backAt + 120);
}

/**
 * A detoured drive to a five-minute stop 700 m away and a straight return short
 * enough that iOS dates the Home arrival while the car is still at the stop.
 */
function shortReturn(extra: (stopAt: number) => LocationEvidence[] = () => []) {
  const evidence: LocationEvidence[] = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
    e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("home-exit", 30, "geofence_exit")];
  const drive = driver(evidence, "route", 30.02);
  drive.to({ x: 490, y: 300 });
  drive.to({ x: 0, y: 700 });
  const parkedAt = drive.clock;
  for (const offset of [0.02, 1, 2.5, 4]) evidence.push(e(`stop-${offset}`, parkedAt + offset, 700, { speedMetersPerSecond: 0 }));
  evidence.push(homeVisit("return-visit", parkedAt + 5 + 700 / 11 / 60 - 1.5), ...extra(parkedAt));
  drive.clock = parkedAt + 5;
  drive.to({ x: 0, y: 0 });
  evidence.push(geofence("home-enter", drive.clock + 0.02, "geofence_enter"), e("home-3", drive.clock + 1, 0, { speedMetersPerSecond: 0 }),
    e("home-4", drive.clock + 11, 0, { speedMetersPerSecond: 0 }));
  return input(evidence);
}

/**
 * A 2 km round trip whose return is seen only by Home's geofence entry (its
 * arrival Visit is dated before the last fixes away), with the first accurate
 * still fix at Home `stillAfterMinutes` later.
 */
function lateReturn(stillAfterMinutes: number) {
  const evidence: LocationEvidence[] = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
    e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("home-exit", 30.2, "geofence_exit")];
  let minutes = 30.3;
  for (let metres = 200; metres <= 2_000; metres += 75, minutes += 75 / 11 / 60) evidence.push(e(`out-${metres}`, minutes, metres));
  for (let metres = 1_925; metres >= 200; metres -= 75, minutes += 75 / 11 / 60) evidence.push(e(`back-${metres}`, minutes, metres));
  const backAt = minutes;
  evidence.push({ ...homeVisit("early-visit", backAt - 2), receivedAt: at(backAt + 5) }, geofence("home-enter", backAt + 0.3, "geofence_enter"),
    e("home-3", backAt + stillAfterMinutes, 0, { speedMetersPerSecond: 0 }), e("home-4", backAt + stillAfterMinutes + 10, 0, { speedMetersPerSecond: 0 }),
    e("home-5", backAt + stillAfterMinutes + 20, 0, { speedMetersPerSecond: 0 }));
  return { value: input(evidence, backAt + stillAfterMinutes + 120), backAt };
}

// Simulated capture: two short stops on one outing, each with a single still fix and a Visit.
const HOME: SimPlace = { id: HOME_ID, name: "Home", at: { x: 0, y: 0 }, radius: 100, loggingEnabled: false };
const outing: Scenario = { start: "2026-03-09T12:00:00Z", origin: HOME.at, places: [HOME], legs: [
  { kind: "stay", minutes: 60 }, { kind: "drive", to: { x: 1_500, y: 300 } }, { kind: "stay", minutes: 6 },
  { kind: "drive", to: { x: 1_900, y: 900 } }, { kind: "stay", minutes: 7 },
  { kind: "drive", to: HOME.at, via: [{ x: 900, y: 600 }] }, { kind: "stay", minutes: 90 }
] };

describe("the start of a same-place round trip", () => {
  it("is the departure, not the return's early-dated arrival Visit", () => {
    const output = runLocationEngine(roundTrip());
    const [home] = output.segmentUpserts;
    const trips = output.segmentUpserts.filter((segment) => segment.kind === "commute");
    // The whole 5.6-minute drive, from where the Home stay ended.
    expect(trips).toEqual([expect.objectContaining({ startedAt: home.stoppedAt, qualificationReason: "same_place_meaningful_round_trip" })]);
    expect(Date.parse(trips[0].stoppedAt!) - Date.parse(trips[0].startedAt)).toBeGreaterThan(5 * 60_000);
  });

  it("matches the trip without the early Visit", () => {
    expect(times(commutes(roundTrip()))).toEqual(times(commutes(roundTrip({ returnVisit: false }))));
  });

  it("ignores Home's exit re-reported while the car is 2 km away", () => {
    // On 4 Oct the app re-registered its regions at an interior stop and iOS re-reported Home's exit, 900 m away.
    const reReported = [geofence("re-reported-exit", 33.2, "geofence_exit"),
      e("provider", 33.2, 0, { kind: "provider_status", latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null })];
    const output = runLocationEngine(roundTrip({ returnVisit: false, extra: reReported }));
    const [home] = output.segmentUpserts;
    expect(output.segmentUpserts.filter((segment) => segment.kind === "commute")).toEqual([expect.objectContaining({ startedAt: home.stoppedAt })]);
  });

  it("still starts a drive at Home's exit when a capture gap means the next fix is already 1.5 km away", () => {
    // Only fixes before an exit can show it was re-reported: this exit fired as the car left a quiet Home.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      geofence("exit", 200, "geofence_exit"), e("far-0", 202, 1_500), e("far-1", 203, 2_000), e("back-0", 205, 1_000),
      e("back-1", 206.5, 300), geofence("enter", 207, "geofence_enter"), e("home-2", 207.3, 0, { speedMetersPerSecond: 0 }),
      e("home-3", 220, 0, { speedMetersPerSecond: 0 }), e("home-4", 240, 0, { speedMetersPerSecond: 0 })];
    expect(commutes(input(evidence, 400))).toEqual([expect.objectContaining({ startedAt: at(200), qualificationReason: "same_place_meaningful_round_trip" })]);
  });

  it("still starts a drive at Home's exit after a stray fix just outside Home hours earlier", () => {
    // Control: a fix 140 m out while at Home is not an excursion, so the exit that follows hours later still marks departure.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      e("home-2", 20, 0, { speedMetersPerSecond: 0 }), e("stray", 25, 140, { speedMetersPerSecond: 0 }), geofence("exit", 200, "geofence_exit")];
    let minutes = 200.1;
    for (let metres = 200; metres <= 2_000; metres += 75, minutes += 75 / 11 / 60) evidence.push(e(`out-${metres}`, minutes, metres));
    for (let metres = 1_925; metres >= 200; metres -= 75, minutes += 75 / 11 / 60) evidence.push(e(`back-${metres}`, minutes, metres));
    evidence.push(geofence("enter", minutes + 0.1, "geofence_enter"), e("home-3", minutes + 0.3, 0, { speedMetersPerSecond: 0 }),
      e("home-4", minutes + 10, 0, { speedMetersPerSecond: 0 }), e("home-5", minutes + 20, 0, { speedMetersPerSecond: 0 }));
    expect(commutes(input(evidence, minutes + 120))).toEqual([expect.objectContaining({ startedAt: at(200), qualificationReason: "same_place_meaningful_round_trip" })]);
  });

  // Review findings: the trip's start must not depend on which reading happens to be farthest.
  it.each([
    ["an extra accurate still fix 0.5 m farther at the stop", (stopAt: number) =>
      [e("late-still", stopAt + 4.8, 700.5, { speedMetersPerSecond: 0 })]],
    ["a broad fix 200 m beyond the stop", (stopAt: number) =>
      [e("broad-stop", stopAt + 4.8, 900, { horizontalAccuracyMeters: 200, speedMetersPerSecond: 0 })]]
  ])("keeps a short return through a stop unchanged by %s", (_label, extra) => {
    const clean = commutes(shortReturn());
    expect(clean).toEqual([expect.objectContaining({ qualificationReason: "same_place_meaningful_round_trip" })]);
    expect(clean[0].startedAt <= at(30.25)).toBe(true);
    expect(clean[0].stops).toHaveLength(1);
    expect(times(commutes(shortReturn(extra)))).toEqual(times(clean));
  });

  it("still restarts the trip at a moving pass-by at Home, as before this change", () => {
    // Known limitation, kept deliberately: a pass-by and a brief return look alike (a still or speedless reading,
    // an entry and exit), so the latest accurate evidence at Home still starts the trip and the first loop is uncovered.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("first-exit", 30, "geofence_exit"),
      e("loop1-out", 30.5, 300), e("loop1-peak", 32, 1_200), e("loop1-back", 33.5, 650),
      geofence("mid-enter", 34.5, "geofence_enter"), e("mid-home", 34.6, 30), geofence("mid-exit", 34.9, "geofence_exit"),
      e("loop2-out", 35, 250), e("loop2-peak", 37.5, 2_000), e("loop2-back", 40, 750),
      geofence("last-enter", 41, "geofence_enter"), e("final-0", 41.5, 0, { speedMetersPerSecond: 0 }),
      e("final-1", 51.5, 0, { speedMetersPerSecond: 0 }), e("final-2", 61.5, 0, { speedMetersPerSecond: 0 })];
    const trips = commutes(input(evidence));
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(34.9) })]);
    expect(trips[0].evidenceIds).toContain("loop2-peak");
  });

  it("keeps a short out-and-back unchanged by a return Visit dated before its first far fix (review finding)", () => {
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("exit", 30, "geofence_exit")];
    let minutes = 30;
    for (let metres = 75; metres <= 975; metres += 75) evidence.push(e(`out-${metres}`, minutes += 75 / 11 / 60, metres));
    minutes += 25 / 60;
    for (let metres = 900; metres >= 0; metres -= 75) evidence.push(e(`back-${metres}`, minutes += 75 / 11 / 60, metres));
    evidence.push(geofence("enter", minutes + 0.02, "geofence_enter"), e("parked", minutes + 0.05, 0, { speedMetersPerSecond: 0 }),
      e("home-3", minutes + 10, 0, { speedMetersPerSecond: 0 }), e("home-4", minutes + 20, 0, { speedMetersPerSecond: 0 }));
    const clean = commutes(input(evidence));
    expect(clean).toEqual([expect.objectContaining({ qualificationReason: "same_place_meaningful_round_trip" })]);
    expect(clean[0].startedAt <= at(30.2)).toBe(true);
    expect(times(commutes(input([...evidence, homeVisit("early-return", minutes - 2.5)])))).toEqual(times(clean));
  });

  it("keeps a round trip seen back only by its entry when the Home stay begins soon after", () => {
    const { value, backAt } = lateReturn(2);
    const trips = commutes(value);
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(30.2), qualificationReason: "same_place_meaningful_round_trip" })]);
    expect(Date.parse(trips[0].stoppedAt!)).toBeLessThanOrEqual(Date.parse(at(backAt + 2)));
  });

  it("claims no stationary Home time when the Home stay begins half an hour after the return (review finding)", () => {
    const { value, backAt } = lateReturn(30);
    const stays = runLocationEngine(value).segmentUpserts.filter((segment) => segment.kind === "stay");
    // The Home stay does begin late here, so a trip to it would include 30 minutes at Home.
    expect(stays.at(-1)!.startedAt >= at(backAt + 29)).toBe(true);
    expect(commutes(value).filter((trip) => Date.parse(trip.stoppedAt!) > Date.parse(at(backAt + 2)))).toEqual([]);
  });

  it("claims no stationary Home time when a stray fix near Home follows the return (review finding)", () => {
    const { value, backAt } = lateReturn(30);
    const evidence = [...value.evidence, e("stray-after-return", backAt + 15, 140, { speedMetersPerSecond: 0 })];
    expect(commutes({ ...value, evidence }).filter((trip) => Date.parse(trip.stoppedAt!) > Date.parse(at(backAt + 2)))).toEqual([]);
  });

  it("keeps a round trip whose route fixes report no accuracy (review finding)", () => {
    const value = roundTrip({ returnVisit: false });
    const evidence = value.evidence.map((item) => /^(out|back)-/.test(item.clientEvidenceId) ? { ...item, horizontalAccuracyMeters: null } : item);
    expect(commutes({ ...value, evidence })).toEqual([expect.objectContaining({ startedAt: at(30.2), qualificationReason: "same_place_meaningful_round_trip" })]);
  });

  it("leaves no overlapping legs when a trip through a stop reaches a Home stay that begins an hour late (review finding)", () => {
    const value = physicalStopFixture(PHYSICAL_STOP_PICKUP);
    const shift = (iso: string) => physicalStopAt(Date.parse(iso) - Date.parse(physicalStopAt(0)) + 3_600_000);
    const template = value.evidence.find((item) => item.clientEvidenceId === "return-0")!;
    value.evidence = value.evidence.map((item) => item.clientEvidenceId.startsWith("return-")
      ? { ...item, occurredAt: shift(item.occurredAt), sourceTimestamp: shift(item.occurredAt), endedAt: item.endedAt ? shift(item.endedAt) : null }
      : item);
    value.evidence.push({ ...template, clientEvidenceId: "early-return", occurredAt: physicalStopAt(1_308_000),
      sourceTimestamp: physicalStopAt(1_308_000), speedMetersPerSecond: 0 });
    const trips = commutes(value).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(trips.length).toBeGreaterThan(0);
    trips.slice(1).forEach((trip, index) => expect(trip.startedAt >= trips[index].stoppedAt!).toBe(true));
  });

  it.each(["standard_location", "visit"] as const)("starts at the real departure after an earlier broad %s far away", (kind) => {
    // Home, then a quiet hour with one broad far reading, then Home again and the real 2 km loop.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 6, 0, { speedMetersPerSecond: 0 }),
      e("home-2", 58, 0, { speedMetersPerSecond: 0 }),
      e("broad-earlier", 65, 1_350, { kind, horizontalAccuracyMeters: 200, speedMetersPerSecond: null, ...(kind === "visit" ? { endedAt: at(72) } : {}) }),
      e("origin", 77, 0, { speedMetersPerSecond: 0 }), geofence("exit", 77.01, "geofence_exit"),
      e("out-1", 82, 650), e("out-2", 84.5, 1_200), e("back", 87, 650),
      geofence("enter", 89, "geofence_enter"), e("home-late", 94, 0, { speedMetersPerSecond: 0 })];
    const trips = commutes(input(evidence));
    expect(trips).toHaveLength(1);
    expect(trips.every((trip) => trip.startedAt >= at(77))).toBe(true);
  });

  it("starts a later drive at its own departure after an earlier walk and a quiet hour at Home (review finding)", () => {
    // Away 900 m and back, Home for 90 minutes with no Visit or still fix after the return, then a real drive.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      geofence("walk-exit", 20, "geofence_exit"), e("walk-out", 25, 500, { speedMetersPerSecond: 3 }), e("walk-far", 30, 900, { speedMetersPerSecond: 3 }),
      e("walk-back", 35, 400, { speedMetersPerSecond: 3 }), geofence("walk-enter", 39, "geofence_enter"), e("walk-home", 39.2, 40, { speedMetersPerSecond: 3 }),
      geofence("drive-exit", 130, "geofence_exit"), e("drive-0", 130.5, 300), e("drive-1", 132, 1_000), e("drive-2", 133.5, 1_800),
      e("drive-3", 135, 1_000), e("drive-4", 136.5, 300), geofence("drive-enter", 137, "geofence_enter"),
      e("home-2", 137.5, 0, { speedMetersPerSecond: 0 }), e("home-3", 150, 0, { speedMetersPerSecond: 0 }), e("home-4", 170, 0, { speedMetersPerSecond: 0 })];
    const drives = commutes(input(evidence, 300)).filter((trip) => trip.stoppedAt! > at(133));
    expect(drives).toHaveLength(1);
    expect(drives[0].startedAt >= at(129)).toBe(true);
  });

  // Seed 29 (lost under the latest-support rule) pins a review finding; the rest guard the ordinary shape.
  it.each([...Array.from({ length: 20 }, (_, index) => index + 1), 29])("keeps a simulated outing with short stops as one round trip (seed %i)", (seed) => {
    const sim = simulate(outing, seed);
    const departure = sim.truth.stays[0].to;
    const returned = sim.truth.stays[3].from;
    const trips = commutes(sim.input()).filter((trip) =>
      Date.parse(trip.startedAt) < returned && Date.parse(trip.stoppedAt!) > departure);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ qualificationReason: "same_place_meaningful_round_trip", fromPlaceId: HOME_ID, toPlaceId: HOME_ID });
    expect(Math.abs(Date.parse(trips[0].startedAt) - departure)).toBeLessThanOrEqual(2 * 60_000);
    expect(Math.abs(Date.parse(trips[0].stoppedAt!) - returned)).toBeLessThanOrEqual(2 * 60_000);
  });

  // In seeds 187 and 642 the return Visit is dated before the last fixes away and the Home stay begins over half an
  // hour after the car stops; no trip may claim that time (review finding).
  it.each([187, 642])("claims no stationary Home time in a simulated outing whose Home stay begins late (seed %i)", (seed) => {
    const sim = simulate(outing, seed);
    const returned = sim.truth.stays[3].from;
    const stays = runLocationEngine(sim.input()).segmentUpserts.filter((segment) => segment.kind === "stay");
    expect(Date.parse(stays.at(-1)!.startedAt) - returned).toBeGreaterThan(30 * 60_000);
    expect(commutes(sim.input()).filter((trip) => Date.parse(trip.stoppedAt!) > returned + 2 * 60_000)).toEqual([]);
  });
});

describe("a later departure after an earlier excursion (review finding)", () => {
  // A 900 m walk whose return only Home's geofence entry saw, a quiet stretch at Home, then a real drive.
  const walkThenDrive = (driveAt: number, to: "home" | "work" = "home") => {
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      geofence("walk-exit", 20, "geofence_exit"), e("walk-out", 25, 500, { speedMetersPerSecond: 1.35 }),
      e("walk-far", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-back", 35, 400, { speedMetersPerSecond: 1.35 }),
      geofence("walk-enter", 39, "geofence_enter"), geofence("drive-exit", driveAt, "geofence_exit"),
      e("drive-0", driveAt + 0.5, 300), e("drive-1", driveAt + 2, 1_000), e("drive-2", driveAt + 3.5, 1_800)];
    if (to === "work") {
      evidence.push(e("work-0", driveAt + 4.2, 2_000, { speedMetersPerSecond: 0 }), e("work-1", driveAt + 14.2, 2_000, { speedMetersPerSecond: 0 }),
        e("work-2", driveAt + 24.2, 2_000, { speedMetersPerSecond: 0 }));
    } else {
      evidence.push(e("drive-3", driveAt + 5, 1_000), e("drive-4", driveAt + 6.5, 300), geofence("drive-enter", driveAt + 7, "geofence_enter"),
        e("home-2", driveAt + 7.5, 0, { speedMetersPerSecond: 0 }), e("home-3", driveAt + 20, 0, { speedMetersPerSecond: 0 }),
        e("home-4", driveAt + 40, 0, { speedMetersPerSecond: 0 }));
    }
    const value = input(evidence, driveAt + 200);
    if (to === "work") value.savedPlaces.push({ id: "10000000-0000-4000-8000-0000000000f2", name: "Work", latitude: north(2_000), longitude: 0, radiusMeters: 100, loggingEnabled: true });
    return value;
  };
  it.each([[130, "home"], [330, "home"], [130, "work"]] as const)("starts a drive at %i minutes to %s at its own exit after a walk whose return only the entry saw", (driveAt, to) => {
    const drives = commutes(walkThenDrive(driveAt, to)).filter((trip) => trip.stoppedAt! > at(driveAt));
    expect(drives).toEqual([expect.objectContaining({ startedAt: at(driveAt) })]);
  });


  const HOME_SIM: SimPlace = { id: HOME_ID, name: "Home", at: { x: 0, y: 0 }, radius: 100, loggingEnabled: false };
  const quietHome = (homeMinutes: number): Scenario => ({ start: "2026-03-09T08:00:00Z", origin: HOME_SIM.at, places: [HOME_SIM], legs: [
    { kind: "stay", minutes: 60 }, { kind: "walk", to: { x: 0, y: 900 } }, { kind: "walk", to: HOME_SIM.at },
    { kind: "stay", minutes: homeMinutes, visit: false, driftFixes: false }, { kind: "drive", to: { x: 0, y: 1_800 } },
    { kind: "drive", to: HOME_SIM.at }, { kind: "stay", minutes: 90 }
  ] });
  // Variant where only Home's entry sees the walk return (no fix within 400 m of Home), the phone records
  // nothing at Home, and a capture gap hides the drive's first 400 m (review finding).
  const quietGap = (homeMinutes: number): Scenario => ({ start: "2026-03-09T08:00:00Z", origin: HOME_SIM.at, places: [HOME_SIM], legs: [
    { kind: "stay", minutes: 60 }, { kind: "walk", to: { x: 0, y: 900 } }, { kind: "walk", to: { x: 0, y: 400 } },
    { kind: "walk", to: HOME_SIM.at, recorded: false },
    { kind: "stay", minutes: homeMinutes, visit: false, driftFixes: false, settle: false },
    { kind: "drive", to: { x: 0, y: 400 }, recorded: false }, { kind: "drive", to: { x: 0, y: 2_400 } },
    { kind: "drive", to: HOME_SIM.at }, { kind: "stay", minutes: 90 }
  ] });
  it.each([[2, 90], [3, 90], [2, 420], [4, 420]])("starts the drive at its own departure without fixes at Home or as it leaves (seed %i, %i minutes)", (seed, homeMinutes) => {
    const sim = simulate(quietGap(homeMinutes), seed);
    const departure = sim.truth.stays[1].to;
    const returned = sim.truth.stays[2].from;
    const drives = commutes(sim.input()).filter((trip) => Date.parse(trip.stoppedAt!) > departure);
    expect(drives).toHaveLength(1);
    expect(Math.abs(Date.parse(drives[0].startedAt) - departure)).toBeLessThanOrEqual(2 * 60_000);
    expect(Math.abs(Date.parse(drives[0].stoppedAt!) - returned)).toBeLessThanOrEqual(2 * 60_000);
  });

  it.each([[2, 90], [3, 90], [20, 90], [2, 420]])("starts the drive at its own departure (seed %i, %i minutes at Home)", (seed, homeMinutes) => {
    const sim = simulate(quietHome(homeMinutes), seed);
    const departure = sim.truth.stays[1].to;
    const returned = sim.truth.stays[2].from;
    const drives = commutes(sim.input()).filter((trip) => Date.parse(trip.stoppedAt!) > departure);
    expect(drives).toHaveLength(1);
    expect(Math.abs(Date.parse(drives[0].startedAt) - departure)).toBeLessThanOrEqual(2 * 60_000);
    expect(Math.abs(Date.parse(drives[0].stoppedAt!) - returned)).toBeLessThanOrEqual(2 * 60_000);
  });
});

describe("the capture simulator", () => {
  it("applies the distance filter to displacement, not path length", () => {
    // Twenty laps of a 20 m square never put the device 75 m from where it started.
    const square = [{ x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }];
    const legs: Scenario["legs"] = Array.from({ length: 20 }, () => ({ kind: "walk" as const, to: { x: 0, y: 0 }, via: square.slice(0, 3) }));
    const sim = simulate({ start: "2026-03-09T12:00:00Z", origin: { x: 0, y: 0 }, places: [], legs }, 1);
    expect(sim.input().evidence.filter((item) => item.kind === "standard_location")).toEqual([]);
  });

  it("gives a stay shorter than its settling delay no stationary fix after it ends (review finding)", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const sim = simulate({ start: "2026-03-09T12:00:00Z", origin: { x: 0, y: 0 }, places: [], legs: [
        { kind: "drive", to: { x: 0, y: 600 } }, { kind: "stay", minutes: 0.1, visit: false, driftFixes: false }, { kind: "drive", to: { x: 0, y: 1_200 } }
      ] }, seed);
      const [stay] = sim.truth.stays;
      const still = sim.input().evidence.filter((item) => item.kind === "standard_location" && item.speedMetersPerSecond! < 1);
      expect(still.every((item) => Date.parse(item.occurredAt) <= stay.to)).toBe(true);
    }
  });

  it("can leave out a stay's settling fix, a leg's fixes, or report broad accuracy, and add a stray fix", () => {
    const base: Scenario = { start: "2026-03-09T12:00:00Z", origin: { x: 0, y: 0 }, places: [], legs: [
      { kind: "stay", minutes: 30, visit: false, driftFixes: false, settle: false }, { kind: "drive", to: { x: 0, y: 1_000 }, recorded: false },
      { kind: "drive", to: { x: 0, y: 2_000 }, accuracy: [100, 150] },
      { kind: "stay", minutes: 30, visit: false, driftFixes: false, stray: { afterMinutes: 10, metres: 140 } }
    ] };
    const sim = simulate(base, 3);
    const fixes = sim.input().evidence.filter((item) => item.kind === "standard_location");
    const [first, second] = sim.truth.stays;
    expect(fixes.filter((item) => Date.parse(item.occurredAt) <= first.to)).toEqual([]);
    // Only the broad leg records fixes: the first kilometre (at most 12.65 m/s) is a capture gap.
    const route = fixes.filter((item) => Date.parse(item.occurredAt) > first.to && Date.parse(item.occurredAt) < second.from);
    expect(route.length).toBeGreaterThan(0);
    expect(route.every((item) => item.horizontalAccuracyMeters! >= 100)).toBe(true);
    expect(Date.parse(route[0].occurredAt) - first.to).toBeGreaterThanOrEqual(1_000 / 12.65 * 1_000);
    expect(fixes.filter((item) => item.occurredAt === new Date(second.from + 10 * 60_000).toISOString())).toHaveLength(1);
  });

  it("is deterministic for a seed", () => {
    expect(simulate(outing, 7).input()).toEqual(simulate(outing, 7).input());
  });
});
