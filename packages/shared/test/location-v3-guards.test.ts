import { describe, expect, it } from "vitest";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { SCHOOL_VISIT_SCHOOL_ID, schoolVisitAt, schoolVisitFixture } from "../src/location/schoolVisitFixture";
import type { CommuteSegment, LocationEngineInput, LocationEvidence, StaySegment } from "../src/location/types";

// Synthetic shapes for the two engine guards of location v3 (16 Oct 2026). Distances are relative
// metres from an arbitrary origin; nothing here is a real place.
const OLD_HOME = "10000000-0000-4000-8000-0000000003a1";
const NEW_HOME = "10000000-0000-4000-8000-0000000003a2";
const DEVICE = "20000000-0000-4000-8000-0000000003a1";
const t0 = Date.parse("2026-10-14T07:00:00Z");
const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
const deg = (metres: number) => metres / 111_195;

function fix(id: string, minutes: number, y: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: config.algorithmVersion, kind: "standard_location",
    occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(minutes + 0.5), timeZone: "UTC", endedAt: null,
    latitude: deg(y), longitude: 0, horizontalAccuracyMeters: 5, speedMetersPerSecond: 0, savedPlaceId: null,
    isSimulated: false, metadata: {}, ...patch
  };
}
const crossing = (id: string, minutes: number, placeId: string, kind: "geofence_enter" | "geofence_exit") =>
  fix(id, minutes, 0, { kind, savedPlaceId: placeId, latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null });
const engine = (evidence: LocationEvidence[], savedPlaces: LocationEngineInput["savedPlaces"], processingMinutes: number) =>
  runLocationEngine({
    priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
    config, processingAt: at(processingMinutes), acceptedLearnedPlaces: [], evidence, savedPlaces
  }).segmentUpserts;

/**
 * Bug 11. Two overlapping circles of one home (the old pin and a new one 154 m away, both 100 m); the
 * phone rests inside the old one. A drive 2.4 km out, a six-minute stop and back: on the way back the
 * car crosses the new circle and then enters the old one 14 s before parking.
 */
function overlappingHomes() {
  const places = [
    { id: OLD_HOME, name: "Old home", latitude: 0, longitude: 0, radiusMeters: 100, loggingEnabled: true },
    { id: NEW_HOME, name: "Home", latitude: deg(154), longitude: 0, radiusMeters: 100, loggingEnabled: true }
  ];
  const evidence: LocationEvidence[] = [];
  for (let minute = 0; minute <= 25; minute += 5) evidence.push(fix(`rest-${minute}`, minute, 9));
  let clock = 28;
  let y = 9;
  const drive = (prefix: string, to: number, speed: number, events: Array<[number, string, "geofence_enter" | "geofence_exit"]>) => {
    const pending = [...events];
    let step = 0;
    while (y !== to) {
      const next = to > y ? Math.min(to, y + 60) : Math.max(to, y - 60);
      for (const [edge, placeId, kind] of [...pending]) {
        if ((to > y && edge > y && edge <= next) || (to < y && edge < y && edge >= next)) {
          evidence.push(crossing(`${prefix}-${kind}-${placeId.slice(-2)}`, clock + Math.abs(edge - y) / speed / 60, placeId, kind));
          pending.splice(pending.indexOf(pending.find(([e, p, k]) => e === edge && p === placeId && k === kind)!), 1);
        }
      }
      clock += Math.abs(next - y) / speed / 60;
      y = next;
      evidence.push(fix(`${prefix}-${step++}`, clock, y, { speedMetersPerSecond: y === to ? 0 : speed }));
    }
  };
  drive("out", 2_400, 7, [[54, NEW_HOME, "geofence_enter"], [100, OLD_HOME, "geofence_exit"], [254, NEW_HOME, "geofence_exit"]]);
  for (const minute of [1, 2.5, 4, 5.5]) evidence.push(fix(`stop-${minute}`, clock + minute, 2_400));
  clock += 6;
  drive("back", 129, 7, [[254, NEW_HOME, "geofence_enter"]]);
  // Into the old circle (y < 100) through the overlap, where readings nearer the new pin still
  // match it while the car rolls in; then parked inside the old circle, 14 s after its entry.
  const entryAt = clock + (129 - 100) / 7 / 60;
  evidence.push(crossing("back-enter-old", entryAt, OLD_HOME, "geofence_enter"));
  for (const [index, [seconds, y]] of ([[2, 93], [4, 87], [6, 81]] as const).entries()) {
    evidence.push(fix(`back-overlap-${index}`, entryAt + seconds / 60, y, { speedMetersPerSecond: 3 }));
  }
  evidence.push(crossing("back-exit-new", entryAt + 9 / 60, NEW_HOME, "geofence_exit"));
  clock = entryAt + 14 / 60;
  evidence.push(fix("back-parked", clock, 9));
  const parkedAt = clock;
  for (let minute = 1; minute <= 41; minute += 5) evidence.push(fix(`home-${minute}`, parkedAt + minute, 9));
  return { evidence, places, parkedAt };
}

describe("location v3 engine guards", () => {
  it("bug 11: a return-side entry into an overlapping old home circle is never the departure", () => {
    const { evidence, places, parkedAt } = overlappingHomes();
    const segments = engine(evidence, places, parkedAt + 120);
    const journeys = segments.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    expect(journeys.map((journey) => journey.qualificationReason)).toEqual(["same_place_meaningful_round_trip"]);
    const [trip] = journeys;
    expect(trip.fromPlaceId).toBe(OLD_HOME);
    expect(trip.toPlaceId).toBe(OLD_HOME);
    // The whole outing, from leaving to parking (not the last 14 seconds).
    expect(Date.parse(trip.startedAt)).toBeLessThanOrEqual(t0 + 28.5 * 60_000);
    expect(Date.parse(trip.stoppedAt)).toBeGreaterThanOrEqual(t0 + (parkedAt - 0.5) * 60_000);
    expect(trip.confidence).toBe("medium_high");
  });

  // Bug 8: the 4 Oct school stop (`schoolVisitFixture`), whose completed iOS Visit is broad (94 m), with
  // accurate fixes added across the whole stay, as on the staging day (about twenty 3–33 m fixes under
  // a 73 m Visit). The fixture as it is (three fixes in its first two minutes) stays medium:
  // arrival-presence.test.ts › "keeps broad support inferred".
  const accuratelyCoveredSchoolStop = (gapFrom?: string, gapTo?: string) => {
    const input = schoolVisitFixture();
    const template = input.evidence.find((item) => item.clientEvidenceId === "stop-0")!;
    for (let minute = 57; minute <= 77; minute += 2) {
      const time = `${minute < 60 ? "06" : "07"}:${String(minute % 60).padStart(2, "0")}:10`;
      if (gapFrom && gapTo && time > gapFrom && time < gapTo) continue;
      input.evidence.push({ ...template, clientEvidenceId: `stop-fix-${minute}`, occurredAt: schoolVisitAt(time),
        sourceTimestamp: schoolVisitAt(time), receivedAt: schoolVisitAt(time), horizontalAccuracyMeters: 3 + (minute % 10) * 3,
        speedMetersPerSecond: 0 });
    }
    return runLocationEngine(input).segmentUpserts
      .filter((segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === SCHOOL_VISIT_SCHOOL_ID);
  };

  it("bug 8: accurate readings across the whole stay outweigh a broad completed Visit", () => {
    const [stay] = accuratelyCoveredSchoolStop();
    expect(stay).toMatchObject({ startedAt: schoolVisitAt("06:53:00"), stoppedAt: schoolVisitAt("07:17:43"),
      confidence: "medium_high" });
    expect(assessAutomaticLocation("v2_enabled", stay)).toMatchObject({ action: "auto_confirm" });
  });

  it("bug 8: a broad Visit still caps the stay at medium when accurate readings leave a gap over the continuity limit", () => {
    const [stay] = accuratelyCoveredSchoolStop("06:59:00", "07:13:00");
    expect(stay).toMatchObject({ confidence: "medium" });
  });
});
