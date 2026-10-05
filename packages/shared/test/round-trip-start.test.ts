import { describe, expect, it } from "vitest";
import { assessAutomaticCommuteRoute } from "../src/location/automaticPolicy";
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
 * arrival Visit is dated `visitLeadMinutes` before the last fixes away), with
 * the first accurate still fix at Home `stillAfterMinutes` later. A Visit
 * dated up to about two minutes early is attached at the entry, so the Home
 * stay begins on time; one dated earlier stays contradicted.
 */
function lateReturn(stillAfterMinutes: number, visitLeadMinutes = 2) {
  const evidence: LocationEvidence[] = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
    e("home-2", 20, 0, { speedMetersPerSecond: 0 }), geofence("home-exit", 30.2, "geofence_exit")];
  let minutes = 30.3;
  for (let metres = 200; metres <= 2_000; metres += 75, minutes += 75 / 11 / 60) evidence.push(e(`out-${metres}`, minutes, metres));
  for (let metres = 1_925; metres >= 200; metres -= 75, minutes += 75 / 11 / 60) evidence.push(e(`back-${metres}`, minutes, metres));
  const backAt = minutes;
  evidence.push({ ...homeVisit("early-visit", backAt - visitLeadMinutes), receivedAt: at(backAt + 5) }, geofence("home-enter", backAt + 0.3, "geofence_enter"),
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

  it("does not let a registration snapshot pair make a re-reported exit a departure", () => {
    // An entry and exit within seconds are a snapshot, not a return: the later re-report stays ignored.
    const snapshot = [geofence("snapshot-enter", 31.5, "geofence_enter"), geofence("snapshot-exit", 31.55, "geofence_exit")];
    const reReported = geofence("re-reported-exit", 33.2, "geofence_exit");
    const output = runLocationEngine(roundTrip({ returnVisit: false, extra: [...snapshot, reReported] }));
    const [home] = output.segmentUpserts;
    expect(output.segmentUpserts.filter((segment) => segment.kind === "commute")).toEqual([expect.objectContaining({ startedAt: home.stoppedAt })]);
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

  it("starts the Home stay at the entry and keeps the whole round trip when the return Visit is dated just before the last fixes away", () => {
    const { value, backAt } = lateReturn(30);
    const stays = runLocationEngine(value).segmentUpserts.filter((segment) => segment.kind === "stay");
    expect(stays.at(-1)!.startedAt).toBe(at(backAt + 0.3));
    expect(times(commutes(value))).toEqual([[at(30.2), at(backAt + 0.3), 0]]);
  });

  it("claims no stationary Home time when the Home stay begins half an hour after the return (review finding)", () => {
    const { value, backAt } = lateReturn(30, 5);
    const stays = runLocationEngine(value).segmentUpserts.filter((segment) => segment.kind === "stay");
    // The Home stay does begin late here, so a trip to it would include 30 minutes at Home.
    expect(stays.at(-1)!.startedAt >= at(backAt + 29)).toBe(true);
    expect(commutes(value).filter((trip) => Date.parse(trip.stoppedAt!) > Date.parse(at(backAt + 2)))).toEqual([]);
  });

  it("claims no stationary Home time when a far still outlier and its significant-change mirror follow the return (review finding)", () => {
    // The mirror repeats the same observation at whole-second time; it is not a second fix confirming movement.
    const { value, backAt } = lateReturn(30, 5);
    const stray = e("stray-after-return", backAt + 15, 660, { speedMetersPerSecond: 0 });
    const mirror: LocationEvidence = { ...stray, clientEvidenceId: "stray-mirror", kind: "significant_change", speedMetersPerSecond: null, isSimulated: null,
      occurredAt: new Date(Math.floor(Date.parse(stray.occurredAt) / 1_000) * 1_000).toISOString() };
    expect(commutes({ ...value, evidence: [...value.evidence, stray, mirror] })
      .filter((trip) => Date.parse(trip.stoppedAt!) > Date.parse(at(backAt + 2)))).toEqual([]);
  });

  it("claims no stationary Home time when a stray fix near Home follows the return (review finding)", () => {
    const { value, backAt } = lateReturn(30, 5);
    const evidence = [...value.evidence, e("stray-after-return", backAt + 15, 140, { speedMetersPerSecond: 0 })];
    expect(commutes({ ...value, evidence }).filter((trip) => Date.parse(trip.stoppedAt!) > Date.parse(at(backAt + 2)))).toEqual([]);
  });

  it("keeps a round trip whose route fixes report no accuracy (review finding)", () => {
    const value = roundTrip({ returnVisit: false });
    const evidence = value.evidence.map((item) => /^(out|back)-/.test(item.clientEvidenceId) ? { ...item, horizontalAccuracyMeters: null } : item);
    const trips = commutes({ ...value, evidence });
    expect(trips).toEqual([expect.objectContaining({ qualificationReason: "same_place_meaningful_round_trip" })]);
    // The exit, or the accuracy-less fix still matching Home a few seconds later, as on main.
    expect(trips[0].startedAt <= at(30.3)).toBe(true);
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

  // In seeds 187 and 642 the return Visit is dated before the last fixes away. It is attached at the arrival, so the
  // Home stay begins when the car stops and the outing is one whole round trip (review finding).
  it.each([187, 642])("keeps the whole outing when its return Visit is dated before the last fixes away (seed %i)", (seed) => {
    const sim = simulate(outing, seed);
    const departure = sim.truth.stays[0].to;
    const returned = sim.truth.stays[3].from;
    const stays = runLocationEngine(sim.input()).segmentUpserts.filter((segment) => segment.kind === "stay");
    expect(Math.abs(Date.parse(stays.at(-1)!.startedAt) - returned)).toBeLessThanOrEqual(2 * 60_000);
    const trips = commutes(sim.input()).filter((trip) => Date.parse(trip.stoppedAt!) > departure);
    expect(trips).toHaveLength(1);
    expect(Math.abs(Date.parse(trips[0].startedAt) - departure)).toBeLessThanOrEqual(2 * 60_000);
    expect(Math.abs(Date.parse(trips[0].stoppedAt!) - returned)).toBeLessThanOrEqual(2 * 60_000);
  });
});

describe("a later departure after an earlier excursion (review finding)", () => {
  // A 900 m walk whose return only Home's geofence entry saw, a quiet stretch at Home, then a real drive.
  const walkThenDrive = (driveAt: number, to: "home" | "work" = "home", routeAccuracy: number | null = 4) => {
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      geofence("walk-exit", 20, "geofence_exit"), e("walk-out", 25, 500, { speedMetersPerSecond: 1.35 }),
      e("walk-far", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-back", 35, 400, { speedMetersPerSecond: 1.35 }),
      geofence("walk-enter", 39, "geofence_enter"), geofence("drive-exit", driveAt, "geofence_exit"),
      ...[[0.5, 300], [2, 1_000], [3.5, 1_800]].map(([after, metres], index) =>
        e(`drive-${index}`, driveAt + after, metres, { horizontalAccuracyMeters: routeAccuracy }))];
    if (to === "work") {
      evidence.push(e("work-0", driveAt + 4.2, 2_000, { speedMetersPerSecond: 0 }), e("work-1", driveAt + 14.2, 2_000, { speedMetersPerSecond: 0 }),
        e("work-2", driveAt + 24.2, 2_000, { speedMetersPerSecond: 0 }));
    } else {
      evidence.push(e("drive-3", driveAt + 5, 1_000, { horizontalAccuracyMeters: routeAccuracy }),
        e("drive-4", driveAt + 6.5, 300, { horizontalAccuracyMeters: routeAccuracy }), geofence("drive-enter", driveAt + 7, "geofence_enter"),
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

  it("starts a later drive at its own delayed exit when only a Home Visit saw the walk return (review finding)", () => {
    // The entry callback was missed; the Visit at Home ends the walk's excursion, so the drive's exit is not a re-report.
    const value = walkThenDrive(130);
    value.evidence = value.evidence.filter((item) => item.clientEvidenceId !== "walk-enter").map((item) =>
      item.clientEvidenceId === "drive-exit" ? { ...item, occurredAt: at(130.6), sourceTimestamp: at(130.6) }
        : item.clientEvidenceId === "drive-0" ? { ...item, latitude: north(900) } : item);
    value.evidence.push(homeVisit("walk-return", 39));
    const drives = commutes(value).filter((trip) => trip.stoppedAt! > at(130));
    expect(drives).toEqual([expect.objectContaining({ startedAt: at(130.6), stoppedAt: at(137) })]);
  });

  it("keeps that drive when its route fixes report no accuracy (review finding)", () => {
    // The walk's return comes before the drive's departure, so it cannot veto the drive.
    const drives = commutes(walkThenDrive(130, "home", null)).filter((trip) => trip.stoppedAt! > at(130));
    expect(drives).toEqual([expect.objectContaining({ startedAt: at(130), stoppedAt: at(137) })]);
  });

  // A quiet Home, then an exit fired as the first fix after a capture gap is already far away (geofence times are
  // receipt times), or just after it. A first exit is still the departure (review finding).
  const gapThenExit = (exitAt: number, firstFixAt: number, to: "home" | "work" = "home") => {
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
      geofence("exit", exitAt, "geofence_exit"), e("far-1", firstFixAt, 900), e("far-2", 131, 1_600), e("far-3", 132, 2_100)];
    if (to === "work") {
      evidence.push(e("far-4", 133.5, 2_700), e("work-0", 135, 3_000, { speedMetersPerSecond: 0 }),
        e("work-1", 145, 3_000, { speedMetersPerSecond: 0 }), e("work-2", 155, 3_000, { speedMetersPerSecond: 0 }));
    } else {
      evidence.push(e("back-1", 134, 1_500), e("back-2", 136, 500), geofence("enter", 138, "geofence_enter"),
        e("home-2", 138.5, 0, { speedMetersPerSecond: 0 }), e("home-3", 150, 0, { speedMetersPerSecond: 0 }), e("home-4", 170, 0, { speedMetersPerSecond: 0 }));
    }
    const value = input(evidence, 350);
    if (to === "work") value.savedPlaces.push({ id: "10000000-0000-4000-8000-0000000000f2", name: "Work", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true });
    return value;
  };
  it.each([
    ["coincides with", 130, 130, "home"], ["trails", 130.2, 130, "home"], ["trails, to Work,", 130.2, 130, "work"]
  ] as const)("starts at the exit when it %s the first far fix after a capture gap", (_label, exitAt, firstFixAt, to) => {
    expect(commutes(gapThenExit(exitAt, firstFixAt, to))).toEqual([expect.objectContaining({ startedAt: at(exitAt) })]);
  });

  it.each(["home", "work"] as const)("honours the first genuine exit after an exit Home's own fixes cancelled (to %s, review finding)", (to) => {
    // An exit at minute 5, then still fixes at Home: the device never left, so the later exit is the departure.
    const value = gapThenExit(130.2, 130, to);
    value.evidence.push(geofence("cancelled-exit", 5, "geofence_exit"), e("cancel-inside", 6, 0, { speedMetersPerSecond: 0 }));
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(130.2) })]);
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

describe("presence at Home just before leaving after a quiet spell (review round 7)", () => {
  // Two quiet hours at Home, then the last sign of Home before the drive is a broad fix, a Visit or an entry.
  const quietDeparture = (last: LocationEvidence, shift = 0) => [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }),
    last, ...[[131, 300], [132, 1_000], [133, 2_000], [140, 1_600], [142, 1_000], [144, 300]].map(([minutes, metres], index) => e(`route-${index}`, minutes + shift, metres)),
    geofence("enter", 145 + shift, "geofence_enter"), e("home-3", 145.5 + shift, 0, { speedMetersPerSecond: 0 }),
    e("home-4", 150.5 + shift, 0, { speedMetersPerSecond: 0 }), e("home-5", 155.5 + shift, 0, { speedMetersPerSecond: 0 })];
  it.each([
    ["a broad fix", e("last-home", 130, 0, { horizontalAccuracyMeters: 100, speedMetersPerSecond: 0 })],
    ["a Visit", homeVisit("last-home", 130)],
    ["an entry", geofence("last-home", 130, "geofence_enter")]
  ])("starts the trip at %s there, not two hours earlier", (_label, last) => {
    expect(commutes(input(quietDeparture(last), 300))).toEqual([expect.objectContaining({ startedAt: at(130) })]);
  });

  it("keeps the trip after seven quiet hours instead of stretching it past the six-hour limit", () => {
    const evidence = quietDeparture(e("last-home", 430, 0, { horizontalAccuracyMeters: 100, speedMetersPerSecond: 0 }), 300);
    expect(commutes(input(evidence, 700))).toEqual([expect.objectContaining({ startedAt: at(430) })]);
  });

  it("starts a drive to Work at a Visit at Home just before it", () => {
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }), homeVisit("last-home", 130),
      e("route-0", 131, 300), e("route-1", 132, 1_000), e("route-2", 133, 2_000), e("route-3", 134, 2_700),
      e("work-0", 136, 3_000, { speedMetersPerSecond: 0 }), e("work-1", 146, 3_000, { speedMetersPerSecond: 0 }), e("work-2", 156, 3_000, { speedMetersPerSecond: 0 })];
    const value = input(evidence, 300);
    value.savedPlaces.push({ id: "10000000-0000-4000-8000-0000000000f2", name: "Work", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true });
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(130) })]);
  });

  it("starts a later drive at the Visit that saw the walk home, not at the walk's exit", () => {
    // After the walk, the device stayed home unobserved for an hour and a half before driving off without an exit.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }), geofence("walk-exit", 20, "geofence_exit"),
      e("walk-0", 25, 500, { speedMetersPerSecond: 1.4 }), e("walk-1", 30, 900, { speedMetersPerSecond: 1.4 }), e("walk-2", 35, 400, { speedMetersPerSecond: 1.4 }),
      homeVisit("walk-return", 39), e("drive-0", 130.5, 300), e("drive-1", 132, 1_000), e("drive-2", 133.5, 1_800), e("drive-3", 135, 1_000),
      e("drive-4", 136.5, 300), geofence("drive-enter", 137, "geofence_enter"), e("home-2", 137.5, 0, { speedMetersPerSecond: 0 }),
      e("home-3", 150, 0, { speedMetersPerSecond: 0 }), e("home-4", 170, 0, { speedMetersPerSecond: 0 })];
    const drives = commutes(input(evidence, 400)).filter((trip) => trip.stoppedAt! > at(130));
    expect(drives).toEqual([expect.objectContaining({ startedAt: at(39) })]);
  });

  it.each([true, false])("lets a mirrored fix's movement undo a return whichever copy comes first (mirror first: %s)", (mirrorFirst) => {
    // A brief return, then sparse accurate fixes away amid accuracy-less route readings; the second accurate
    // observation is a fix and its significant-change mirror, with the native speed on only one copy.
    const native = e("away-2-native", 38, 200);
    const mirror: LocationEvidence = { ...native, clientEvidenceId: "away-2-mirror", kind: "significant_change", speedMetersPerSecond: null, isSimulated: null,
      occurredAt: at(mirrorFirst ? 38 - 0.001 / 60 : 38 + 0.001 / 60) };
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }), geofence("old-exit", 20, "geofence_exit"),
      e("old-out-1", 21, 1_000), e("old-out-2", 23, 2_000), e("old-back", 27, 300), geofence("brief-return", 30, "geofence_enter"),
      e("away-1", 31, 200, { speedMetersPerSecond: 0 }),
      ...[[32, 700], [33, 2_000], [34, 3_000], [35, 600], [36, 300]].map(([minutes, metres], index) => e(`route-${index}`, minutes, metres, { horizontalAccuracyMeters: null })),
      e("route-5", 37, 200, { horizontalAccuracyMeters: null, speedMetersPerSecond: 0 }), native, mirror,
      geofence("final-return", 38.2, "geofence_enter"), e("final-0", 38.3, 0, { speedMetersPerSecond: 0 }),
      e("final-1", 48.3, 0, { speedMetersPerSecond: 0 }), e("final-2", 58.3, 0, { speedMetersPerSecond: 0 })];
    expect(commutes(input(evidence, 300)).length).toBeGreaterThan(0);
  });

  it("still loses an outing when a long silence precedes a re-reported exit (known limitation, as on main)", () => {
    // More than thirty minutes unobserved ends the excursion, so a later re-reported exit counts as a departure.
    const evidence = [e("home-0", 0, 0, { speedMetersPerSecond: 0 }), e("home-1", 10, 0, { speedMetersPerSecond: 0 }), geofence("exit", 20, "geofence_exit"),
      e("out-0", 21, 600), e("out-1", 22, 1_500), e("far-quiet", 23, 2_000, { speedMetersPerSecond: 0 }), e("far-again", 70, 2_000, { speedMetersPerSecond: 0 }),
      geofence("re-reported-exit", 70.02, "geofence_exit"), e("back-0", 72, 1_200), e("back-1", 73.5, 300), geofence("enter", 74, "geofence_enter"),
      e("home-2", 74.3, 0, { speedMetersPerSecond: 0 }), e("home-3", 85, 0, { speedMetersPerSecond: 0 }), e("home-4", 95, 0, { speedMetersPerSecond: 0 })];
    const trips = commutes(input(evidence, 300));
    expect(trips.some((trip) => trip.startedAt <= at(21) && trip.stoppedAt! >= at(73))).toBe(false);
  });
});

describe("presence at Home after a stray fix outside or a finished walk (review round 8)", () => {
  const WORK = { id: "10000000-0000-4000-8000-0000000000f2", name: "Work", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true };
  const still = (id: string, minutes: number, metres: number, patch: Partial<LocationEvidence> = {}) =>
    e(id, minutes, metres, { speedMetersPerSecond: 0, ...patch });

  // One still fix 140 m out shortly before the last sign of Home is a stray, not the device leaving.
  it.each([
    ["a broad fix", still("last-home", 130, 0, { horizontalAccuracyMeters: 100 })],
    ["a Visit", homeVisit("last-home", 130)],
    ["an entry", geofence("last-home", 130, "geofence_enter")]
  ])("starts a drive to Work at %s at Home after a stray fix outside", (_label, last) => {
    const value = input([still("home-0", 0, 0), still("home-1", 10, 0), still("stray-before-leaving", 120, 140), last,
      e("route-0", 131, 300), e("route-1", 132, 1_000), e("route-2", 133, 2_000), e("route-3", 134, 2_700),
      still("work-0", 136, 3_000), still("work-1", 146, 3_000), still("work-2", 156, 3_000)], 300);
    value.savedPlaces.push(WORK);
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(130), stoppedAt: at(136) })]);
  });

  it.each(["Home", "Work"] as const)("keeps a drive to %s after seven quiet hours and a stray fix", (destination) => {
    const departure = 430;
    const route = destination === "Home" ? [[1, 300], [2, 1_000], [3, 2_000], [5, 1_600], [7, 1_000], [9, 300]] : [[1, 300], [2, 1_000], [3, 2_000], [4, 2_700]];
    const end = destination === "Home" ? 0 : 3_000;
    const value = input([still("home-0", 0, 0), still("home-1", 10, 0), still("still-outlier", departure - 10, 140),
      still("last-home", departure, 0, { horizontalAccuracyMeters: 100 }),
      ...route.map(([minutes, metres], index) => e(`route-${index}`, departure + minutes, metres)),
      still("end-0", departure + 11, end), still("end-1", departure + 21, end), still("end-2", departure + 31, end)], departure + 200);
    if (destination === "Work") value.savedPlaces.push(WORK);
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(departure), stoppedAt: at(departure + 11) })]);
  });

  it.each([4, null])("starts a drive at the last sign of Home after a finished walk and a quiet spell (route accuracy %s)", (accuracy) => {
    // The walk home is seen by a broad fix and followed by an hour and a half at Home: that excursion is over.
    const value = input([still("home-0", 0, 0), still("home-1", 10, 0), geofence("walk-exit", 20, "geofence_exit"),
      e("walk-0", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-1", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-2", 35, 400, { speedMetersPerSecond: 1.35 }),
      still("walk-return", 39, 0, { horizontalAccuracyMeters: 100 }), still("last-home", 129, 0, { horizontalAccuracyMeters: 100 }),
      ...[[1, 300], [2, 1_000], [3, 2_000], [4.5, 1_600], [6, 1_000], [8, 300]].map(([minutes, metres], index) =>
        e(`drive-${index}`, 129 + minutes, metres, { horizontalAccuracyMeters: accuracy })),
      still("return-0", 139, 0), still("return-1", 149, 0), still("return-2", 159, 0)]);
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(129), stoppedAt: at(139) })]);
  });

  it("keeps a short drive after a stray fix short enough to stay Review-only", () => {
    const value = input([still("home-0", 0, 0), still("home-1", 10, 0), still("still-jitter", 11, 140), still("last-home", 14, 0, { horizontalAccuracyMeters: 100 }),
      e("route-0", 14.5, 300), e("route-1", 15.1, 700), e("route-2", 15.7, 1_100),
      still("work-0", 16.3, 1_500), still("work-1", 26.3, 1_500), still("work-2", 36.3, 1_500)]);
    value.savedPlaces.push({ ...WORK, latitude: north(1_500) });
    const trips = commutes(value);
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(14), stoppedAt: at(16.3) })]);
    expect(assessAutomaticCommuteRoute(trips[0])).toMatchObject({ eligible: false, reason: "short_journey_review_only" });
  });
});

describe("departures after a finished walk (review round 9)", () => {
  const WORK = { id: "10000000-0000-4000-8000-0000000000f2", name: "Work", latitude: north(3_000), longitude: 0, radiusMeters: 100, loggingEnabled: true };
  const still = (id: string, minutes: number, metres: number, patch: Partial<LocationEvidence> = {}) =>
    e(id, minutes, metres, { speedMetersPerSecond: 0, ...patch });
  const visit = (id: string, minutes: number, metres = 0, patch: Partial<LocationEvidence> = {}) =>
    e(id, minutes, metres, { kind: "visit", speedMetersPerSecond: null, horizontalAccuracyMeters: 10, metadata: { visitDepartureOpen: true }, ...patch });
  const withWork = (evidence: LocationEvidence[], work: boolean, homeRadius = 100) => {
    const value = input(evidence, 1_000);
    value.savedPlaces = [{ ...value.savedPlaces[0], radiusMeters: homeRadius }, ...(work ? [WORK] : [])];
    return value;
  };
  const walk = (farthest = 900) => [still("home-0", 0, 0), still("home-1", 10, 0), geofence("walk-exit", 20, "geofence_exit"),
    e("walk-0", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-1", 30, farthest, { speedMetersPerSecond: 1.35 }), e("walk-2", 35, 400, { speedMetersPerSecond: 1.35 })];
  const drive = (departure: number, work: boolean, accuracy: number | null = 4) => {
    const route = work ? [[0.5, 300], [2, 1_000], [3.5, 1_800], [5, 2_700]] : [[0.5, 300], [2, 1_000], [3.5, 1_800], [5, 1_000], [6.5, 300]];
    const end = work ? 3_000 : 0;
    return [...route.map(([minutes, metres], index) => e(`drive-${index}`, departure + minutes, metres, { horizontalAccuracyMeters: accuracy })),
      ...(work ? [] : [geofence("end-enter", departure + 7, "geofence_enter")]),
      still("end-0", departure + 7.5, end), still("end-1", departure + 17.5, end), still("end-2", departure + 27.5, end)];
  };

  it.each([false, true])("ends the walk's excursion after a long stay seen only by broad fixes (to Work: %s)", (work) => {
    // An exit fired with the drive just after a far fix is a new excursion's first exit, not a re-report.
    const evidence = [...walk(), still("walk-return", 39, 0, { horizontalAccuracyMeters: 100 }),
      ...[59, 79, 99, 119].map((minutes) => still(`home-broad-${minutes}`, minutes, 0, { horizontalAccuracyMeters: 100 })),
      geofence("drive-exit", 130.6, "geofence_exit"), ...drive(130, work)];
    evidence.find((item) => item.clientEvidenceId === "drive-0")!.latitude = north(900);
    expect(commutes(withWork(evidence, work))).toEqual([expect.objectContaining({ startedAt: at(130.6) })]);
  });

  it.each([100, 50])("does not treat the displaced completion of Home's own Visit as leaving (Home radius %i m)", (radius) => {
    const base = [...walk(), visit("arrival", 39), still("last-home", 130, 0, { horizontalAccuracyMeters: 100 }),
      e("drive-0", 131, 300), e("drive-1", 132, 1_000), e("drive-2", 133, 2_000), e("drive-3", 134, 2_700),
      still("work-0", 136, 3_000), still("work-1", 146, 3_000), still("work-2", 156, 3_000)];
    const completion = visit("completion", 39, radius === 100 ? 220 : 140, { horizontalAccuracyMeters: 70, endedAt: at(129), receivedAt: at(130), metadata: {} });
    const clean = commutes(withWork(base, true, radius));
    expect(clean).toEqual([expect.objectContaining({ startedAt: at(130), stoppedAt: at(136) })]);
    expect(commutes(withWork([...base, completion], true, radius))).toEqual(clean);
    // Whichever callback sorts first at the shared arrival time.
    const renamed = { ...completion, clientEvidenceId: "a-completion" };
    expect(commutes(withWork([...base, renamed], true, radius)).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]))
      .toEqual(clean.map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]));
  });

  it.each(["a mirrored accurate fix", "a Visit on the way"])("keeps a later round trip after the walk's return with %s and accuracy-less route fixes", (extra) => {
    const route = [[40, 300], [41, 1_000], [42, 1_800], [44, 1_000], [46, 300]].map(([minutes, metres], index) =>
      e(`drive-${index}`, minutes, metres, { horizontalAccuracyMeters: index === 0 ? 4 : null }));
    const second: LocationEvidence = extra === "a mirrored accurate fix"
      ? { ...route[0], clientEvidenceId: "drive-mirror", kind: "significant_change", speedMetersPerSecond: null, isSimulated: null }
      : visit("route-visit", 40.3, 500, { endedAt: at(40.5), metadata: {} });
    const evidence = [...walk(), geofence("walk-enter", 39, "geofence_enter"), ...route, second,
      geofence("end-enter", 47, "geofence_enter"), still("end-0", 47.5, 0), still("end-1", 57.5, 0), still("end-2", 67.5, 0)];
    expect(commutes(withWork(evidence, false))).toEqual([expect.objectContaining({ startedAt: at(39), stoppedAt: at(47) })]);
  });

  it.each([
    ["a broad fix", still("last-home", 39, 0, { horizontalAccuracyMeters: 100 })],
    ["a Visit", visit("last-home", 39)],
    ["an entry", geofence("last-home", 39, "geofence_enter")]
  ])("keeps the departure at %s after a slow walk under 650 m", (_label, presence) => {
    expect(commutes(withWork([...walk(600), presence, ...drive(39.5, true)], true)))
      .toEqual([expect.objectContaining({ startedAt: at(39), stoppedAt: at(47) })]);
  });

  // Review round 10: ten minutes back home after the walk is a stay of its own, so the drive starts at its last sign.
  it.each([[false, 4], [true, 4], [false, null], [true, null]] as const)("starts the next drive at Home after a short stay there (to Work: %s, route accuracy %s)", (work, accuracy) => {
    const evidence = [...walk(), still("walk-return", 39, 0, { horizontalAccuracyMeters: 100 }), still("last-home", 49, 0, { horizontalAccuracyMeters: 100 }),
      ...drive(49.5, work, accuracy)];
    expect(commutes(withWork(evidence, work))).toEqual([expect.objectContaining({ startedAt: at(49) })]);
  });

  it("never leaves a leg overlapping a trip through a stop whose start moved to an observed return", () => {
    const evidence = [...walk(), geofence("walk-return", 39, "geofence_enter"), still("last-home", 49, 0, { horizontalAccuracyMeters: 100 }),
      e("out-a", 49.1, 200, { horizontalAccuracyMeters: null }), still("out-accurate", 49.2, 400), still("out-accurate-2", 49.3, 500),
      e("out-b", 49.5, 750, { horizontalAccuracyMeters: null }), e("out-c", 49.8, 1_000, { horizontalAccuracyMeters: null }),
      visit("stop-visit", 50, 1_000, { endedAt: at(60), metadata: {} }),
      e("back-a", 60.2, 900, { horizontalAccuracyMeters: null }), e("back-b", 60.5, 600, { horizontalAccuracyMeters: null }),
      still("back-accurate", 60.7, 400), e("back-c", 60.9, 200, { horizontalAccuracyMeters: null }),
      geofence("last-return", 61.2, "geofence_enter"), still("final-a", 61.5, 0), still("final-b", 71.5, 0), still("final-c", 81.5, 0)];
    const trips = commutes(withWork(evidence, false)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(trips.length).toBeGreaterThan(0);
    for (let index = 1; index < trips.length; index += 1) {
      expect(Date.parse(trips[index].startedAt)).toBeGreaterThanOrEqual(Date.parse(trips[index - 1].stoppedAt!));
    }
  });

  // Review round 11: presence at Home followed by moving away is a departure even when the walk's return went unrecorded.
  it.each([false, true])("starts the drive at the last broad Home fix after a walk whose return went unrecorded (to Work: %s)", (work) => {
    expect(commutes(withWork([...walk(), still("last-home", 49, 0, { horizontalAccuracyMeters: 100 }), ...drive(49.5, work)], work)))
      .toEqual([expect.objectContaining({ startedAt: at(49) })]);
  });

  it("keeps a short drive after an entry-only return Review-only", () => {
    const value = withWork([still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("walk-exit", 20, "geofence_exit"),
      e("walk-0", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-1", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-2", 35, 400, { speedMetersPerSecond: 1.35 }),
      geofence("brief-return", 39, "geofence_enter"), e("drive-0", 39.5, 300), e("drive-1", 40.1, 700), e("drive-2", 40.7, 1_100),
      still("work-0", 41.3, 1_500), still("work-1", 51.3, 1_500), still("work-2", 61.3, 1_500)], true);
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: north(1_500) };
    const trips = commutes(value);
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(39) })]);
    expect(assessAutomaticCommuteRoute(trips[0])).toMatchObject({ eligible: false, reason: "short_journey_review_only" });
  });

  it("starts the drive at the last broad Home fix when Home is a learned place", () => {
    const value = withWork([...walk(), still("last-home", 49, 0, { horizontalAccuracyMeters: 100 }), ...drive(49.5, true)], true);
    const home = value.savedPlaces.shift()!;
    value.acceptedLearnedPlaces = [{ ...home, accepted: true }];
    value.evidence = value.evidence.filter((item) => !item.kind.startsWith("geofence_"));
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(49) })]);
  });

  it("keeps a trip through a stop after the walk's return whole, with consistent leg and trip starts", () => {
    const evidence = [...walk(), geofence("walk-return", 39, "geofence_enter"),
      e("out-a", 39.6, 200, { horizontalAccuracyMeters: null }), still("out-accurate", 39.7, 400), still("out-accurate-2", 39.8, 500),
      e("out-b", 40, 750, { horizontalAccuracyMeters: null }), e("out-c", 40.3, 1_000, { horizontalAccuracyMeters: null }),
      e("stop-visit", 40.5, 1_000, { kind: "visit", horizontalAccuracyMeters: 10, speedMetersPerSecond: null, endedAt: at(50.5), metadata: {} }),
      e("back-a", 51, 900, { horizontalAccuracyMeters: null }), e("back-b", 51.2, 600, { horizontalAccuracyMeters: null }),
      still("back-accurate", 51.4, 400), e("back-c", 51.6, 200, { horizontalAccuracyMeters: null }),
      geofence("last-return", 52, "geofence_enter"), still("final-a", 52.5, 0), still("final-b", 62.5, 0), still("final-c", 72.5, 0)];
    expect(commutes(withWork(evidence, false))).toEqual([expect.objectContaining({ startedAt: at(39), stoppedAt: at(52), stops: [expect.anything()] })]);
  });

  // Review round 12: a mirror of the last approach fix or a broad reading must not hide the approach.
  it.each([
    ["an entry", "a mirror"], ["an entry", "a broad reading"], ["a Visit", "a mirror"], ["a Visit", "a broad reading"],
    ["a broad fix", "a mirror"], ["a broad fix", "a broad reading"]
  ])("starts a short drive at %s after an approach despite %s", (presenceKind, noise) => {
    const approach = [still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("walk-exit", 20, "geofence_exit"),
      e("walk-0", 25, 700, { speedMetersPerSecond: 1.35 }), e("walk-1", 30, 1_000, { speedMetersPerSecond: 1.35 }), e("walk-2", 38, 200, { speedMetersPerSecond: 2.5 })];
    const extra: LocationEvidence = noise === "a mirror"
      ? { ...approach.at(-1)!, clientEvidenceId: "walk-mirror", kind: "significant_change", speedMetersPerSecond: null, isSimulated: null }
      : e("broad-approach", 38.2, 250, { horizontalAccuracyMeters: 200, speedMetersPerSecond: 1.35 });
    const presence = presenceKind === "an entry" ? geofence("return", 39, "geofence_enter")
      : presenceKind === "a Visit" ? visit("return", 39) : still("return", 39, 0, { horizontalAccuracyMeters: 100 });
    const value = withWork([...approach, presence, extra, e("drive-0", 39.8, 300), e("drive-1", 40.4, 700), e("drive-2", 41, 1_100),
      still("work-0", 41.6, 1_500), still("work-1", 51.6, 1_500), still("work-2", 61.6, 1_500)], true);
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: north(1_500) };
    const trips = commutes(value);
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(39) })]);
    expect(assessAutomaticCommuteRoute(trips[0])).toMatchObject({ eligible: false, reason: "short_journey_review_only" });
  });

  // Review round 12: provider status and registration snapshots are not observations of where the device was.
  it.each([false, true])("keeps a delayed exit after callback chatter through the quiet spell (six hours later: %s)", (late) => {
    const shift = late ? 320 : 0;
    const noPoint = (id: string, minutes: number, kind: LocationEvidence["kind"]) =>
      e(id, minutes, 0, { kind, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
    const base = [still("home-0", 0, 0), still("home-1", 10, 0), geofence("old-exit", 20, "geofence_exit"),
      e("walk-out", 25, 700, { speedMetersPerSecond: 1.35 }), e("walk-peak", 30, 1_000, { speedMetersPerSecond: 1.35 }), e("walk-back", 35, 400, { speedMetersPerSecond: 1.35 }),
      e("drive-0", 130.5 + shift, 900), geofence("drive-exit", 130.6 + shift, "geofence_exit"), e("drive-1", 132 + shift, 1_800), e("drive-2", 134 + shift, 2_600),
      still("work-0", 136 + shift, 3_000), still("work-1", 146 + shift, 3_000), still("work-2", 156 + shift, 3_000)];
    const times = Array.from({ length: late ? 27 : 6 }, (_, index) => 45 + index * 15);
    const providers = times.map((minutes) => noPoint(`provider-${minutes}`, minutes, "provider_status"));
    const pairs = times.flatMap((minutes) => [geofence(`snapshot-enter-${minutes}`, minutes, "geofence_enter"), geofence(`snapshot-exit-${minutes}`, minutes + 0.02, "geofence_exit")]);
    for (const chatter of [[], providers, pairs]) {
      const value = withWork([...base, ...chatter], true);
      value.processingAt = at(450 + shift);
      expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(130.6 + shift) })]);
    }
  });

  // Review round 13: Home presence followed by a drive whose outbound leg went uncaptured is a departure.
  const brief = (work: boolean, kind: "entry" | "visit" | "broad") => withWork([still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0),
    geofence("walk-exit", 20, "geofence_exit"), e("walk-a", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-b", 30, 900, { speedMetersPerSecond: 1.35 }),
    e("walk-c", 35, 800, { speedMetersPerSecond: 1.35 }),
    kind === "entry" ? geofence("home-return", 39, "geofence_enter") : kind === "visit" ? visit("home-return", 39) : still("home-return", 39, 0, { horizontalAccuracyMeters: 100 }),
    ...(work ? [e("drive-a", 41, 1_600), e("drive-b", 42, 2_100), e("drive-c", 43, 2_600), still("work-0", 44, 3_000), still("work-1", 54, 3_000), still("work-2", 64, 3_000)]
      : [e("drive-a", 42, 1_800), e("drive-b", 43, 1_500), e("drive-c", 44, 700), e("drive-d", 45, 300), geofence("drive-return", 46, "geofence_enter"),
        still("home-3", 46.5, 0), still("home-4", 56.5, 0), still("home-5", 66.5, 0)])], work);

  it.each(["entry", "visit", "broad"] as const)("starts a round trip at Home presence before a drive with no outbound capture (%s)", (kind) => {
    expect(commutes(brief(false, kind))).toEqual([expect.objectContaining({ startedAt: at(39) })]);
  });

  it.each(["visit", "broad"] as const)("starts it there when Home is a learned place too (%s)", (kind) => {
    const value = brief(false, kind);
    const home = value.savedPlaces.shift()!;
    value.acceptedLearnedPlaces = [{ ...home, accepted: true }];
    value.evidence = value.evidence.filter((item) => !item.kind.startsWith("geofence_"));
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(39) })]);
  });

  it("keeps a two-minute drive with no outbound capture Review-only", () => {
    const value = withWork([still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("walk-exit", 20, "geofence_exit"),
      e("walk-a", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-b", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-c", 35, 800, { speedMetersPerSecond: 1.35 }),
      geofence("home-return", 39, "geofence_enter"), e("drive-a", 40.4, 1_900), e("drive-b", 40.55, 1_810), e("drive-c", 40.7, 1_730),
      still("work-0", 41, 1_500), still("work-1", 51, 1_500), still("work-2", 61, 1_500)], true);
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: north(1_500) };
    const trips = commutes(value);
    expect(trips).toEqual([expect.objectContaining({ startedAt: at(39) })]);
    expect(assessAutomaticCommuteRoute(trips[0])).toMatchObject({ eligible: false, reason: "short_journey_review_only" });
  });

  it("keeps such a drive when the walk began over six hours earlier", () => {
    const value = brief(false, "entry");
    value.processingAt = at(1_000);
    value.evidence = value.evidence.map((item) => {
      const minutes = (Date.parse(item.occurredAt) - Date.parse(at(0))) / 60_000;
      const shifted = minutes >= 35 ? minutes + 400 : minutes;
      return { ...item, occurredAt: at(shifted), sourceTimestamp: at(shifted), receivedAt: at(shifted + 1) };
    });
    expect(commutes(value)).toEqual([expect.objectContaining({ startedAt: at(439) })]);
  });

  // Review round 14: speedless route fixes still show leaving, and a short loop from home starts at home.
  const walkThere = () => [still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("walk-exit", 20, "geofence_exit"),
    e("walk-a", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-b", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-c", 35, 800, { speedMetersPerSecond: 1.35 })];
  const later = (value: LocationEngineInput, fromMinute: number, by: number) => ({ ...value, evidence: value.evidence.map((item) => {
    const minutes = (Date.parse(item.occurredAt) - Date.parse(at(0))) / 60_000;
    return minutes >= fromMinute ? { ...item, occurredAt: at(minutes + by), sourceTimestamp: at(minutes + by), receivedAt: at(minutes + by + 1) } : item;
  }) });
  const learnedHome = (value: LocationEngineInput) => {
    const home = value.savedPlaces[0];
    return { ...value, savedPlaces: value.savedPlaces.slice(1), acceptedLearnedPlaces: [{ ...home, accepted: true as const }],
      evidence: value.evidence.filter((item) => !item.kind.startsWith("geofence_")) };
  };
  const speedless = (kind: "standard_location" | "significant_change" = "standard_location") => {
    const route = (id: string, minutes: number, northMetres: number, eastMetres: number) =>
      e(id, minutes, northMetres, { longitude: north(eastMetres), speedMetersPerSecond: null, kind, ...(kind === "significant_change" ? { isSimulated: null } : {}) });
    const value = withWork([...walkThere(), still("last-home", 49, 0, { horizontalAccuracyMeters: 100 }),
      route("route-a", 49.2, 0, 200), route("route-b", 49.7, 0, 600), route("route-c", 50.2, 300, 500), route("route-d", 50.7, 550, 200),
      still("work-0", 52.5, 600), still("work-1", 62.5, 600), still("work-2", 72.5, 600)], true);
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: north(600) };
    return value;
  };
  const loop = (kind: "entry" | "visit" | "broad", minutes: number) => withWork([...walkThere(),
    kind === "entry" ? geofence("home-return", 39, "geofence_enter") : kind === "visit" ? visit("home-return", 39) : still("home-return", 39, 0, { horizontalAccuracyMeters: 100 }),
    ...[[0.15, 200], [0.55, 800], [1.1, 1_800], [1.7, 1_200], [2.4, 300]].map(([offset, metres], index) => e(`loop-${index}`, 39 + offset * minutes / 2.8, metres)),
    geofence("loop-end", 39 + minutes, "geofence_enter"), still("final-0", 39.5 + minutes, 0), still("final-1", 49.5 + minutes, 0), still("final-2", 59.5 + minutes, 0)], false);
  const bounds = (value: LocationEngineInput) => commutes(value).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]);

  it.each([
    ["saved Home, standard fixes", () => speedless()], ["learned Home, standard fixes", () => learnedHome(speedless())],
    ["saved Home, significant changes", () => speedless("significant_change")], ["learned Home, significant changes", () => learnedHome(speedless("significant_change"))]
  ])("starts a drive with speedless route fixes at the last sign of Home (%s)", (_label, build) => {
    expect(bounds(build())).toEqual([[at(49), at(52.5)]]);
  });

  it.each([false, true])("keeps such a drive to a nearby endpoint seven hours after the walk (learned Home: %s)", (learned) => {
    let value = speedless();
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: 0, longitude: north(1_000) };
    value.evidence = value.evidence.map((item) => item.clientEvidenceId.startsWith("work-") ? { ...item, latitude: 0, longitude: north(1_000) } : item);
    value = later(value, 35, 400);
    if (learned) value = learnedHome(value);
    expect(bounds(value)).toEqual([[at(449), at(452.5)]]);
  });

  it.each(["entry", "broad"] as const)("starts a three-minute loop at Home presence, also seven hours later (%s)", (kind) => {
    expect(bounds(loop(kind, 3))).toEqual([[at(39), at(42)]]);
    expect(bounds(later(loop(kind, 3), 35, 400))).toEqual([[at(439), at(442)]]);
  });

  it.each(["entry", "broad"] as const)("claims no commute for a loop under three minutes after Home presence (%s)", (kind) => {
    expect(bounds(loop(kind, 2.8))).toEqual([]);
  });

  // With #225: iOS reports no Visit for seconds at Home, so a Visit followed at once by a loop back within three
  // minutes is that loop's early-dated arrival, attached at its end; nothing shows the walk ended at Home, so the
  // walk and the loop are one excursion.
  it.each([3, 2.8])("treats a Visit followed at once by a %s-minute loop as the loop's early-dated arrival", (minutes) => {
    expect(bounds(loop("visit", minutes))).toEqual([[at(20), at(39 + minutes)]]);
  });

  // Review round 15: a loop whose outbound leg went uncaptured, and state snapshots, after a walk that approached Home.
  const approachedHome = () => [still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("walk-exit", 20, "geofence_exit"),
    e("walk-a", 25, 500, { speedMetersPerSecond: 1.35 }), e("walk-b", 30, 900, { speedMetersPerSecond: 1.35 }), e("walk-c", 38.5, 300, { speedMetersPerSecond: 1.35 })];
  const presenceAt = (kind: "entry" | "visit" | "broad", minutes: number) => kind === "entry" ? geofence("home-return", minutes, "geofence_enter")
    : kind === "visit" ? visit("home-return", minutes) : still("home-return", minutes, 0, { horizontalAccuracyMeters: 100 });
  const inboundLoop = (kind: "entry" | "visit" | "broad", minutes: number, learned = false) => {
    const value = withWork([...approachedHome(), presenceAt(kind, 39),
      ...[[1.5, 1_000], [1.75, 800], [2, 650], [2.3, 450], [2.6, 200]].map(([after, metres], index) => e(`in-${index}`, 39 + after, metres, { speedMetersPerSecond: 12 })),
      learned ? visit("end-visit", 39 + minutes) : geofence("loop-return", 39 + minutes, "geofence_enter"),
      still("final-0", 39.5 + minutes, 0), still("final-1", 49.5 + minutes, 0), still("final-2", 59.5 + minutes, 0)], false);
    return learned ? learnedHome(value) : value;
  };

  it.each([
    ["entry", 3], ["entry", 2.8], ["broad", 3], ["broad", 2.8]
  ] as const)("starts an inbound-only loop at Home presence, never at the earlier walk (%s, %s minutes)", (kind, minutes) => {
    expect(bounds(inboundLoop(kind, minutes))).toEqual(minutes < 3 ? [] : [[at(39), at(42)]]);
  });

  // With #225, as for the loop above: a Visit followed at once by an approach and an entry within three minutes is
  // that return's early-dated arrival, so nothing shows the walk ended at Home and the walk and the loop are one excursion.
  it.each([3, 2.8])("treats a Visit followed at once by an inbound-only %s-minute loop as its early-dated arrival", (minutes) => {
    expect(bounds(inboundLoop("visit", minutes))).toEqual([[at(20), at(39 + minutes)]]);
  });

  it.each([3, 2.8])("starts it there when Home is a learned place too (%s minutes)", (minutes) => {
    expect(bounds(inboundLoop("broad", minutes, true))).toEqual(minutes < 3 ? [] : [[at(39), at(42)]]);
  });

  it.each([[0, false], [0, true], [400, false], [400, true]] as const)("ignores a state snapshot after the last sign of Home (+%s min, to Work: %s)", (shift, work) => {
    const state = e("state", 49.1 + shift, 0, { kind: "geofence_state", savedPlaceId: HOME_ID, latitude: null, longitude: null,
      horizontalAccuracyMeters: null, speedMetersPerSecond: null, metadata: { geofenceState: "inside" } });
    const evidence = [...approachedHome(), presenceAt("broad", 49 + shift), state,
      ...[[49.3, 200], [49.8, 550], [50.5, 1_000], [51.5, 1_700]].map(([minutes, metres], index) => e(`route-${index}`, minutes + shift, metres)),
      ...(work ? [e("route-last", 53 + shift, 2_700), still("final-0", 54 + shift, 3_000), still("final-1", 64 + shift, 3_000), still("final-2", 74 + shift, 3_000)]
        : [e("back-a", 53 + shift, 1_300), e("back-b", 54 + shift, 700), e("back-c", 55 + shift, 300), geofence("return", 56 + shift, "geofence_enter"),
          still("final-0", 56.5 + shift, 0), still("final-1", 66.5 + shift, 0), still("final-2", 76.5 + shift, 0)])];
    const trips = commutes(withWork(evidence, work));
    expect(trips).toHaveLength(1);
    expect(Math.abs(Date.parse(trips[0].startedAt) - Date.parse(at(49 + shift)))).toBeLessThanOrEqual(10_000);
  });

  it.each([false, true])("does not take a moving broad fix that matches Home on the way back as the departure (learned Home: %s)", (learned) => {
    // A coarse reading placed at Home while the car is still about a kilometre out; the accurate approach continues after it.
    const value = withWork([still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0), geofence("exit", 20, "geofence_exit"),
      ...[[20.5, 300], [22, 1_000], [23.5, 1_800], [25, 2_500], [28, 1_800], [29.5, 1_000]].map(([minutes, metres], index) => e(`drive-${index}`, minutes, metres)),
      e("coarse", 30, 0, { horizontalAccuracyMeters: 100 }),
      ...[[30.5, 650], [31, 400], [31.5, 200]].map(([minutes, metres], index) => e(`approach-${index}`, minutes, metres)),
      geofence("return", 32, "geofence_enter"), still("home-3", 32.5, 0), still("home-4", 42.5, 0), still("home-5", 52.5, 0)], false);
    const [trip, ...rest] = bounds(learned ? learnedHome(value) : value);
    expect(rest).toEqual([]);
    expect(trip).toEqual([expect.any(String), at(learned ? 32.5 : 32)]);
    expect(Date.parse(trip[0])).toBeLessThanOrEqual(Date.parse(at(20)));
  });

  // Review round 16: a coarse, speedless route after a walk; a mirror that lands before its copy; an early-dated return
  // Visit followed by a re-reported exit.
  const coarseRoute = (kind: "entry" | "visit" | "broad", silence = 0, learned = false) => {
    const route = (id: string, minutes: number, northMetres: number, eastMetres: number) =>
      e(id, minutes + silence, northMetres, { longitude: north(eastMetres), speedMetersPerSecond: null, horizontalAccuracyMeters: 100 });
    const value = withWork([...walkThere(), presenceAt(kind, 49),
      route("route-a", 49.2, 0, 200), route("route-b", 49.7, 0, 600), route("route-c", 50.2, 300, 500), route("route-d", 50.7, 550, 200),
      still("work-0", 52.5 + silence, 600), still("work-1", 62.5 + silence, 600), still("work-2", 72.5 + silence, 600)], true);
    value.savedPlaces[1] = { ...value.savedPlaces[1], latitude: north(600) };
    return learned ? learnedHome(value) : value;
  };
  const mirroredStray = (offsetSeconds: number | null) => {
    const stray = still("stray", 20.6, 140);
    const evidence = [still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 20, 0), stray,
      ...(offsetSeconds == null ? [] : [{ ...stray, clientEvidenceId: "stray-mirror", kind: "significant_change" as const, speedMetersPerSecond: null,
        isSimulated: null, occurredAt: new Date(Date.parse(stray.occurredAt) + offsetSeconds * 1_000).toISOString(),
        sourceTimestamp: new Date(Date.parse(stray.occurredAt) + offsetSeconds * 1_000).toISOString() }]),
      visit("home-visit", 21.1),
      ...[[21.25, 300], [21.6, 900], [22.2, 1_800], [22.9, 1_000], [23.5, 300]].map(([minutes, metres], index) => e(`loop-${index}`, minutes, metres)),
      geofence("loop-end", 23.9, "geofence_enter"), still("final-0", 24.4, 0), still("final-1", 34.4, 0), still("final-2", 44.4, 0)];
    return withWork(evidence, false);
  };
  const bothCallbacks = (visitEarly: boolean, reReport: boolean) => withWork([still("home-0", 0, 0), still("home-1", 10, 0), still("home-2", 18, 0),
    geofence("exit", 20, "geofence_exit"),
    ...[[20.5, 300], [22, 1_000], [23.5, 1_800], [25, 2_500], [27, 1_900], [28.5, 1_300]].map(([minutes, metres], index) => e(`drive-${index}`, minutes, metres)),
    ...(visitEarly ? [{ ...visit("early-visit", 29), receivedAt: at(33) }] : []),
    ...(reReport ? [e("far-fix", 29.4, 900), geofence("re-exit", 29.5, "geofence_exit")] : [e("far-fix", 29.4, 900)]),
    ...[[30.5, 600], [31, 350], [31.5, 200]].map(([minutes, metres], index) => e(`approach-${index}`, minutes, metres)),
    geofence("return", 32, "geofence_enter"), still("home-3", 32.5, 0), still("home-4", 42.5, 0), still("home-5", 52.5, 0)], false);

  it.each([
    ["entry", 0], ["visit", 0], ["broad", 0], ["entry", 40], ["visit", 40], ["broad", 40]
  ] as const)("starts a drive to a nearby place with a coarse, speedless route at Home presence (%s, %s minutes quiet first)", (kind, silence) => {
    // Arriving at a different place shows the device had left even when no reading on the way does. After a quiet
    // spell the start stays at that last sign of Home, as on main.
    expect(bounds(coarseRoute(kind, silence))).toEqual([[at(49), at(52.5 + silence)]]);
  });

  it.each([
    ["visit", 0], ["broad", 0], ["visit", 40], ["broad", 40]
  ] as const)("starts it there when Home is a learned place too (%s, %s minutes quiet first)", (kind, silence) => {
    expect(bounds(coarseRoute(kind, silence, true))).toEqual([[at(49), at(52.5 + silence)]]);
  });

  // With #225, as for the loops above: the Home Visit followed at once by a 168-second loop back is that loop's
  // early-dated arrival, so the loop joins the silence before it. A mirror either side of the stray's still copy changes
  // nothing but the silence's midpoint, by half its offset.
  it.each([-5, -4, -2, -1, 1, 2, 5])("does not let a speedless mirror %i s from a still fix's copy fake movement", (offset) => {
    const [base, ...others] = commutes(mirroredStray(null));
    expect(others).toEqual([]);
    expect(base.stoppedAt).toBe(at(23.9));
    const trips = commutes(mirroredStray(offset));
    expect(trips).toHaveLength(1);
    expect(trips[0].stoppedAt).toBe(base.stoppedAt);
    expect(Math.abs(Date.parse(trips[0].startedAt) - Date.parse(base.startedAt))).toBeLessThanOrEqual(2_500);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "keeps the whole outing with an early-dated return Visit (%s) and a re-reported exit after it (%s)", (visitEarly, reReport) => {
      expect(bounds(bothCallbacks(visitEarly, reReport))).toEqual([[at(20), at(32)]]);
    });

  // Review round 17. The return guard takes native speed from any copy of an observation, even one too coarse to count.
  it.each([-4, -1, 0, 1, 4])("keeps native stillness from a copy too coarse to count, with an accurate mirror %i s away", (offset) => {
    const evidence = [still("home-0", 0, 0), still("home-1", 10, 0), geofence("exit", 20, "geofence_exit"), e("out-0", 21, 500), e("out-1", 22, 1_000),
      e("out-2", 23, 2_000), e("back-0", 25, 1_000), e("back-1", 26, 600), geofence("return-entry", 27, "geofence_enter")];
    for (const [id, minutes, metres] of [["stray-a", 29, 200], ["stray-b", 31, 210]] as const) {
      const native = still(id, minutes, metres, { horizontalAccuracyMeters: config.highQualityHorizontalAccuracyMeters + 0.1 });
      const mirrorAt = new Date(Date.parse(native.occurredAt) + offset * 1_000).toISOString();
      evidence.push(native, { ...native, clientEvidenceId: `${id}-mirror`, kind: "significant_change", speedMetersPerSecond: null, isSimulated: null,
        horizontalAccuracyMeters: config.highQualityHorizontalAccuracyMeters - 0.1, occurredAt: mirrorAt, sourceTimestamp: mirrorAt });
    }
    evidence.push(still("home-2", 57, 0), still("home-3", 67, 0), still("home-4", 77, 0));
    expect(commutes(withWork(evidence, false))).toEqual([]);
  });

  // Known limitation, kept by owner decision after review round 17 (5 Oct): a Home Visit followed by a loop that never
  // gets farther from Home than the walk's last reading, back exactly three minutes later, reads as the walk's own
  // early-dated arrival, so the loop joins the walk. Main starts it at the Visit.
  it("joins a constant-distance three-minute loop straight after a walk to that walk (known limitation)", () => {
    const value = withWork([...walkThere(), visit("home-return", 45),
      e("loop-n", 45.4, 700, { speedMetersPerSecond: 30 }), e("loop-e", 46.05, 0, { longitude: north(700), speedMetersPerSecond: 30 }),
      e("loop-s", 46.7, -700, { speedMetersPerSecond: 30 }), e("loop-w", 47.35, 0, { longitude: north(-700), speedMetersPerSecond: 30 }),
      geofence("loop-end", 48, "geofence_enter"), still("final-0", 48.5, 0), still("final-1", 58.5, 0), still("final-2", 68.5, 0)], false);
    expect(bounds(value)).toEqual([[at(20), at(48)]]);
  });

  it("does not let speedless mirrors turn two still stray fixes into renewed movement", () => {
    // Each stray's significant-change mirror sorts first at the same time and carries the implied speed from the route.
    const evidence = [still("home-0", 0, 0), still("home-1", 10, 0), geofence("exit", 20, "geofence_exit"), e("out-0", 21, 500), e("out-1", 22, 1_000),
      e("out-2", 23, 2_000), e("back-0", 25, 1_000), e("back-1", 26, 600), geofence("return-entry", 27, "geofence_enter"),
      still("stray-a", 29, 140), still("stray-b", 31, 150), still("home-2", 57, 0), still("home-3", 67, 0), still("home-4", 77, 0)];
    const mirrors: LocationEvidence[] = evidence.filter((item) => item.clientEvidenceId.startsWith("stray-"))
      .map((item) => ({ ...item, clientEvidenceId: `${item.clientEvidenceId}-mirror`, kind: "significant_change", speedMetersPerSecond: null, isSimulated: null }));
    expect(commutes(withWork(evidence, false))).toEqual([]);
    expect(commutes(withWork([...evidence, ...mirrors], false))).toEqual([]);
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

  it("records a silence as stationary truth without changing the stay legs' indices", () => {
    const sim = simulate({ start: "2026-03-09T12:00:00Z", origin: { x: 0, y: 0 }, places: [], legs: [
      { kind: "stay", minutes: 10 }, { kind: "silence", minutes: 60 }, { kind: "drive", to: { x: 0, y: 1_000 } }, { kind: "stay", minutes: 10 }
    ] }, 1);
    expect(sim.truth.stays).toHaveLength(2);
    expect(sim.truth.stationary).toHaveLength(3);
    expect(sim.truth.stationary[1].to - sim.truth.stationary[1].from).toBe(60 * 60_000);
  });

  it("records a hold as stationary truth too", () => {
    const sim = simulate({ start: "2026-03-09T12:00:00Z", origin: { x: 0, y: 0 }, places: [], legs: [
      { kind: "drive", to: { x: 0, y: 600 } }, { kind: "hold", seconds: 600 }, { kind: "drive", to: { x: 0, y: 1_200 } }
    ] }, 1);
    expect(sim.truth.stays).toEqual([]);
    expect(sim.truth.stationary.map(({ from, to }) => to - from)).toEqual([600_000]);
  });

  it("is deterministic for a seed", () => {
    expect(simulate(outing, 7).input()).toEqual(simulate(outing, 7).input());
  });
});
