import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

// Shape of a simulated edge stop (capture simulator, seed 2): the drive passes
// through the School's circle, iOS reports entering and leaving it, and the car
// parks 124 m from the pin. One still fix, a ten-minute silence, a second still
// fix, then the drive home crosses the circle again. Metres east/north of the
// School pin; synthetic geometry and identities.
const SCHOOL_ID = "10000000-0000-4000-8000-0000000000d2";
const HOME_ID = "10000000-0000-4000-8000-0000000000d1";
const DEVICE = "20000000-0000-4000-8000-0000000000d1";
const t0 = Date.parse("2026-03-02T10:00:00Z");
const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
const LAT0 = 51.7;
const latitude = (y: number) => LAT0 + y / 110_540;
const longitude = (x: number) => x / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
type Row = [id: string, minutes: number, x: number | null, y: number | null, accuracy: number | null, speed: number | null,
  kind?: LocationEvidence["kind"], extra?: Partial<LocationEvidence>];
const rows: Row[] = [
  ["home-0", 0, -530, -750, 5, 0], ["home-1", 30, -528, -752, 5, 0], ["home-2", 59.9, -530, -749, 5, 0],
  ["drive-0", 60.12, -489, -679, 3.6, 10.49], ["drive-1", 60.36, -406, -549, 3.6, 11.23],
  ["home-exit", 60.49, null, null, null, null, "geofence_exit", { savedPlaceId: HOME_ID }],
  ["visit-open", 60.5, 89, 89, 10, null, "visit", { metadata: { visitDepartureOpen: true } }],
  ["visit-done", 60.5, 94, 29, 66, null, "visit", { endedAt: at(87.35) }],
  ["drive-2", 60.73, -283, -340, 2.8, 9.39], ["drive-3", 61.1, -134, -154, 4.4, 11.08], ["drive-4", 61.35, -28, -37, 2.4, 9.58],
  ["school-enter", 61.44, null, null, null, null, "geofence_enter", { savedPlaceId: SCHOOL_ID }],
  ["drive-5", 61.48, 27, 24, 4.4, 10.11], ["drive-6", 61.6, 81, 76, 4, 12.35],
  ["school-exit", 61.63, null, null, null, null, "geofence_exit", { savedPlaceId: SCHOOL_ID }],
  ["parked-0", 61.95, 88, 84, 3.4, 0.27], ["parked-1", 71.71, 86, 91, 5.8, 0.07],
  ["away-0", 85.73, 33, 27, 4.8, 11.54],
  ["school-enter-2", 85.97, null, null, null, null, "geofence_enter", { savedPlaceId: SCHOOL_ID }],
  ["away-1", 85.86, -22, -29, 2.2, 10.29], ["away-2", 85.98, -75, -85, 2.5, 9.66], ["away-3", 86.1, -133, -144, 3.1, 9.7],
  ["school-exit-2", 86.22, null, null, null, null, "geofence_exit", { savedPlaceId: SCHOOL_ID }],
  ["away-4", 86.22, -183, -203, 4.8, 9.62], ["away-5", 86.47, -277, -328, 4.4, 11.77], ["away-6", 86.84, -402, -528, 4.6, 9.4],
  ["home-visit", 86.77, -522, -756, 9, null, "visit", { metadata: { visitDepartureOpen: true } }],
  ["away-7", 87.08, -485, -677, 4.4, 10.95], ["away-8", 87.21, -526, -742, 4.2, 9.6],
  ["home-enter", 87.26, null, null, null, null, "geofence_enter", { savedPlaceId: HOME_ID }],
  ["home-3", 88.16, -526, -749, 6.3, 0.14], ["home-4", 120, -530, -750, 5, 0]
];
function edgeStop(drop: string[] = []): LocationEngineInput {
  const evidence = rows.filter(([id]) => !drop.includes(id)).map(([id, minutes, x, y, accuracy, speed, kind, extra]): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: kind ?? "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes), endedAt: null, timeZone: "UTC",
    latitude: x == null ? null : latitude(y!), longitude: x == null ? null : longitude(x), horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: speed, savedPlaceId: null, isSimulated: kind ? null : false, metadata: {}, ...extra
  }));
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(200), acceptedLearnedPlaces: [], evidence,
    savedPlaces: [
      { id: HOME_ID, name: "Home", latitude: latitude(-750), longitude: longitude(-530), radiusMeters: 100, loggingEnabled: false },
      { id: SCHOOL_ID, name: "School", latitude: latitude(0), longitude: longitude(0), radiusMeters: 100, loggingEnabled: true }
    ]
  };
}
const stays = (input: LocationEngineInput) =>
  runLocationEngine(input).segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
const between = (list: StaySegment[], from: number, to: number) => list.filter((stay) => stay.startedAt > at(from) && stay.startedAt < at(to));
/** Two more still fixes make place logic's late fragment promotable as unknown, so only absorption can fix its start. */
function parkedLonger() {
  const input = edgeStop();
  const template = input.evidence.find((item) => item.clientEvidenceId === "parked-1")!;
  input.evidence.push(
    { ...template, clientEvidenceId: "parked-2", occurredAt: at(76), sourceTimestamp: at(76), receivedAt: at(76), speedMetersPerSecond: 0.1 },
    { ...template, clientEvidenceId: "parked-3", occurredAt: at(81), sourceTimestamp: at(81), receivedAt: at(81), speedMetersPerSecond: 0.05 });
  return input;
}
const withoutAbsorption = (input: LocationEngineInput): LocationEngineInput =>
  ({ ...input, config: { ...input.config, physicalStopAbsorbExtensionMs: Number.POSITIVE_INFINITY } });

describe("a physical stop that covers fragments of itself", () => {
  it("replaces a fragment that place logic started late", () => {
    const [stop, ...others] = between(stays(edgeStop()), 61, 80);
    expect(others).toEqual([]);
    // The stop starts at the observed arrival (the last moving fix), not after the silence.
    expect(stop).toMatchObject({ startedAt: at(61.6), placeMatchKind: "unknown", placeId: null, formation: "physical_stop" });
    expect(stop.candidatePlaceIds).toContain(SCHOOL_ID);
    expect(Date.parse(stop.stoppedAt!)).toBeGreaterThanOrEqual(Date.parse(at(85.7)));
  });

  it("keeps the promoted stay when it already covers the stop", () => {
    // Without the drive through the circle there is no pending exit: place logic's stay starts at the
    // first parked fix and agrees with the stop to within a minute, so it keeps precedence.
    const kept = between(stays(edgeStop(["school-enter", "drive-5", "drive-6", "school-exit"])), 61, 80);
    expect(kept).toHaveLength(1);
    expect(kept[0].formation).toBeUndefined();
  });

  it("replaces a promoted fragment that place logic started late", () => {
    const [fragment] = between(stays(withoutAbsorption(parkedLonger())), 61, 80);
    expect(fragment).toMatchObject({ startedAt: at(71.71), placeMatchKind: "unknown" });
    expect(fragment.formation).toBeUndefined();
    const [stop, ...others] = between(stays(parkedLonger()), 61, 80);
    expect(others).toEqual([]);
    expect(stop).toMatchObject({ startedAt: at(61.6), placeMatchKind: "unknown", formation: "physical_stop" });
    expect(stop.evidenceIds).toEqual(expect.arrayContaining(fragment.evidenceIds));
  });

  it("gives the stop a new ID when a late iOS entry proves the saved place, so replay retires its earlier Review", () => {
    const [unknown] = between(stays(parkedLonger()), 61, 80);
    const input = parkedLonger();
    input.evidence.push({ ...input.evidence.find((item) => item.clientEvidenceId === "school-enter")!, clientEvidenceId: "late-enter",
      occurredAt: at(74), sourceTimestamp: at(74), receivedAt: at(150) });
    const [saved] = between(stays(input), 61, 80);
    expect(unknown).toMatchObject({ placeMatchKind: "unknown", formation: "physical_stop" });
    // Saved attendance begins at the first observation (the first parked fix), not the stop's estimated start.
    expect(saved).toMatchObject({ placeMatchKind: "saved", placeId: SCHOOL_ID, formation: "physical_stop",
      startedAt: at(61.95), stoppedAt: unknown.stoppedAt, evidenceIds: unknown.evidenceIds });
    expect(saved.clientSegmentId).not.toBe(unknown.clientSegmentId);
  });

  // The thirty-minute silence limit is pinned by saved-place-arrival-boundaries.test.ts, whose
  // contract (no presence across 48 unsupported minutes) fails without it.
});

// Review round 1: compact fixtures, minutes from 10:00, metres east of a Venue pin.
describe("what an absorbing stop may claim (review round 1)", () => {
  const VENUE_ID = "10000000-0000-4000-8000-0000000000d3";
  const east = (x: number) => x / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
  const point = (id: string, minutes: number, x = 0, speed = 0, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(200), endedAt: null, timeZone: "UTC",
    latitude: LAT0, longitude: east(x), horizontalAccuracyMeters: 5, speedMetersPerSecond: speed, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  });
  const callback = (id: string, minutes: number, kind: LocationEvidence["kind"]) => point(id, minutes, 0, 0,
    { kind, savedPlaceId: VENUE_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
  const venue = { id: VENUE_ID, name: "Venue", latitude: LAT0, longitude: 0, radiusMeters: 100, loggingEnabled: true };
  const compact = (evidence: LocationEvidence[], savedPlaces: LocationEngineInput["savedPlaces"] = [venue]): LocationEngineInput => ({
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(200), acceptedLearnedPlaces: [], evidence, savedPlaces
  });
  const physical = (input: LocationEngineInput) => stays(input).filter((stay) => stay.formation === "physical_stop");

  it("never claims the unobserved hole between two saved fragments", () => {
    const input = compact([point("arriving", 0, -1_000, 10), point("inside-1", 10), point("inside-2", 15), point("inside-3", 20),
      point("inside-4", 65), point("inside-5", 68), point("inside-6", 71), callback("exit", 71.5, "geofence_exit"),
      point("departing-1", 83, 1_000, 10), point("departing-2", 84, 1_100, 10)]);
    expect(physical(input)).toEqual([]);
    expect(stays(input)).toEqual(stays(withoutAbsorption(input)));
  });

  it("never starts saved attendance before the observed arrival", () => {
    const input = compact([point("last-moving-away", 0, -1_000, 10), callback("arrival-entry", 10, "geofence_enter"),
      point("arrival-fix", 10), point("still-15", 15), point("still-20", 20), point("still-25", 25), point("still-30", 30),
      point("departing-1", 31, 1_000, 10), point("departing-2", 32, 1_100, 10)]);
    expect(stays(input).filter((stay) => stay.placeId === VENUE_ID).every((stay) => stay.startedAt >= at(10))).toBe(true);
  });

  it.each(["simulated", "broad"])("does not let %s readings break a silence the stop would claim", (kind) => {
    // The edge stop with a 48-minute silence after its second parked fix, split only by unqualified readings.
    const shifted = (input: LocationEngineInput) => {
      const shift = (iso: string | null | undefined) =>
        iso && Date.parse(iso) >= Date.parse(at(71.71)) ? new Date(Date.parse(iso) + 38.29 * 60_000).toISOString() : iso;
      input.evidence = input.evidence.map((item) => ({ ...item, occurredAt: shift(item.occurredAt)!, sourceTimestamp: shift(item.sourceTimestamp),
        receivedAt: shift(item.receivedAt)!, endedAt: shift(item.endedAt) ?? null }));
      return input;
    };
    const plain = shifted(parkedLonger());
    const padded = shifted(parkedLonger());
    const template = padded.evidence.find((item) => item.clientEvidenceId === "parked-1")!;
    for (const minutes of [80, 95]) padded.evidence.push({ ...template, clientEvidenceId: `unqualified-${minutes}`, occurredAt: at(minutes),
      sourceTimestamp: at(minutes), receivedAt: at(minutes), ...(kind === "simulated" ? { isSimulated: true } : { horizontalAccuracyMeters: 120 }) });
    const bounds = (input: LocationEngineInput) => stays(input).map(({ startedAt, stoppedAt, formation }) => [startedAt, stoppedAt, formation ?? null]);
    expect(bounds(padded)).toEqual(bounds(plain));
  });

  it("puts the saved place itself in a saved replacement's ID", () => {
    const input = parkedLonger();
    input.evidence.push({ ...input.evidence.find((item) => item.clientEvidenceId === "school-enter")!, clientEvidenceId: "late-enter",
      occurredAt: at(74), sourceTimestamp: at(74), receivedAt: at(150) });
    const [school] = between(stays(input), 61, 80);
    const renamed: LocationEngineInput = { ...input,
      savedPlaces: input.savedPlaces.map((place) => place.id === SCHOOL_ID ? { ...place, id: "10000000-0000-4000-8000-0000000000d4" } : place),
      evidence: input.evidence.map((item) => item.savedPlaceId === SCHOOL_ID ? { ...item, savedPlaceId: "10000000-0000-4000-8000-0000000000d4" } : item) };
    const [other] = between(stays(renamed), 61, 80);
    expect([school.placeMatchKind, other.placeMatchKind, other.formation]).toEqual(["saved", "saved", "physical_stop"]);
    expect(other.clientSegmentId).not.toBe(school.clientSegmentId);
  });

  it("keeps a commute into an absorbed stay with an inferred boundary for Review", () => {
    const ORIGIN_ID = "10000000-0000-4000-8000-0000000000d5";
    const input = compact([point("origin-1", -22, -2_000), point("origin-2", -17, -2_000), point("origin-3", -12, -2_000),
      point("route-1", -11, -1_600, 10), point("route-2", -5, -1_200, 10), point("route-3", 0, -800, 10),
      point("early-slow", 5, 100, 0), point("broad-visit", 10, 0, 0, { kind: "visit", horizontalAccuracyMeters: 120, endedAt: at(61) }),
      callback("entry", 10.2, "geofence_enter"), point("arrive-1", 10.5), point("arrive-2", 12.5),
      point("still-1", 50), point("still-2", 55), point("still-3", 60), point("leave-1", 62, 1_000, 10), point("leave-2", 63, 1_100, 10)],
      [{ ...venue, radiusMeters: 30 }, { id: ORIGIN_ID, name: "Origin", latitude: LAT0, longitude: east(-2_000), radiusMeters: 100, loggingEnabled: true }]);
    const commute = runLocationEngine(input).segmentUpserts.find((segment) => segment.kind === "commute")!;
    expect(assessAutomaticLocation("v2_enabled", commute).action).toBe("review");
  });

  // Review round 2.
  it("never starts saved attendance at readings beyond the place's band", () => {
    // Fixes 80 m from a 30 m Venue are certainly outside it, though they are the same physical stop.
    const input = compact([point("approach", 0, -1_000, 10), point("outside-1", 5, 80), point("outside-2", 7, 80), point("outside-3", 9, 80),
      callback("entry", 12, "geofence_enter"), point("inside-1", 12), point("inside-2", 15), point("inside-3", 20), point("inside-4", 25),
      callback("exit", 26, "geofence_exit"), point("leave-1", 36, 1_000, 10), point("leave-2", 37, 1_100, 10)], [{ ...venue, radiusMeters: 30 }]);
    expect(stays(withoutAbsorption(input)).find((stay) => stay.placeId === VENUE_ID)?.startedAt).toBe(at(12));
    const venueStays = stays(input).filter((stay) => stay.placeId === VENUE_ID);
    expect(venueStays.length).toBeGreaterThan(0);
    expect(venueStays.every((stay) => stay.startedAt >= at(12))).toBe(true);
  });

  it("never bridges a silence with a fragment's estimated end", () => {
    // The first fragment ends midway to its exit (26), but nothing was observed between 20 and 56.
    const input = compact([point("approach", 0, -1_000, 10), point("inside-1", 10), point("inside-2", 15), point("inside-3", 20),
      callback("exit-a", 32, "geofence_exit"), point("inside-4", 56), point("inside-5", 59), point("inside-6", 62),
      callback("exit-b", 62.5, "geofence_exit"), point("leave-1", 75, 1_000, 10), point("leave-2", 76, 1_100, 10)]);
    expect(stays(withoutAbsorption(input)).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt])).toEqual([[at(10), at(26)], [at(56), at(62)]]);
    expect(stays(input).some((stay) => stay.startedAt <= at(20) && (stay.stoppedAt ?? at(200)) >= at(56))).toBe(false);
  });

  // Review round 3.
  const gap = () => [point("arriving", 0, -1_000, 10), point("inside-1", 10), point("inside-2", 15), point("inside-3", 20),
    point("inside-4", 65), point("inside-5", 68), point("inside-6", 71), callback("exit", 71.5, "geofence_exit"),
    point("departing-1", 83, 1_000, 10), point("departing-2", 84, 1_100, 10)];
  const spanning = (x: number, accuracy: number) => point("visit", 5, x, 0,
    { kind: "visit", endedAt: at(80), horizontalAccuracyMeters: accuracy, speedMetersPerSecond: null });
  const bridges = (input: LocationEngineInput) => stays(input).some((stay) => stay.startedAt <= at(20) && (stay.stoppedAt ?? at(200)) >= at(65));

  it.each([0, 200])("never bridges a silence with an unqualified Visit (broad, centred %i m away)", (x) => {
    const input = compact([...gap(), spanning(x, 120)]);
    expect(stays(withoutAbsorption(input)).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt])).toEqual([[at(10), at(20)], [at(65), at(71)]]);
    expect(bridges(input)).toBe(false);
  });

  it("still lets an accurate Visit at the place support the silence", () => {
    expect(bridges(compact([...gap(), spanning(0, 5)]))).toBe(true);
  });

  it("keeps a fragment's corroborated arrival bounds when the stop's estimate ties its start", () => {
    const input = compact([point("approach", 0, -1_000, 10), point("arrival", 5, 0, 0, { kind: "visit", horizontalAccuracyMeters: 5, speedMetersPerSecond: null }),
      callback("entry", 5.2, "geofence_enter"), point("a-1", 10), point("a-2", 15), point("a-3", 20), point("a-4", 25),
      callback("exit", 26, "geofence_exit"), point("leave-1", 39, 1_000, 10), point("leave-2", 40, 1_100, 10)]);
    expect(stays(withoutAbsorption(input))[0]).toMatchObject({ startLowerBoundAt: at(5), startUpperBoundAt: at(5) });
    const [stay] = stays(input);
    expect(stay).toMatchObject({ startedAt: at(5), startLowerBoundAt: at(5), startUpperBoundAt: at(5) });
    expect(stay.approximateArrival).toBeUndefined();
  });
});
