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

describe("Journey-1 saved and learned identity", () => {
  it("retains the supported intermediate Home stop and pairs separate commutes", () => {
    const result = runLocationEngine(journeyIdentityFixture());
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const commutes = result.segmentUpserts.filter((segment): segment is CommuteSegment => segment.kind === "commute");
    const homeStays = stays.filter((stay) => stay.placeId === home.id);
    expect(homeStays).toHaveLength(2);
    expect(homeStays[0].startedAt).toBe("2026-09-23T16:55:30.000Z");
    expect(homeStays[0].stoppedAt).toBe("2026-09-23T17:16:30.000Z");
    expect(homeStays[1].startedAt).toBe("2026-09-23T19:51:48.000Z");
    expect(homeStays[0].clientSegmentId).not.toBe(homeStays[1].clientSegmentId);
    expect(stays).toHaveLength(3); // The brief station drop-off is not a stay.
    expect(commutes).toHaveLength(2);
    expect(commutes[0].toStaySegmentId).toBe(homeStays[0].clientSegmentId);
    expect(commutes[1].fromStaySegmentId).toBe(homeStays[0].clientSegmentId);
    expect(commutes[1].toStaySegmentId).toBe(homeStays[1].clientSegmentId);
    expect(commutes.every((commute) => Date.parse(commute.stoppedAt) - Date.parse(commute.startedAt) < 185 * 60_000)).toBe(true);
    expect(result.acceptedEvidence.find((item) => item.evidence.clientEvidenceId === "home-visit")?.evidence.receivedAt)
      .toBe("2026-09-23T22:00:00.000Z");
  });

  it("matches the saved-only baseline and produces identical IDs and output on repeat", () => {
    const input = journeyIdentityFixture();
    const first = runLocationEngine(input);
    const second = runLocationEngine(journeyIdentityFixture());
    expect(second).toEqual(first);
    const savedOnly = runLocationEngine({ ...input, acceptedLearnedPlaces: [] });
    const firstHome = (output: typeof first) => output.segmentUpserts.find(
      (segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === home.id
    );
    expect(firstHome(first)?.clientSegmentId).toBe(firstHome(savedOnly)?.clientSegmentId);
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
  });

  it("preserves learned-only matching", () => {
    const match = matchLocationToPlaces(
      { latitude: 51.5, longitude: learned.longitude, horizontalAccuracyMeters: 25 },
      [], [learned], LOCATION_ENGINE_V2_CONFIG
    );
    expect(match).toMatchObject({ kind: "learned", placeId: learned.id });
  });
});
