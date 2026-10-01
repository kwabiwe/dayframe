import { describe, expect, it } from "vitest";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import { detectPhysicalStops } from "../src/location/physicalStops";
import { runLocationEngine } from "../src/location/segmenter";
import type { CommuteSegment, LocationEngineInput, StaySegment } from "../src/location/types";
import { PHYSICAL_STOP_PICKUP as PICKUP, physicalStopFixture, type PhysicalStopShape as StopShape } from "../src/location/physicalStopFixture";
import { shortAt, shortJourneysFixture } from "./fixtures/shortJourneys";

function run(input: LocationEngineInput) {
  const output = runLocationEngine(input);
  return {
    output,
    stays: output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay"),
    trips: output.segmentUpserts.filter((s): s is CommuteSegment => s.kind === "commute"),
    physical: output.segmentUpserts.filter((s): s is StaySegment => s.kind === "stay" && s.formation === "physical_stop")
  };
}
const shape = (patch: Partial<StopShape>): StopShape => ({ ...PICKUP, ...patch });

describe("physical stops", () => {
  it("keeps a corroborated pickup inside one Home trip instead of reporting it as travel", () => {
    const { physical, trips, stays } = run(physicalStopFixture(PICKUP));
    expect(physical).toHaveLength(1);
    const [stop] = physical;
    // Movement bounds the stop; the Visit's earlier arrival estimate is clamped to the observed parking fix.
    expect(stop).toMatchObject({
      startedAt: shortAt(675_000), stoppedAt: shortAt(1_220_000),
      startLowerBoundAt: shortAt(675_000), startUpperBoundAt: shortAt(860_000),
      stopLowerBoundAt: shortAt(952_000), stopUpperBoundAt: shortAt(1_224_000),
      placeMatchKind: "unknown", placeId: null, approximateArrival: true, sampleCount: 5,
      continuityStatus: "supported_by_visit"
    });
    expect(trips).toHaveLength(1);
    const [trip] = trips;
    expect(trip).toMatchObject({
      startedAt: shortAt(600_000), stoppedAt: shortAt(1_308_000),
      fromStaySegmentId: stays[0].clientSegmentId, toStaySegmentId: stays.at(-1)!.clientSegmentId,
      qualificationReason: "same_place_meaningful_round_trip"
    });
    expect(trip.stops).toEqual([{
      staySegmentId: stop.clientSegmentId, startedAt: stop.startedAt, stoppedAt: stop.stoppedAt,
      startLowerBoundAt: stop.startLowerBoundAt, startUpperBoundAt: stop.startUpperBoundAt,
      stopLowerBoundAt: stop.stopLowerBoundAt, stopUpperBoundAt: stop.stopUpperBoundAt,
      candidatePlaceIds: []
    }]);
    expect(trip.evidenceIds).not.toEqual(expect.arrayContaining(stop.evidenceIds));
    expect(assessAutomaticLocation("v2_enabled", trip)).toMatchObject({ action: "review", reason: "journey_contains_stop" });
    expect(assessAutomaticLocation("v2_review", trip)).toMatchObject({ action: "review", reason: "review_mode" });
  });

  it("keeps the trip identity of the former round trip so open Reviews are not replaced", () => {
    const withStop = run(physicalStopFixture(PICKUP)).trips[0];
    const brief = run(physicalStopFixture(shape({ slowAt: [900_000, 901_000] }))).trips[0];
    expect(brief.stops).toBeUndefined();
    expect(withStop.clientSegmentId).toBe(brief.clientSegmentId);
  });

  // Owner-labelled 28/29 Sep stops: ~30–60 s on the kerb while iOS reported 5–7 minute Visits.
  it.each([
    ["30-second pickup: Visit plus two fixes one second apart", shape({ visit: [670_000, 1_042_000], slowAt: [900_000, 901_000], departAt: 1_046_000, returnAt: 1_130_000 })],
    ["1-minute drop-off: Visit plus one slow fix", shape({ visit: [670_000, 967_000], slowAt: [760_000], departAt: 971_000, returnAt: 1_055_000 })],
    ["traffic light without a Visit", shape({ visit: null, slowAt: [700_000, 790_000], departAt: 800_000, returnAt: 884_000 })],
    ["slow fixes broken by vehicle movement inside the radius", shape({ slowAt: [860_000, 950_000], extra: [{ at: 900_000, speed: 5 }] })],
    ["broad-accuracy slow fixes", shape({ slowAccuracy: 120 })],
    ["three unanchored slow fixes over less than three minutes", shape({ visit: null, slowAt: [700_000, 760_000, 850_000] })]
  ])("does not create a stop for %s", (_label, stopShape) => {
    const { physical, trips } = run(physicalStopFixture(stopShape));
    expect(physical).toEqual([]);
    expect(trips.every((trip) => !trip.stops)).toBe(true);
  });

  it("accepts three slow fixes spread over three minutes without a Visit", () => {
    const { physical, trips } = run(physicalStopFixture(shape({ visit: null, slowAt: [700_000, 800_000, 900_000] })));
    expect(physical).toHaveLength(1);
    expect(physical[0]).toMatchObject({ startedAt: shortAt(687_500), continuityStatus: "continuous" });
    expect(trips).toHaveLength(1);
    expect(trips[0].stops).toHaveLength(1);
  });

  it("requires observed movement on both sides", () => {
    const unbounded = physicalStopFixture(shape({ departAt: undefined, returnAt: undefined }));
    expect(run(unbounded).physical).toEqual([]);
  });

  it("splits journeys around a stop long enough to be its own visit", () => {
    const { stays, trips } = run(physicalStopFixture(shape({
      visit: [670_000, 2_200_000], slowAt: [860_000, 1_200_000, 1_800_000], departAt: 2_204_000, returnAt: 2_288_000
    })));
    expect(trips).toHaveLength(2);
    expect(trips.every((trip) => !trip.stops)).toBe(true);
    expect(trips.some((trip) => trip.qualificationReason === "same_place_meaningful_round_trip")).toBe(false);
    const stop = stays.find((stay) => stay.clientSegmentId === trips[0].toStaySegmentId)!;
    expect(trips[1].fromStaySegmentId).toBe(stop.clientSegmentId);
    expect(stop.placeMatchKind).toBe("unknown");
    expect(Date.parse(stop.stoppedAt!) - Date.parse(stop.startedAt)).toBeGreaterThanOrEqual(config.unknownStayReviewDwellMs);
  });

  it("does not add a physical stop where a promoted saved-place stay already exists", () => {
    const { physical, trips } = run(shortJourneysFixture(true));
    expect(physical).toEqual([]);
    expect(trips).toHaveLength(2);
  });

  it("is deterministic for any input order and ignores mirrored callbacks", () => {
    const input = physicalStopFixture(PICKUP);
    const baseline = runLocationEngine(input);
    expect(runLocationEngine({ ...input, evidence: [...input.evidence].reverse() })).toEqual(baseline);
    const mirrored = { ...input, evidence: [...input.evidence, ...input.evidence
      .filter((e) => e.clientEvidenceId.startsWith("slow-"))
      .map((e) => ({ ...e, clientEvidenceId: `mirror-${e.clientEvidenceId}`, kind: "significant_change" as const, speedMetersPerSecond: null }))] };
    const output = runLocationEngine(mirrored);
    const stopOf = (o: typeof baseline) => o.segmentUpserts.find((s) => s.kind === "stay" && s.formation === "physical_stop") as StaySegment;
    expect(stopOf(output)).toMatchObject({
      startedAt: stopOf(baseline).startedAt, stoppedAt: stopOf(baseline).stoppedAt, sampleCount: stopOf(baseline).sampleCount
    });
  });

  it("exposes only accurate, non-simulated position fixes to detection", () => {
    const input = physicalStopFixture(PICKUP);
    input.evidence.forEach((e) => { if (e.clientEvidenceId.startsWith("slow-")) e.isSimulated = true; });
    expect(detectPhysicalStops(runLocationEngine(input).acceptedEvidence, config)).toEqual([]);
  });
});
