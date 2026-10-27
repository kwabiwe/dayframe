import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, LocationEvidence, MotionActivity, StaySegment } from "../src/location/types";

// Card J (owner, 27 Oct 2026): a drive, a meal with the phone still and silent for over an hour, the drive
// home. Synthetic geometry only: Home at the origin, the restaurant 5 km north (no saved place there).
const HOME_ID = "10000000-0000-4000-8000-0000000000c1";
const DEVICE = "20000000-0000-4000-8000-0000000000c1";
const t0 = Date.parse("2026-03-10T17:00:00Z");
const at = (minute: number) => new Date(t0 + Math.round(minute * 60_000)).toISOString();
const minuteOf = (iso: string | null | undefined) => Math.round((Date.parse(iso ?? "") - t0) / 6_000) / 10;
const north = (metres: number) => metres / 111_195;

function fix(id: string, minute: number, northMetres: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(minute + 1), timeZone: "UTC", endedAt: null,
    latitude: north(northMetres), longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}

type Step = [minute: number, activity: MotionActivity, confidence?: "low" | "medium" | "high"];

function motion(steps: Step[], queriedAtMinute: number): LocationEvidence[] {
  return steps.map(([minute, activity, confidence = "high"], index) => ({
    clientEvidenceId: `motion-${index}`, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "motion_activity",
    occurredAt: at(minute), sourceTimestamp: at(minute), receivedAt: at(Math.max(minute, queriedAtMinute)), timeZone: "UTC",
    endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null,
    savedPlaceId: null, isSimulated: null, metadata: { motionActivity: activity, motionConfidence: confidence }
  }));
}

const home = { id: HOME_ID, name: "Home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true };

type Shape = {
  /** Where the readings after the silence are (metres north). */
  afterNorth?: number;
  /** Core Motion through the silence; null records none at all. */
  silenceMotion?: Step[] | null;
  /** A geofence crossing inside the silence. */
  crossingAt?: number;
  /** A broad fix inside the silence, this far north: it was not silent. */
  broadFixNorth?: number;
  /** A reading too broad to accept inside the silence: it was not silent either. */
  rejectedFixNorth?: number;
  /** No iOS Visit for the meal. */
  noVisit?: boolean;
  /** Slow readings right after parking, so the stop's own cluster spans the silence. */
  parkedSlow?: boolean;
  /** A credible Visit somewhere else during the silence, from and to these minutes. */
  visitElsewhere?: [number, number];
};

function evening(shape: Shape = {}) {
  const after = shape.afterNorth ?? 5_020;
  const evidence: LocationEvidence[] = [
    ...[0, 15, 30, 45, 60].map((m, i) => fix(`home-${i}`, m, i % 2 * 3)),
    // The drive there, 61–76.
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => fix(`there-${i}`, 62 + i, 300 + i * 340, { speedMetersPerSecond: 12 })),
    fix("park-0", 76.3, 4_980, { speedMetersPerSecond: 9.6 }),
    fix("park-1", 77.1, 5_000, { speedMetersPerSecond: 3.4 }),
    fix("park-2", 77.6, 5_040, { speedMetersPerSecond: 1.9 }),
    // iOS saw the Visit: its arrival, then its completion when the phone left.
    ...(shape.noVisit ? [] : [
      fix("visit-arrival", 75, 5_030, { kind: "visit", horizontalAccuracyMeters: 39, speedMetersPerSecond: null }),
      fix("visit-complete", 75, 5_020, { kind: "visit", endedAt: at(164.2), horizontalAccuracyMeters: 83, speedMetersPerSecond: null, receivedAt: at(165) })
    ]),
    ...(shape.parkedSlow ? [fix("parked-0", 78, 5_025, { speedMetersPerSecond: 0.3 }), fix("parked-1", 79, 5_018, { speedMetersPerSecond: 0 })] : []),
    ...(shape.visitElsewhere ? [fix("visit-elsewhere", shape.visitElsewhere[0], 6_520, {
      kind: "visit", endedAt: at(shape.visitElsewhere[1]), horizontalAccuracyMeters: 30, speedMetersPerSecond: null, receivedAt: at(shape.visitElsewhere[1] + 1)
    })] : []),
    // Nothing until 152, then a few slow fixes before leaving.
    fix("table-0", 152.2, after + 40, { speedMetersPerSecond: 1.3, horizontalAccuracyMeters: 9 }),
    fix("table-1", 162.0, after, { speedMetersPerSecond: null, horizontalAccuracyMeters: 22 }),
    fix("table-2", 162.05, after + 70, { speedMetersPerSecond: 0, horizontalAccuracyMeters: 20 }),
    fix("table-3", 162.15, after + 5, { speedMetersPerSecond: 0.2 }),
    // The drive home, 165–175, then Home.
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => fix(`back-${i}`, 165 + i, after - 480 - i * 480, { speedMetersPerSecond: 12 })),
    ...[176, 190, 205, 220].map((m, i) => fix(`home-late-${i}`, m, i % 2 * 3)),
    ...(shape.broadFixNorth == null ? [] : [fix("broad", 120, shape.broadFixNorth, { horizontalAccuracyMeters: 120, speedMetersPerSecond: null })]),
    ...(shape.rejectedFixNorth == null ? [] : [fix("rejected", 120, shape.rejectedFixNorth, { horizontalAccuracyMeters: 250, speedMetersPerSecond: null })]),
    ...(shape.crossingAt == null ? [] : [fix("crossing", shape.crossingAt, 0, {
      kind: "geofence_exit", savedPlaceId: HOME_ID, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null
    })])
  ];
  const silence = shape.silenceMotion === undefined
    ? [[78.5, "unknown"], [79.2, "walking"], [82.5, "stationary"], [90, "unknown"], [90.2, "stationary"], [111, "walking"],
      [111.2, "stationary"], [150, "walking"]] as Step[]
    : shape.silenceMotion;
  if (silence) {
    evidence.push(...motion([[55, "stationary"], [61, "automotive"], ...silence, [164.5, "automotive"], [175.5, "stationary"]], 230));
  }
  const input: LocationEngineInput = {
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(230), evidence, savedPlaces: [home], acceptedLearnedPlaces: []
  };
  const output = runLocationEngine(input);
  return {
    stays: output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay"),
    trips: output.segmentUpserts.filter((s): s is CommuteSegment => s.kind === "commute")
  };
}

const restaurant = (stays: StaySegment[]) => stays.filter((stay) => stay.placeId == null && minuteOf(stay.startedAt) > 70 && minuteOf(stay.startedAt) < 160);

describe("a still silence inside a trip is a stop (card J)", () => {
  it("makes the meal a stay between two trips when Core Motion saw the phone still through the silence", () => {
    const { stays, trips } = evening();
    const meal = restaurant(stays);
    expect(meal).toHaveLength(1);
    expect(minuteOf(meal[0].startedAt)).toBeGreaterThanOrEqual(77);
    expect(minuteOf(meal[0].startedAt)).toBeLessThanOrEqual(80);
    expect(minuteOf(meal[0].stoppedAt)).toBeGreaterThanOrEqual(162);
    expect(minuteOf(meal[0].stoppedAt)).toBeLessThanOrEqual(165);
    // The drive there ends at the meal and the drive home starts from it: no trip runs through it.
    expect(trips.some((trip) => minuteOf(trip.startedAt) < 100 && minuteOf(trip.stoppedAt) > 150)).toBe(false);
    expect(trips.filter((trip) => minuteOf(trip.stoppedAt) <= 80 || minuteOf(trip.startedAt) >= 162)).toHaveLength(2);
  });

  it("starts the meal when Core Motion saw the car stop, with no Visit to time it (Codex r1 on #601)", () => {
    const meal = restaurant(evening({ noVisit: true }).stays);
    expect(meal).toHaveLength(1);
    expect(minuteOf(meal[0].startedAt)).toBeGreaterThanOrEqual(77);
    expect(minuteOf(meal[0].startedAt)).toBeLessThanOrEqual(80);
    expect(minuteOf(meal[0].stoppedAt)).toBeGreaterThanOrEqual(162);
  });

  it("bridges the silence inside the stop's own readings, before and after it", () => {
    const meal = restaurant(evening({ parkedSlow: true, noVisit: true }).stays);
    expect(meal).toHaveLength(1);
    expect(minuteOf(meal[0].startedAt)).toBeLessThanOrEqual(80);
    expect(minuteOf(meal[0].stoppedAt)).toBeGreaterThanOrEqual(162);
  });

  it.each([
    ["the phone was driving through the silence", { silenceMotion: [[78.5, "automotive"], [120, "stationary"], [150, "walking"]] as Step[] }],
    ["Core Motion knew nothing in the silence", { silenceMotion: [[78.5, "unknown"]] as Step[] }],
    ["a low-confidence drive filled the silence", { silenceMotion: [[78.5, "automotive", "low"], [150, "walking"]] as Step[] }],
    ["the phone was walking through the silence", { silenceMotion: [[78.5, "walking"]] as Step[] }],
    ["the phone was still only at times, between long unknown spells",
      { silenceMotion: [[78.5, "stationary"], [90, "unknown"], [125, "stationary"], [150, "walking"]] as Step[] }],
    ["a credible Visit elsewhere came in the silence", {
      visitElsewhere: [100, 111] as [number, number],
      silenceMotion: [[78.5, "stationary"], [97, "automotive"], [99, "stationary"], [111, "automotive"], [113, "stationary"], [150, "walking"]] as Step[]
    }],
    ["a reading too broad to accept came in the silence", { rejectedFixNorth: 5_300 }],
    ["there was no Visit and the phone was driving", { noVisit: true, silenceMotion: [[78.5, "automotive"], [150, "walking"]] as Step[] }],
    ["the stop's own readings span a silence the phone walked through", { parkedSlow: true, noVisit: true, silenceMotion: [[78.5, "walking"]] as Step[] }],
    ["Core Motion recorded nothing", { silenceMotion: null }],
    ["a geofence was crossed in the silence", { crossingAt: 120 }],
    ["the readings after the silence are far from those before it", { afterNorth: 5_600 }],
    ["a fix, however broad, came in the silence", { broadFixNorth: 5_300 }]
  ])("keeps today's behaviour when %s", (_label, shape) => {
    const { stays } = evening(shape);
    expect(restaurant(stays).filter((stay) => minuteOf(stay.startedAt) < 100)).toEqual([]);
  });
});
