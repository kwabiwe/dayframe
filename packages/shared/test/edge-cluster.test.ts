import { describe, expect, it } from "vitest";
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
  const template = input.evidence.find((item) => item.clientEvidenceId === "parked-1")!;
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
    expect(parked(run(input).stays)).toEqual([expect.objectContaining({
      startedAt: at("19:13:16"), stoppedAt: expect.stringMatching(/T19:36:41\./), placeMatchKind: "saved", placeId: SCHOOL_EDGE_SCHOOL_ID
    })]);
  });

  it("does not let the drive away (moving fixes and a geofence entry) decide the identity", () => {
    // The fixture's drive home crosses the circle at 86–91 m with a School geofence entry.
    const [stay] = parked(run(schoolEdgeStopFixture("20:30:00")).stays);
    expect(stay.evidenceIds).toEqual(expect.arrayContaining(["away-0", "school-enter-1936"]));
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
});
