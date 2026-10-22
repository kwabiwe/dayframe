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
