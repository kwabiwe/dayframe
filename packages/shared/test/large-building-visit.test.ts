import { describe, expect, it } from "vitest";
import { distanceMeters } from "../src/location/geo";
import {
  LARGE_BUILDING_FAR_FIX_ID as FAR_FIX,
  largeBuildingAt as at,
  largeBuildingVisitFixture as fixture,
  type LargeBuildingShape
} from "../src/location/largeBuildingVisitFixture";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEvidence, StaySegment } from "../src/location/types";

function run(shape: LargeBuildingShape = {}) {
  const input = fixture(shape);
  const output = runLocationEngine(input);
  const stays = output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay");
  return {
    input,
    building: stays.find((stay) => stay.placeMatchKind === "unknown" && stay.startedAt === at(68))!,
    moves: output.segmentUpserts.filter((s): s is CommuteSegment => s.kind === "commute")
  };
}
const point = (item: LocationEvidence) => ({ latitude: item.latitude!, longitude: item.longitude! });

describe("unknown stay inside its own completed iOS Visit (large building)", () => {
  it("keeps one stay across sparse fixes and walking up to the Visit's departure", () => {
    const { input, building } = run();
    const byId = new Map(input.evidence.map((item) => [item.clientEvidenceId, item]));
    const far = byId.get(FAR_FIX)!;
    // The fixture's far fix is beyond the 120 m same-place radius of the arrival cluster but inside
    // the Visit's 104 m radius plus its own 13 m accuracy, and it was taken walking.
    expect(distanceMeters(point(byId.get("building-arrival-0")!), point(far))).toBeGreaterThan(150);
    expect(distanceMeters(point(byId.get("building-arrival-0")!), point(far))).toBeLessThan(170);
    expect(distanceMeters(point(byId.get("building-visit")!), point(far))).toBeLessThan(104 + 13);
    expect(far.speedMetersPerSecond).toBeGreaterThan(1.5);
    expect(building).toMatchObject({ startedAt: at(68), stoppedAt: at(297.5), status: "finalised" });
    expect(building.evidenceIds).toEqual(expect.arrayContaining([FAR_FIX, "building-quiet-2", "building-quiet-3"]));
  });

  it("produces no Move inside the building, only the journey home after the Visit's departure", () => {
    const { building, moves } = run();
    expect(moves.filter((move) => Date.parse(move.startedAt) < Date.parse(building.stoppedAt!) &&
      Date.parse(move.stoppedAt!) > Date.parse(building.startedAt))).toEqual([]);
    expect(moves.find((move) => move.fromStaySegmentId === building.clientSegmentId))
      .toMatchObject({ startedAt: at(297.5), stoppedAt: at(313) });
  });

  it("still ends the stay at a far fix after the Visit's departure", () => {
    const { building } = run({ visitEndsAt: 170 });
    expect(building.stoppedAt).toBe(at(170));
    expect(building.evidenceIds).not.toContain(FAR_FIX);
  });

  it("still ends the stay at an accurate fix beyond the Visit's radius", () => {
    const { building } = run({ farFixNorth: 240 });
    expect(Date.parse(building.stoppedAt!)).toBeLessThan(Date.parse(at(175)));
    expect(building.evidenceIds).not.toContain(FAR_FIX);
  });

  it("never lets a broad fix or an arrival-only Visit hold the stay together", () => {
    for (const shape of [{ farFixAccuracy: 80 }, { visitEndsAt: null }] satisfies LargeBuildingShape[]) {
      const { building } = run(shape);
      expect(Date.parse(building.stoppedAt!)).toBeLessThan(Date.parse(at(175)));
      expect(building.evidenceIds).not.toContain(FAR_FIX);
    }
  });
});

// Synthetic relative-metre geometry on a made-up equatorial origin; minutes after an arbitrary origin.
const ORIGIN_MS = Date.UTC(2026, 0, 19, 9);
const atMinute = (minutes: number) => new Date(ORIGIN_MS + Math.round(minutes * 60_000)).toISOString();
const DEVICE = "20000000-0000-4000-8000-000000000032";
function reading(id: string, minutes: number, north: number, accuracy: number, patch: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    clientEvidenceId: id, deviceId: DEVICE, algorithmVersion: fixture().config.algorithmVersion,
    kind: "standard_location", occurredAt: atMinute(minutes), sourceTimestamp: atMinute(minutes), receivedAt: atMinute(minutes),
    timeZone: "UTC", latitude: north / 110_574, longitude: 0, horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: 0, isSimulated: false, ...patch
  };
}
const visitAt = (id: string, minutes: number, endsAt: number, north: number, accuracy: number) =>
  reading(id, minutes, north, accuracy, { kind: "visit", endedAt: atMinute(endsAt), speedMetersPerSecond: null, receivedAt: atMinute(endsAt) });
function runEvidence(evidence: LocationEvidence[], processingMinutes: number) {
  const base = fixture();
  const output = runLocationEngine({ ...base, savedPlaces: [], evidence, processingAt: atMinute(processingMinutes) });
  return output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay");
}

describe("which completed Visit covers a reading", () => {
  // Visit A (broad, 0–120) holds a narrower Visit B (30–60) at the same centre. B is iOS's latest
  // completed judgement: after B's departure the older, broader A no longer holds the stay together.
  const nested = (withNarrow: boolean) => [
    visitAt("visit-a", 0, 120, 0, 200),
    ...[1, 4, 7, 10, 13, 16, 19, 22, 25, 28].map((m) => reading(`core-${m}`, m, 0, 10)),
    ...(withNarrow ? [visitAt("visit-b", 30, 60, 0, 20)] : []),
    ...[31, 35, 40, 45, 50, 55, 59].map((m) => reading(`core-${m}`, m, 0, 10)),
    ...[70, 75, 80, 85, 90, 95].map((m) => reading(`far-${m}`, m, 220, 65))
  ];
  const farIds = [70, 75, 80, 85, 90, 95].map((m) => `far-${m}`);

  it("ends cover from an older Visit at a newer, nested Visit's departure", () => {
    // Control: with only the broad Visit, the far readings lie within its circle before its departure.
    const broadOnly = runEvidence(nested(false), 240);
    expect(broadOnly.find((stay) => stay.startedAt === atMinute(0))!.evidenceIds).toEqual(expect.arrayContaining(farIds));
    expect(broadOnly.find((stay) => stay.startedAt === atMinute(70))).toBeUndefined();
    const stays = runEvidence(nested(true), 240);
    const first = stays.find((stay) => stay.startedAt === atMinute(0))!;
    for (const id of farIds) expect(first.evidenceIds).not.toContain(id);
    expect(stays.find((stay) => stay.startedAt === atMinute(70))?.evidenceIds).toEqual(expect.arrayContaining(farIds));
  });

  it("never lets a Visit-kept reading move the centre that ordinary continuation is measured from", () => {
    // The Visit (0 m, 200 m accuracy) ends at 60. The +190 m fix is kept only by the Visit; the
    // +270 m fix comes after the departure and outside the Visit's circle, so it starts a new stay.
    const stays = runEvidence([
      visitAt("drift-visit", 0, 60, 0, 200),
      ...[1, 2, 3].map((m) => reading(`drift-core-${m}`, m, -70, 65)),
      reading("drift-kept", 30, 190, 5),
      ...[65, 70, 75, 80].map((m) => reading(`drift-after-${m}`, m, 270, 10))
    ], 240);
    const first = stays.find((stay) => stay.startedAt === atMinute(0))!;
    expect(first.evidenceIds).toContain("drift-kept");
    expect(first.evidenceIds).not.toContain("drift-after-65");
    expect(stays.find((stay) => stay.startedAt === atMinute(65))?.evidenceIds).toEqual(expect.arrayContaining(["drift-after-65", "drift-after-80"]));
  });
});
