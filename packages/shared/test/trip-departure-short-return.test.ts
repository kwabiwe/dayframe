import { describe, expect, it } from "vitest";
import { assessAutomaticMove } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

// Card E (owner feedback, 25 Oct), with synthetic geometry: Home at the origin and School 1 km north. The
// phone drives out 2.3 km east for a six-minute stop, comes back past Home for three minutes (too short to
// be a stay), drives to a shop beside School, and two minutes after leaving it is home again. The trip
// started at 10:57, the moment it left Home the second time, so the first loop had no segment and a
// one-minute drive stood on its own; the two-minute drive home was dropped.
const HOME_ID = "10000000-0000-4000-8000-0000000000e1";
const SCHOOL_ID = "10000000-0000-4000-8000-0000000000e2";
const DEVICE = "20000000-0000-4000-8000-0000000000e1";
const t0 = Date.parse("2026-03-08T10:00:00Z");
const at = (minutes: number) => new Date(t0 + Math.round(minutes * 60_000)).toISOString();
const north = (metres: number) => metres / 111_195;

function fix(id: string, minutes: number, metres: { north?: number; east?: number }, accuracy: number,
  patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes + 1), timeZone: "UTC", endedAt: null,
    latitude: north(metres.north ?? 0), longitude: north(metres.east ?? 0), horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: null, savedPlaceId: null, isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minutes: number, kind: "geofence_enter" | "geofence_exit", placeId: string) =>
  fix(id, minutes, {}, 0, { kind, savedPlaceId: placeId, latitude: null, longitude: null, horizontalAccuracyMeters: null });
const visit = (id: string, minutes: number, metres: { north?: number; east?: number }, accuracy: number, endedMinutes?: number) =>
  fix(id, minutes, metres, accuracy, { kind: "visit", endedAt: endedMinutes == null ? null : at(endedMinutes),
    metadata: endedMinutes == null ? { visitDepartureOpen: true } : {} });
const motion = (steps: Array<[minute: number, activity: string]>): LocationEvidence[] => steps.map(([minute, activity], index) => ({
  clientEvidenceId: `motion-${index}`, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "motion_activity",
  occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(minute + 1), timeZone: "UTC", endedAt: null,
  latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, savedPlaceId: null,
  isSimulated: null, metadata: { motionActivity: activity, motionConfidence: "high" }
} as LocationEvidence));

function morning({ withMotion = true, loopMetres = 2_300 }: { withMotion?: boolean; loopMetres?: number } = {}): LocationEngineInput {
  const homeAgainAt = 44;
  // The loop east, scaled to how far it goes.
  const east = (metres: number) => Math.round(metres * loopMetres / 2_300);
  const evidence = [
    ...[0, 5, 10, 15, 20, 25, 30].map((m, i) => fix(`home-am-${i}`, m, { north: i % 3 }, 5)),
    // Out: leaves Home at 30.6, a six-minute stop 2.3 km east (by default), back towards Home.
    fix("out-0", 30.6, { north: 250 }, 17), crossing("home-exit", 30.62, "geofence_exit", HOME_ID),
    fix("out-1", 30.75, { north: 270 }, 32, { speedMetersPerSecond: 4.9 }), fix("out-2", 31.6, { north: 300, east: east(400) }, 24),
    // iOS's own Visit for the stop and the fixes there spread over 230 m, wherever the stop is: no stay forms.
    visit("stop-visit", 34.2, { east: east(2_300) + 50 }, 20), visit("stop-visit-done", 34.2, { east: east(2_300) - 130 }, 4, 40.1),
    fix("stop-0", 36.1, { east: east(2_300) + 100 }, 11, { speedMetersPerSecond: 0 }), fix("stop-1", 39.0, { east: east(2_300) - 15 }, 5),
    fix("back-0", 41.2, { north: 150, east: east(1_600) }, 28), fix("back-1", 41.3, { north: 140, east: east(1_520) }, 5, { speedMetersPerSecond: 5.8 }),
    // Back past Home for three minutes: not a stay.
    visit("home-pass-visit", homeAgainAt, { north: 7 }, 27), visit("home-pass-done", homeAgainAt, { north: 30 }, 8, homeAgainAt + 3.4),
    crossing("home-enter", homeAgainAt + 0.4, "geofence_enter", HOME_ID),
    fix("home-pass-0", homeAgainAt + 1.2, { north: 15 }, 17, { speedMetersPerSecond: 0 }), fix("home-pass-1", homeAgainAt + 1.8, { north: 10 }, 8),
    // To the shop beside School.
    fix("shop-out-0", homeAgainAt + 3.3, { north: 180 }, 11), crossing("home-exit-2", homeAgainAt + 3.32, "geofence_exit", HOME_ID),
    fix("shop-out-1", homeAgainAt + 4.0, { north: 380 }, 13), fix("shop-out-2", homeAgainAt + 4.1, { north: 530 }, 11, { speedMetersPerSecond: 8.7 }),
    visit("shop-visit", homeAgainAt + 4.9, { north: 930 }, 27), visit("shop-visit-done", homeAgainAt + 4.9, { north: 930 }, 32, homeAgainAt + 17.2),
    fix("shop-0", homeAgainAt + 5.1, { north: 931 }, 7, { speedMetersPerSecond: 3.5 }), crossing("school-enter", homeAgainAt + 5.1, "geofence_enter", SCHOOL_ID),
    fix("shop-1", homeAgainAt + 6.8, { north: 926 }, 23), fix("shop-2", homeAgainAt + 9.1, { north: 928 }, 21), fix("shop-3", homeAgainAt + 9.5, { north: 915 }, 20),
    // Two minutes home: one route reading, no speed.
    fix("home-run-0", homeAgainAt + 18.0, { north: 490 }, 32), crossing("school-exit", homeAgainAt + 18.0, "geofence_exit", SCHOOL_ID),
    visit("home-visit", homeAgainAt + 19.1, { north: 11 }, 38), crossing("home-enter-2", homeAgainAt + 19.4, "geofence_enter", HOME_ID),
    ...[23, 30, 40, 50, 60].map((m, i) => fix(`home-pm-${i}`, homeAgainAt + m, { north: i % 3 }, 5, { speedMetersPerSecond: 0 })),
    ...(withMotion ? motion([
      // Stillness flickering with unknown while in the shop, a walk to the car, the drive, then still at Home.
      [homeAgainAt + 11.8, "stationary"], [homeAgainAt + 11.95, "unknown"], [homeAgainAt + 12.35, "stationary"], [homeAgainAt + 12.4, "unknown"],
      [homeAgainAt + 12.7, "stationary"], [homeAgainAt + 12.8, "unknown"], [homeAgainAt + 13.4, "stationary"], [homeAgainAt + 13.6, "unknown"],
      [homeAgainAt + 15.5, "walking"], [homeAgainAt + 16.7, "unknown"], [homeAgainAt + 16.97, "automotive"], [homeAgainAt + 18.1, "automotive"],
      [homeAgainAt + 20.2, "unknown"], [homeAgainAt + 21.0, "stationary"], [homeAgainAt + 24.05, "unknown"], [homeAgainAt + 24.4, "stationary"]
    ]) : [])
  ];
  return {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(homeAgainAt + 120), evidence, acceptedLearnedPlaces: [],
    savedPlaces: [
      { id: HOME_ID, name: "Home", role: "home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: false },
      { id: SCHOOL_ID, name: "School", latitude: north(1_000), longitude: 0, radiusMeters: 100, loggingEnabled: true }
    ]
  };
}
const segments = (input: LocationEngineInput) => runLocationEngine(input).segmentUpserts;
const commutes = (input: LocationEngineInput) =>
  segments(input).filter((segment): segment is CommuteSegment => segment.kind === "commute");
const minutes = (iso: string | null) => iso == null ? null : Math.round((Date.parse(iso) - t0) / 6_000) / 10;

describe("a trip starts at departure (card E, 25 Oct)", () => {
  it("starts the trip to School when the phone first left Home, not after it passed back through", () => {
    const toSchool = commutes(morning()).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeLessThanOrEqual(30.7);
    expect(minutes(toSchool[0].stoppedAt)).toBeCloseTo(48.9, 0);
  });

  it("leaves no one-minute drive standing on its own after the pass through Home", () => {
    const short = commutes(morning()).filter((trip) => Date.parse(trip.stoppedAt) - Date.parse(trip.startedAt) < 3 * 60_000 &&
      trip.toPlaceId === SCHOOL_ID);
    expect(short).toEqual([]);
  });

  it("offers the widened trip in Review, never logs it, even with clean speeds: its stop and pass home were never stays (Codex r1 on #589)", () => {
    const input = morning();
    input.evidence = input.evidence.map((item) => ["out-1", "out-2", "back-1"].includes(item.clientEvidenceId)
      ? { ...item, speedMetersPerSecond: 10 } : item);
    const [trip] = commutes(input).filter((candidate) => candidate.fromPlaceId === HOME_ID && candidate.toPlaceId === SCHOOL_ID);
    expect(minutes(trip.startedAt)).toBeLessThanOrEqual(30.7);
    expect(trip.confidence).toBe("low");
    expect(assessAutomaticMove(trip, true).eligible).toBe(false);
  });

  it("never counts one reading and its copy as two readings away (Codex r1 on #589)", () => {
    // One accurate reading far away, mirrored a second later: not clearly away, so the later start stays.
    const input = morning();
    const far = input.evidence.find((item) => item.clientEvidenceId === "stop-0")!;
    input.evidence = [...input.evidence.filter((item) => !["stop-1", "back-0", "back-1", "out-2"].includes(item.clientEvidenceId)),
      { ...far, clientEvidenceId: "stop-0-copy", kind: "significant_change", occurredAt: at(36.1 + 1 / 60), sourceTimestamp: at(36.1 + 1 / 60) }];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeGreaterThanOrEqual(47);
  });

  it("needs both readings away before the pass home, never one before it and one after (Codex r2 on #589)", () => {
    const input = morning();
    input.evidence = [...input.evidence.filter((item) => !["stop-1", "back-0", "back-1", "out-2"].includes(item.clientEvidenceId)),
      fix("after-0", 48.5, { north: 750 }, 8)];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeGreaterThanOrEqual(47);
  });

  it("needs the stop away in the same excursion as the readings away (Codex r3 on #589)", () => {
    // An earlier short outing stopped somewhere; the later loop, after a moment at Home, did not.
    const input = morning({ withMotion: false });
    input.evidence = [...input.evidence.filter((item) => !["stop-visit", "stop-visit-done"].includes(item.clientEvidenceId)),
      visit("early-stop", 32, { east: 2_300 }, 10, 33), crossing("home-enter-early", 34, "geofence_enter", HOME_ID),
      fix("home-early", 34.1, { north: 3 }, 5, { speedMetersPerSecond: 0 }), crossing("home-exit-early", 34.7, "geofence_exit", HOME_ID)];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeGreaterThanOrEqual(47);
  });

  it("judges the excursion just before the pass home, so an earlier one without a stop never hides it (Codex r4 on #589)", () => {
    // A short loop 1–1.3 km east at 27–28 with no stop, back Home at 29; then the morning's stopped excursion.
    const input = morning({ withMotion: false });
    input.evidence = [...input.evidence.filter((item) => item.clientEvidenceId !== "home-am-6"),
      fix("early-0", 27, { east: 1_000 }, 6), fix("early-1", 28, { east: 1_300 }, 6), crossing("home-enter-early", 29, "geofence_enter", HOME_ID),
      fix("home-early", 29.1, { north: 2 }, 5, { speedMetersPerSecond: 0 })];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeLessThanOrEqual(30.7);
  });

  it("joins every stopped excursion before the trip across brief passes home (Codex r5 on #589)", () => {
    // An earlier excursion 2.5 km north-east with its own stop (Visit), back Home for two minutes at 27,
    // then the morning's stopped excursion: the trip starts at the first departure.
    const input = morning({ withMotion: false });
    input.evidence = [...input.evidence.filter((item) => !["home-am-5", "home-am-6"].includes(item.clientEvidenceId)),
      fix("early-0", 21, { north: 900, east: 900 }, 6), fix("early-1", 22, { north: 1_800, east: 1_800 }, 6),
      visit("early-stop", 23, { north: 1_800, east: 1_800 }, 8, 25), fix("early-2", 26, { north: 900, east: 900 }, 6),
      crossing("home-enter-early", 27, "geofence_enter", HOME_ID), fix("home-early", 27.5, { north: 3 }, 5, { speedMetersPerSecond: 0 }),
      fix("home-early-1", 29, { north: 2 }, 5, { speedMetersPerSecond: 0 })];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeLessThanOrEqual(21);
  });

  it("never joins an earlier excursion across a longer time back Home (Codex r6 on #589)", () => {
    // The same two stopped excursions, the morning's starting nine minutes after the first one's return.
    const input = morning({ withMotion: false });
    const shift = 3;
    const moved = input.evidence.map((item) => Date.parse(item.occurredAt) >= Date.parse(at(30.5)) && Date.parse(item.occurredAt) < Date.parse(at(60))
      ? { ...item, occurredAt: at((Date.parse(item.occurredAt) - t0) / 60_000 + shift), sourceTimestamp: at((Date.parse(item.occurredAt) - t0) / 60_000 + shift),
        ...(item.endedAt ? { endedAt: at((Date.parse(item.endedAt) - t0) / 60_000 + shift) } : {}) } : item);
    input.evidence = [...moved.filter((item) => !["home-am-5", "home-am-6"].includes(item.clientEvidenceId)),
      fix("early-0", 21, { north: 900, east: 900 }, 6), fix("early-1", 22, { north: 1_800, east: 1_800 }, 6),
      visit("early-stop", 23, { north: 1_800, east: 1_800 }, 8, 25), fix("early-2", 26, { north: 900, east: 900 }, 6),
      crossing("home-enter-early", 27, "geofence_enter", HOME_ID), fix("home-early", 27.5, { north: 3 }, 5, { speedMetersPerSecond: 0 }),
      fix("home-early-1", 29, { north: 2 }, 5, { speedMetersPerSecond: 0 })];
    const toSchool = commutes(input).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeGreaterThanOrEqual(33);
  });

  it("keeps the trip between its stays: it starts when Home ends at the latest and ends where the shop stay begins", () => {
    const all = segments(morning());
    const stays = all.filter((segment): segment is StaySegment => segment.kind === "stay");
    for (const trip of all.filter((segment): segment is CommuteSegment => segment.kind === "commute")) {
      for (const stay of stays) {
        const overlap = Math.min(Date.parse(trip.stoppedAt), Date.parse(stay.stoppedAt ?? at(1_000))) -
          Math.max(Date.parse(trip.startedAt), Date.parse(stay.startedAt));
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
    const shop = stays.find((stay) => stay.placeId === SCHOOL_ID)!;
    const [toSchool, home] = all.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    expect(toSchool.stoppedAt).toBe(shop.startedAt);
    expect(Date.parse(home.startedAt)).toBeGreaterThanOrEqual(Date.parse(shop.stoppedAt!));
  });

  it("keeps a wander near the origin out of the trip: only an outing that could be a trip of its own moves the start", () => {
    // The same morning with the loop only 450 m out: the trip starts when the phone last left Home.
    const toSchool = commutes(morning({ loopMetres: 450 })).filter((trip) => trip.fromPlaceId === HOME_ID && trip.toPlaceId === SCHOOL_ID);
    expect(toSchool).toHaveLength(1);
    expect(minutes(toSchool[0].startedAt)).toBeGreaterThanOrEqual(47);
  });
});

describe("a two-minute drive home Core Motion saw (card E, 25 Oct)", () => {
  it("keeps it when its drive follows an unknown spell rather than stillness", () => {
    const home = commutes(morning()).filter((trip) => trip.fromPlaceId === SCHOOL_ID && trip.toPlaceId === HOME_ID);
    expect(home).toHaveLength(1);
    expect(home[0].motionSupported).toBe(true);
    expect(home[0].confidence).toBe("low");
    expect(minutes(home[0].stoppedAt)).toBeCloseTo(63.1, 0);
  });

  it("still needs Core Motion's drive: one reading alone is not a journey", () => {
    expect(commutes(morning({ withMotion: false })).filter((trip) => trip.fromPlaceId === SCHOOL_ID)).toEqual([]);
  });

  it("ends the shop stay where the drive home begins and starts Home where it ends", () => {
    const stays = segments(morning()).filter((segment): segment is StaySegment => segment.kind === "stay");
    const lastHome = stays.filter((stay) => stay.placeId === HOME_ID).at(-1)!;
    expect(minutes(lastHome.startedAt)).toBeCloseTo(63.1, 0);
  });
});

describe("a trip ends on arrival through a quiet phone at home (card E part 2, 25 Oct)", () => {
  /** Home at the entry, readings inside for three and a half minutes, three hours of silence, then inside again. */
  function quietHome() {
    const input = morning();
    const homeAgainAt = 44;
    // iOS's arrival Visit was too broad to use (161 m), as on 25 Oct: only the entry and the readings place the phone.
    input.evidence = [...input.evidence.filter((item) => !item.clientEvidenceId.startsWith("home-pm-"))
      .map((item) => item.clientEvidenceId === "home-visit" ? { ...item, horizontalAccuracyMeters: 161 } : item),
      fix("home-q-0", homeAgainAt + 19.3, { north: 10 }, 19), fix("home-q-1", homeAgainAt + 19.7, { north: 14 }, 27),
      fix("home-q-2", homeAgainAt + 21.0, { north: 3 }, 7), fix("home-q-3", homeAgainAt + 22.8, { north: 12 }, 19),
      fix("home-late-0", homeAgainAt + 195, { north: 6 }, 9), fix("home-late-1", homeAgainAt + 200, { north: 4 }, 8)];
    input.processingAt = at(homeAgainAt + 210);
    return { input, arrivedAt: homeAgainAt + 19.4 };
  }

  it("starts Home at the entry and ends the drive home there, not when the phone is next heard from", () => {
    const { input, arrivedAt } = quietHome();
    const home = segments(input).filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID).at(-1)!;
    expect(minutes(home.startedAt)).toBeLessThanOrEqual(arrivedAt);
    const [drive] = commutes(input).filter((trip) => trip.fromPlaceId === SCHOOL_ID && trip.toPlaceId === HOME_ID);
    expect(minutes(drive.stoppedAt)).toBeLessThanOrEqual(arrivedAt);
  });

  it("still ends Home when iOS reported leaving during the silence", () => {
    const { input } = quietHome();
    input.evidence = [...input.evidence, crossing("home-exit-quiet", 44 + 60, "geofence_exit", HOME_ID)];
    const homes = segments(input).filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID);
    expect(homes.every((stay) => stay.stoppedAt == null ? minutes(stay.startedAt)! > 44 + 60 : minutes(stay.stoppedAt)! < 44 + 100)).toBe(true);
  });

  it("never carries Home across readings elsewhere, even ones too broad to count as outside (Codex r2 on #591)", () => {
    const { input, arrivedAt } = quietHome();
    input.evidence = [...input.evidence, fix("away-broad-0", 44 + 60, { north: 1_500 }, 66), fix("away-broad-1", 44 + 90, { north: 2_500 }, 66)];
    const home = segments(input).filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID).at(-1)!;
    expect(minutes(home.startedAt)).toBeGreaterThan(arrivedAt + 60);
  });

  it("never carries Home when its last reading before the silence was moving: the phone was leaving (Codex r3 on #591)", () => {
    const { input, arrivedAt } = quietHome();
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "home-q-3" ? { ...item, speedMetersPerSecond: 10 } : item);
    const home = segments(input).filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID).at(-1)!;
    expect(minutes(home.startedAt)).toBeGreaterThan(arrivedAt + 60);
  });

  it("keeps a stay of five minutes or more before a silence its own, as before (Codex r1 on #591)", () => {
    // Home from the entry for ten minutes, three hours of silence, then inside again: two stays, so a decided
    // first one is never folded into a new open one.
    const { input } = quietHome();
    input.evidence = [...input.evidence, fix("home-q-4", 44 + 26, { north: 5 }, 8), fix("home-q-5", 44 + 30, { north: 6 }, 8)];
    const homes = segments(input).filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === HOME_ID)
      .filter((stay) => minutes(stay.startedAt)! > 60);
    expect(homes).toHaveLength(2);
  });

  it("judges many short arrivals and same-place callbacks in bounded time (Codex r1 on #591)", () => {
    const evidence: LocationEvidence[] = [];
    for (let visit = 0; visit < 300; visit += 1) {
      const start = visit * 25;
      evidence.push(crossing(`enter-${visit}`, start, "geofence_enter", HOME_ID), fix(`in-${visit}-0`, start + 0.5, { north: 5 }, 8),
        fix(`in-${visit}-1`, start + 2, { north: 6 }, 8), fix(`in-${visit}-2`, start + 15, { north: 4 }, 8),
        crossing(`exit-${visit}`, start + 16, "geofence_exit", HOME_ID), fix(`out-${visit}`, start + 17, { north: 900 }, 8, { speedMetersPerSecond: 9 }));
    }
    const input: LocationEngineInput = { ...morning(), evidence, processingAt: at(300 * 25 + 60) };
    const started = performance.now();
    runLocationEngine(input);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

