import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

const HOME_ID = "10000000-0000-4000-8000-0000000000e1";
const DEVICE = "20000000-0000-4000-8000-0000000000e1";
const t0 = Date.parse("2026-03-09T18:00:00Z");
const at = (seconds: number) => new Date(t0 + seconds * 1_000).toISOString();
const north = (metres: number) => metres / 111_195;

function reading(id: string, seconds: number, metres: number | null, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(seconds), sourceTimestamp: at(seconds), receivedAt: at(seconds + 60), endedAt: null, timeZone: "UTC",
    latitude: metres == null ? null : north(metres), longitude: metres == null ? null : 0, horizontalAccuracyMeters: metres == null ? null : 4,
    speedMetersPerSecond: metres == null ? null : 11, savedPlaceId: null, isSimulated: false, metadata: {}, ...patch
  };
}

/**
 * A drive home from 2 km at 11 m/s, arriving at `arrival` seconds. iOS dates the arrival Visit
 * `visitEarlySeconds` before that, while the car is still on the road; the phone is then silent at Home.
 */
function homecoming(options: { visitEarlySeconds?: number; exitInWindow?: boolean; noPlaceEvidence?: boolean } = {}) {
  const evidence: LocationEvidence[] = [];
  let seconds = 0;
  for (let metres = 2_000; metres > 100; metres -= 77, seconds += 7) evidence.push(reading(`approach-${metres}`, seconds, metres));
  const arrival = seconds;
  if (!options.noPlaceEvidence) {
    evidence.push(reading("home-enter", arrival + 2, null, { kind: "geofence_enter", savedPlaceId: HOME_ID }),
      reading("home-0", arrival + 30, 8, { speedMetersPerSecond: 0.1 }));
  }
  if (options.exitInWindow) evidence.push(reading("home-exit", arrival - 60, null, { kind: "geofence_exit", savedPlaceId: HOME_ID }));
  evidence.push(reading("arrival-visit", arrival - (options.visitEarlySeconds ?? 100), 6, {
    kind: "visit", horizontalAccuracyMeters: 8, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true }
  }));
  const value: LocationEngineInput = {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(arrival + 3 * 3_600), acceptedLearnedPlaces: [], evidence,
    savedPlaces: [{ id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false }]
  };
  return { value, arrival };
}
const homeStays = (value: LocationEngineInput) => runLocationEngine(value).segmentUpserts
  .filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID);

describe("an arrival Visit iOS dates before the car arrives", () => {
  it.each([45, 100, 157])("keeps Home presence from the observed arrival through the silence (dated %i s early)", (early) => {
    const { value, arrival } = homecoming({ visitEarlySeconds: early });
    const [home, ...others] = homeStays(value);
    expect(others).toEqual([]);
    // The stay begins at the entry, not at the Visit's earlier time while the car was still on the road.
    expect(home).toMatchObject({ startedAt: at(arrival + 2), status: "open", stoppedAt: null });
    expect(home.evidenceIds).toContain("arrival-visit");
  });

  it("is unchanged when the Visit is dated more than three minutes early", () => {
    const { value } = homecoming({ visitEarlySeconds: 200 });
    expect(homeStays(value)).toEqual([]);
  });

  it("is unchanged when Home's exit falls between the Visit and the arrival", () => {
    const { value } = homecoming({ exitInWindow: true });
    expect(homeStays(value)).toEqual([]);
  });

  it("is unchanged when nothing at Home follows the approach", () => {
    const { value } = homecoming({ noPlaceEvidence: true });
    expect(homeStays(value)).toEqual([]);
  });

  it("leaves an arrival Visit dated at the arrival on the ordinary corroborated path", () => {
    const { value, arrival } = homecoming({ visitEarlySeconds: -1 });
    const [home] = homeStays(value);
    expect(home).toMatchObject({ status: "open", stoppedAt: null });
    expect(home.startedAt <= at(arrival + 2)).toBe(true);
  });

  // Review round 1.
  const visit = (id: string, seconds: number, patch: Partial<LocationEvidence> = {}) =>
    reading(id, seconds, 6, { kind: "visit", horizontalAccuracyMeters: 8, speedMetersPerSecond: null, metadata: { visitDepartureOpen: true }, ...patch });
  const enter = (id: string, seconds: number) => reading(id, seconds, null, { kind: "geofence_enter", savedPlaceId: HOME_ID });
  const away = (id: string, seconds: number, metres = 300) => reading(id, seconds, metres, { speedMetersPerSecond: 10 });
  const still = (id: string, seconds: number, metres = 6) => reading(id, seconds, metres, { speedMetersPerSecond: 0 });
  const compact = (evidence: LocationEvidence[], patch: Partial<LocationEngineInput> = {}): LocationEngineInput => ({
    ...homecoming().value, processingAt: at(7_200), evidence, ...patch
  });

  it("defers every early Visit that shares an anchor, never giving one presence at its own time", () => {
    const stays = homeStays(compact([visit("arrival-1", 0), visit("arrival-2", 10), away("approach", 20), enter("anchor", 120)]));
    expect(stays.length).toBeGreaterThan(0);
    expect(stays.every((stay) => stay.startedAt >= at(120))).toBe(true);
  });

  it("does not defer a Visit whose own departure came before the anchor onto a later arrival", () => {
    const stays = homeStays(compact([visit("arrival-1", 0), visit("completion-1", 0, { endedAt: at(60) }), away("approach", 20),
      visit("arrival-2", 110), still("anchor", 120)]));
    expect(stays.some((stay) => stay.evidenceIds.includes("arrival-2"))).toBe(true);
  });

  it("keeps a stay's ID when an early arrival's broad completion is delivered later", () => {
    const evidence = [still("inside-old-first", -800), still("inside-old-last", -400), visit("arrival", 0), away("approach", 20), enter("anchor", 120)];
    const [before] = homeStays(compact(evidence));
    const [after] = homeStays(compact([...evidence, visit("completion", 0, { endedAt: at(3_600), horizontalAccuracyMeters: 94, latitude: north(140) })]));
    expect(after.clientSegmentId).toBe(before.clientSegmentId);
  });

  it("leaves an episode the broad-Visit path already supports as it was", () => {
    const evidence = [visit("arrival", 0), visit("completion", 0, { endedAt: at(4_200), horizontalAccuracyMeters: 94 }),
      still("slow-away", 20, 150), still("anchor", 170, 8), still("early-2", 230, 8), still("late-1", 3_600, 8), still("late-2", 3_900, 8)];
    const engine = runLocationEngine(compact(evidence));
    const [home] = engine.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID);
    expect(home.evidenceIds[0]).toBe("arrival");
  });

  it("attaches at the next evidence at Home when another saved stay sets the entry aside", () => {
    // A neighbouring saved place's stay is still open when Home's entry arrives, so the entry is skipped; the
    // first inside fix closes it and the early Visit joins the Home stay there.
    const neighbour = { id: "10000000-0000-4000-8000-0000000000e2", name: "Neighbour", latitude: north(420), longitude: 0, radiusMeters: 300, loggingEnabled: true };
    const evidence = [still("n0", -900, 420), still("n1", -600, 420), visit("arrival", 0), away("approach-0", 20, 260), away("approach-1", 60, 200),
      enter("anchor", 100), still("home-0", 130, 8)];
    const stays = runLocationEngine(compact(evidence, { savedPlaces: [...homecoming().value.savedPlaces, neighbour] })).segmentUpserts
      .filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID);
    expect(stays).toEqual([expect.objectContaining({ startedAt: at(130), status: "open", stoppedAt: null })]);
    expect(stays[0].evidenceIds).toContain("arrival");
  });

  // Review round 2: attachment never crosses an episode, outlives the Visit's departure or overrides newer presence.
  const neighbour = { id: "10000000-0000-4000-8000-0000000000e2", name: "Neighbour", latitude: north(420), longitude: 0, radiusMeters: 300, loggingEnabled: true };
  const exit = (id: string, seconds: number) => reading(id, seconds, null, { kind: "geofence_exit", savedPlaceId: HOME_ID });
  const beside = () => [still("n0", -900, 420), still("n1", -600, 420), visit("arrival", 0)];
  const approach = () => [away("approach-0", 20, 260), away("approach-1", 60, 200)];
  const withNeighbour = (evidence: LocationEvidence[]) => compact(evidence, { savedPlaces: [...homecoming().value.savedPlaces, neighbour] });
  const disabled = (value: LocationEngineInput): LocationEngineInput => ({ ...value, config: { ...value.config, savedPlaceVisitEarlyArrivalMaximumMs: -1 } });

  it("keeps a valid later Home visit when the deferred Visit's own departure came before it", () => {
    const value = withNeighbour([...beside(), visit("completion", 0, { endedAt: at(150) }), ...approach(), enter("anchor", 100),
      visit("real-return", 220, { endedAt: at(4_000) }), still("home-0", 240)]);
    const expected = [expect.objectContaining({ startedAt: at(220), stoppedAt: at(4_000) })];
    expect(homeStays(disabled(value))).toEqual(expected);
    expect(homeStays(value)).toEqual(expected);
  });

  it("does not attach an early arrival across Home's exit after its anchor was set aside", () => {
    const value = withNeighbour([...beside(), ...approach(), enter("anchor", 100), exit("departure", 160), still("home-0", 300)]);
    expect(homeStays(disabled(value))).toEqual([]);
    expect(homeStays(value)).toEqual([]);
  });

  it.each([
    ["after a set-aside anchor", () => withNeighbour([...beside(), ...approach(), enter("anchor", 100), visit("new-arrival", 220),
      visit("new-completion", 220, { endedAt: at(900) }), still("home-0", 240), still("home-late-0", 3_600), still("home-late-1", 4_000)])],
    ["sharing the anchor's time", () => compact([visit("old-arrival", 0), away("approach", 20), visit("new-arrival", 120),
      visit("new-completion", 120, { endedAt: at(900) }), still("anchor", 120), still("home-late-0", 3_600), still("home-late-1", 4_000)])]
  ])("never lets an older early arrival lift a newer arrival's departure (%s)", (_label, build) => {
    const value = build();
    expect(homeStays(disabled(value))).toHaveLength(2);
    const stays = homeStays(value);
    expect(stays).toHaveLength(2);
    expect(stays[0].stoppedAt).toBe(at(900));
  });

  // Review round 3: a newer completed Visit owns its episode and departure even without an arrival-only callback,
  // whether it joins before the early arrival would attach (also when sharing the anchor's time) or after.
  it.each([
    ["after a set-aside anchor", 220, () => withNeighbour([...beside(), ...approach(), enter("anchor", 100),
      visit("new-completion-only", 220, { endedAt: at(900) }), still("home-0", 240), still("home-late-0", 3_600), still("home-late-1", 4_000)])],
    ["sharing the anchor's time", 120, () => compact([visit("old-arrival", 0), away("approach", 20),
      visit("new-completion-only", 120, { endedAt: at(900) }), still("anchor", 120), still("home-late-0", 3_600), still("home-late-1", 4_000)])],
    ["joining after the early arrival attached", 100, () => compact([visit("old-arrival", 0), away("approach", 20), still("anchor", 100),
      visit("new-completion-only", 220, { endedAt: at(900) }), still("home-0", 240), still("home-late-0", 3_600), still("home-late-1", 4_000)])]
  ] as const)("never lets an older early arrival lift a newer completed Visit's departure (%s)", (_label, start, build) => {
    const value = build();
    const bounds = (input: LocationEngineInput) => homeStays(input).map(({ startedAt, stoppedAt }) => [startedAt, stoppedAt]);
    // Without early arrivals the newer Visit's departure already ends the first stay.
    expect(bounds(disabled(value)).map(([, stoppedAt]) => stoppedAt)).toEqual([at(900), null]);
    expect(bounds(value)).toEqual([[at(start), at(900)], [at(3_600), null]]);
  });
});
