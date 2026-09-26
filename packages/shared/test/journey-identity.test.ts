import { describe, expect, it } from "vitest";
import {
  journeyIdentityFixture,
  LOCATION_ENGINE_V2_CONFIG,
  matchLocationToPlaces,
  runLocationEngine,
  type CommuteSegment,
  type StaySegment
} from "../src/location";

const fixture = journeyIdentityFixture();
const home = fixture.savedPlaces[1];
const learned = fixture.acceptedLearnedPlaces[0];

function homeStays(output: ReturnType<typeof runLocationEngine>) {
  return output.segmentUpserts.filter((segment): segment is StaySegment =>
    segment.kind === "stay" && segment.placeId === home.id
  );
}

function homeBoundary(stay: StaySegment) {
  return {
    clientSegmentId: stay.clientSegmentId,
    placeMatchKind: stay.placeMatchKind,
    placeId: stay.placeId,
    learnedPlaceId: stay.learnedPlaceId,
    startedAt: stay.startedAt,
    stoppedAt: stay.stoppedAt,
    startLowerBoundAt: stay.startLowerBoundAt,
    startUpperBoundAt: stay.startUpperBoundAt,
    stopLowerBoundAt: stay.stopLowerBoundAt,
    stopUpperBoundAt: stay.stopUpperBoundAt,
    evidenceIds: stay.evidenceIds
  };
}

describe("Journey-1 saved and learned identity", () => {
  it("retains the supported intermediate Home stop and pairs separate commutes", () => {
    const result = runLocationEngine(journeyIdentityFixture());
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const commutes = result.segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    const homes = homeStays(result);
    expect(homes).toHaveLength(2);
    expect(homes[0].startedAt).toBe("2026-09-23T16:55:30.000Z");
    expect(homes[0].stoppedAt).toBe("2026-09-23T17:16:30.000Z");
    expect(homes[1].startedAt).toBe("2026-09-23T19:49:00.000Z");
    expect(homes[0].clientSegmentId).not.toBe(homes[1].clientSegmentId);
    expect(stays).toHaveLength(3); // The brief station drop-off is not a stay.
    expect(commutes).toHaveLength(2);
    expect(commutes[0].toStaySegmentId).toBe(homes[0].clientSegmentId);
    expect(commutes[1].fromStaySegmentId).toBe(homes[0].clientSegmentId);
    expect(commutes[1].toStaySegmentId).toBe(homes[1].clientSegmentId);
    expect(commutes.every((commute) =>
      !(Date.parse(commute.startedAt) < Date.parse(homes[0].startedAt) &&
        Date.parse(commute.stoppedAt) > Date.parse(homes[0].stoppedAt!))
    )).toBe(true);
    expect(result.acceptedEvidence.find((item) => item.evidence.clientEvidenceId === "return-route-3")?.match)
      .toMatchObject({ kind: "saved", placeId: home.id });
    expect(result.acceptedEvidence.find((item) => item.evidence.clientEvidenceId === "home-visit")?.evidence.receivedAt)
      .toBe("2026-09-23T22:00:00.000Z");
  });

  it("matches the saved-only baseline and produces identical IDs and output on repeat", () => {
    const input = journeyIdentityFixture();
    const first = runLocationEngine(input);
    const second = runLocationEngine(journeyIdentityFixture());
    expect(second).toEqual(first);
    const savedOnly = runLocationEngine({ ...input, acceptedLearnedPlaces: [] });
    expect(homeStays(first).map(homeBoundary)).toEqual(homeStays(savedOnly).map(homeBoundary));
  });

  it("keeps weak coincident evidence ambiguous", () => {
    const match = matchLocationToPlaces(
      { latitude: 51.5, longitude: -0.0783, horizontalAccuracyMeters: 25 },
      [home], [learned], LOCATION_ENGINE_V2_CONFIG
    );
    expect(match).toMatchObject({ kind: "ambiguous", placeId: null });
    expect(match.candidates.map((candidate) => candidate.matchClass)).toEqual(["plausible", "plausible"]);
    const broadVisit = matchLocationToPlaces(
      { latitude: 51.5, longitude: learned.longitude, horizontalAccuracyMeters: 120 },
      [home], [learned], LOCATION_ENGINE_V2_CONFIG
    );
    expect(broadVisit).toMatchObject({ kind: "ambiguous", placeId: null });
    const onlyVisit = journeyIdentityFixture();
    onlyVisit.evidence = onlyVisit.evidence.filter((item) => item.clientEvidenceId === "home-visit");
    expect(runLocationEngine(onlyVisit).acceptedEvidence[0].match?.kind).toBe("ambiguous");

    const missingLateSupport = journeyIdentityFixture();
    missingLateSupport.evidence = missingLateSupport.evidence.filter((item) =>
      item.clientEvidenceId !== "home-late-1" && item.clientEvidenceId !== "home-late-2"
    );
    const unsupportedVisit = runLocationEngine(missingLateSupport).acceptedEvidence.find((item) =>
      item.evidence.clientEvidenceId === "home-visit"
    );
    expect(unsupportedVisit?.match?.kind).toBe("ambiguous");

    const unsupportedArrival = journeyIdentityFixture();
    unsupportedArrival.evidence = unsupportedArrival.evidence.filter((item) =>
      item.clientEvidenceId !== "home-final-2" && item.clientEvidenceId !== "home-final-3"
    );
    expect(runLocationEngine(unsupportedArrival).acceptedEvidence.find((item) =>
      item.evidence.clientEvidenceId === "return-route-3"
    )?.match?.kind).toBe("ambiguous");

    const contradictedArrival = journeyIdentityFixture();
    contradictedArrival.evidence.push({
      ...contradictedArrival.evidence.find((item) => item.clientEvidenceId === "home-final-1")!,
      clientEvidenceId: "contradictory-accurate-point",
      occurredAt: "2026-09-23T19:53:00.000Z",
      longitude: -0.07
    });
    expect(runLocationEngine(contradictedArrival).acceptedEvidence.find((item) =>
      item.evidence.clientEvidenceId === "return-route-3"
    )?.match?.kind).toBe("ambiguous");
  });

  it("does not collapse distinct nearby saved and learned candidates", () => {
    const distinct = { ...learned, longitude: -0.0786 };
    const match = matchLocationToPlaces(
      { latitude: 51.5, longitude: -0.0788, horizontalAccuracyMeters: 25 },
      [home], [distinct], LOCATION_ENGINE_V2_CONFIG
    );
    expect(match).toMatchObject({ kind: "learned", placeId: distinct.id });
  });

  it("preserves explicit continuity and correction priority over the canonical default", () => {
    const point = { latitude: 51.5, longitude: learned.longitude, horizontalAccuracyMeters: 25 };
    expect(matchLocationToPlaces(
      { ...point, activePlaceId: learned.id }, [home], [learned], LOCATION_ENGINE_V2_CONFIG
    )).toMatchObject({ kind: "learned", placeId: learned.id });
    expect(matchLocationToPlaces(
      point, [home], [{ ...learned, correctionScore: 8 }], LOCATION_ENGINE_V2_CONFIG
    )).toMatchObject({ kind: "learned", placeId: learned.id });
    const corrected = journeyIdentityFixture();
    corrected.acceptedLearnedPlaces = [{ ...learned, correctionScore: 8 }];
    const output = runLocationEngine(corrected);
    expect(output.acceptedEvidence.find((item) =>
      item.evidence.clientEvidenceId === "home-final-1"
    )?.match).toMatchObject({ kind: "learned", placeId: learned.id });
  });

  it("preserves learned-only matching", () => {
    const match = matchLocationToPlaces(
      { latitude: 51.5, longitude: learned.longitude, horizontalAccuracyMeters: 25 },
      [], [learned], LOCATION_ENGINE_V2_CONFIG
    );
    expect(match).toMatchObject({ kind: "learned", placeId: learned.id });
    const learnedOnly = journeyIdentityFixture();
    learnedOnly.savedPlaces = [learnedOnly.savedPlaces[0]];
    const output = runLocationEngine(learnedOnly);
    expect(output.acceptedEvidence.find((item) =>
      item.evidence.clientEvidenceId === "home-final-1"
    )?.match).toMatchObject({ kind: "learned", placeId: learned.id });
  });
});
