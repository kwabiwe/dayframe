import { describe, expect, it } from "vitest";
import {
  accuracyWeightedCentre,
  LOCATION_ACCEPTANCE_PLACE_IDS,
  LOCATION_ENGINE_V2_CONFIG,
  locationAcceptanceFixture,
  localDateKey,
  matchLocationToPlaces,
  nearbySavedPlaceFixture,
  runLocationEngine,
  type LocationEngineInput,
  type LocationEvidence,
  type SavedPlaceForMatching,
  type StaySegment
} from "../src/location";

const TEST_DEVICE_ID = "20000000-0000-4000-8000-000000000099";
const TEST_PLACE_A: SavedPlaceForMatching = {
  id: "10000000-0000-4000-8000-000000000091",
  name: "A",
  latitude: 51.5,
  longitude: -0.1,
  radiusMeters: 90
};
const TEST_PLACE_B: SavedPlaceForMatching = {
  id: "10000000-0000-4000-8000-000000000092",
  name: "B",
  latitude: 51.503,
  longitude: -0.1,
  radiusMeters: 90
};

function evidence(
  id: string,
  minute: number,
  point: { latitude: number; longitude: number },
  options: Partial<LocationEvidence> = {}
): LocationEvidence {
  return {
    clientEvidenceId: id,
    deviceId: TEST_DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location",
    occurredAt: new Date(Date.parse("2026-07-20T08:00:00.000Z") + minute * 60_000).toISOString(),
    receivedAt: "2026-07-20T20:00:00.000Z",
    timeZone: "Europe/London",
    latitude: point.latitude,
    longitude: point.longitude,
    horizontalAccuracyMeters: 25,
    ...options
  };
}

function engineInput(items: LocationEvidence[], places = [TEST_PLACE_A, TEST_PLACE_B]): LocationEngineInput {
  return {
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    evidence: items,
    savedPlaces: places,
    acceptedLearnedPlaces: [],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt: "2026-07-20T20:00:00.000Z"
  };
}

function finalStays() {
  return runLocationEngine(locationAcceptanceFixture()).segmentUpserts.filter(
    (segment): segment is StaySegment => segment.kind === "stay"
  );
}

describe("Location Intelligence V2", () => {
  it("prefers an explicit nearby saved place hint without using a POI label", () => {
    const fixture = nearbySavedPlaceFixture();
    const match = matchLocationToPlaces(
      fixture.input,
      fixture.places,
      [],
      LOCATION_ENGINE_V2_CONFIG
    );
    expect(match.kind).toBe("saved");
    expect(match.placeId).toBe(LOCATION_ACCEPTANCE_PLACE_IDS.home);
  });

  it("returns ambiguity for similarly plausible user-saved places", () => {
    const places = [
      { id: "a", name: "A", latitude: 51.5, longitude: -0.1, radiusMeters: 80 },
      { id: "b", name: "B", latitude: 51.501, longitude: -0.1, radiusMeters: 80 }
    ];
    const match = matchLocationToPlaces(
      { latitude: 51.5005, longitude: -0.1, horizontalAccuracyMeters: 55 },
      places,
      [],
      LOCATION_ENGINE_V2_CONFIG
    );
    expect(match.kind).toBe("ambiguous");
    expect(match.candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  });

  it("does not merge two visits to the sports venue across home", () => {
    const sportsStays = finalStays().filter(
      (stay) => stay.placeId === LOCATION_ACCEPTANCE_PLACE_IDS.sportsVenue
    );
    expect(sportsStays).toHaveLength(2);
    expect(Date.parse(sportsStays[0].stoppedAt!) <= Date.parse(sportsStays[1].startedAt)).toBe(true);
  });

  it("preserves a 14-minute saved-place stop as two commute endpoints", () => {
    const result = runLocationEngine(locationAcceptanceFixture());
    const shortStop = result.segmentUpserts.find(
      (segment): segment is StaySegment =>
        segment.kind === "stay" && segment.placeId === LOCATION_ACCEPTANCE_PLACE_IDS.shortStop
    );
    expect(shortStop).toBeDefined();
    const dwellMinutes = (Date.parse(shortStop!.stoppedAt!) - Date.parse(shortStop!.startedAt)) / 60_000;
    expect(dwellMinutes).toBeGreaterThanOrEqual(9);
    expect(dwellMinutes).toBeLessThanOrEqual(19);
    const endpointCommutes = result.segmentUpserts.filter(
      (segment) =>
        segment.kind === "commute" &&
        (segment.fromStaySegmentId === shortStop!.clientSegmentId || segment.toStaySegmentId === shortStop!.clientSegmentId)
    );
    expect(endpointCommutes).toHaveLength(2);
  });

  it("splits a saved home -> intermediate POI -> saved home despite the old three-hour gap", () => {
    const stays = finalStays();
    const homeIndexes = stays.flatMap((stay, index) =>
      stay.placeId === LOCATION_ACCEPTANCE_PLACE_IDS.roundTripHome ? [index] : []
    );
    expect(homeIndexes).toHaveLength(2);
    expect(homeIndexes[1] - homeIndexes[0]).toBe(2);
    expect(stays[homeIndexes[0] + 1].placeMatchKind).toBe("unknown");
  });

  it("is deterministic for reordered and duplicate delivery", () => {
    const fixture = locationAcceptanceFixture();
    const canonical = runLocationEngine(fixture);
    const replay = runLocationEngine({
      ...fixture,
      evidence: [...fixture.evidence].reverse().concat(fixture.evidence[0])
    });
    expect(replay.segmentUpserts).toEqual(canonical.segmentUpserts);
    expect(replay.diagnostics.duplicateCount).toBe(1);
  });

  it("rejects broad accuracy without retaining its coordinate in diagnostics", () => {
    const fixture = locationAcceptanceFixture();
    fixture.evidence = [{ ...fixture.evidence[0], clientEvidenceId: "bad-accuracy", horizontalAccuracyMeters: 250 }];
    const result = runLocationEngine(fixture);
    expect(result.acceptedEvidence).toHaveLength(0);
    expect(result.rejectedEvidence).toEqual([
      expect.objectContaining({ clientEvidenceId: "bad-accuracy", reason: "accuracy_too_broad" })
    ]);
    expect(result.rejectedEvidence[0]).not.toHaveProperty("latitude");
  });

  it("groups recurrence by the supplied Europe/London day across BST midnight", () => {
    expect(localDateKey("2026-07-20T23:30:00.000Z", "Europe/London")).toBe("2026-07-21");
    expect(localDateKey("2026-12-20T23:30:00.000Z", "Europe/London")).toBe("2026-12-20");
  });

  it("splits the same place across a one-hour evidence gap", () => {
    const result = runLocationEngine(engineInput([
      evidence("gap-a-1", 0, TEST_PLACE_A),
      evidence("gap-a-2", 6, TEST_PLACE_A),
      evidence("gap-a-3", 66, TEST_PLACE_A),
      evidence("gap-a-4", 72, TEST_PLACE_A)
    ]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays).toHaveLength(2);
    expect(stays[0].continuityStatus).toBe("uncertain_gap");
  });

  it("uses correction feedback to resolve an otherwise equal saved-place match", () => {
    const match = matchLocationToPlaces(
      { latitude: 51.5, longitude: -0.1, horizontalAccuracyMeters: 45 },
      [
        { ...TEST_PLACE_A, latitude: 51.5, correctionScore: 0 },
        { ...TEST_PLACE_B, latitude: 51.5, longitude: -0.1, correctionScore: 8 }
      ],
      [],
      LOCATION_ENGINE_V2_CONFIG
    );
    expect(match).toMatchObject({ kind: "saved", placeId: TEST_PLACE_B.id });
  });

  it("keeps realistic poor-accuracy drift from dragging the weighted centre", () => {
    const centre = accuracyWeightedCentre([
      { latitude: 51.5, longitude: -0.1, accuracyMeters: 15 },
      { latitude: 51.50005, longitude: -0.1, accuracyMeters: 15 },
      { latitude: 51.503, longitude: -0.1, accuracyMeters: 190 }
    ]);
    expect(centre).not.toBeNull();
    expect(Math.abs(centre!.latitude - 51.5)).toBeLessThan(0.0002);
  });

  it("does not start a visit from an initial geofence state snapshot", () => {
    const result = runLocationEngine(engineInput([
      evidence("initial-state", 0, TEST_PLACE_A, {
        kind: "geofence_state",
        savedPlaceId: TEST_PLACE_A.id,
        metadata: { geofenceState: "inside" }
      })
    ]));
    expect(result.segmentUpserts).toHaveLength(0);
  });

  it("treats an uncorroborated geofence exit as an uncertain bounded departure", () => {
    const result = runLocationEngine(engineInput([
      evidence("inside-1", 0, TEST_PLACE_A),
      evidence("inside-2", 6, TEST_PLACE_A),
      evidence("exit", 12, TEST_PLACE_A, { kind: "geofence_exit", savedPlaceId: TEST_PLACE_A.id })
    ]));
    const stay = result.segmentUpserts.find((segment): segment is StaySegment => segment.kind === "stay");
    expect(stay?.continuityStatus).toBe("uncertain_gap");
    expect(stay?.stopLowerBoundAt).toBe(evidence("inside-2-copy", 6, TEST_PLACE_A).occurredAt);
    expect(stay?.stopUpperBoundAt).toBe(evidence("exit-copy", 12, TEST_PLACE_A).occurredAt);
  });

  it("lets a completed iOS visit span a standard-sample gap", () => {
    const result = runLocationEngine(engineInput([
      evidence("visit", 0, TEST_PLACE_A, {
        kind: "visit",
        endedAt: evidence("departure", 60, TEST_PLACE_A).occurredAt,
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("visit-sample-1", 5, TEST_PLACE_A),
      evidence("visit-sample-2", 55, TEST_PLACE_A)
    ]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays).toHaveLength(1);
    expect(stays[0].continuityStatus).toBe("supported_by_visit");
  });

  it("does not let an iOS visit merge across accepted evidence at another place", () => {
    const result = runLocationEngine(engineInput([
      evidence("visit-a", 0, TEST_PLACE_A, {
        kind: "visit",
        endedAt: evidence("visit-a-end", 60, TEST_PLACE_A).occurredAt,
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("contradiction-b-1", 25, TEST_PLACE_B),
      evidence("contradiction-b-2", 35, TEST_PLACE_B),
      evidence("return-a", 70, TEST_PLACE_A)
    ]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays.map((stay) => stay.placeId)).toEqual([TEST_PLACE_A.id, TEST_PLACE_B.id, TEST_PLACE_A.id]);
  });

  it("keeps a nearby A to B to A sequence as three temporal stays", () => {
    const result = runLocationEngine(engineInput([
      evidence("near-a-1", 0, TEST_PLACE_A),
      evidence("near-a-2", 6, TEST_PLACE_A),
      evidence("near-b-1", 12, TEST_PLACE_B),
      evidence("near-b-2", 18, TEST_PLACE_B),
      evidence("near-a-3", 24, TEST_PLACE_A),
      evidence("near-a-4", 30, TEST_PLACE_A)
    ]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays.map((stay) => stay.placeId)).toEqual([
      TEST_PLACE_A.id,
      TEST_PLACE_B.id,
      TEST_PLACE_A.id
    ]);
  });

  it("does not promote a moving pass by a place about 168 metres from A", () => {
    const nearbyB = { ...TEST_PLACE_B, latitude: 51.50151 };
    const result = runLocationEngine(engineInput([
      evidence("pass-a-1", 0, TEST_PLACE_A),
      evidence("pass-a-2", 6, TEST_PLACE_A),
      evidence("pass-b", 9, nearbyB, { speedMetersPerSecond: 4 }),
      evidence("pass-a-3", 12, TEST_PLACE_A),
      evidence("pass-a-4", 18, TEST_PLACE_A)
    ], [TEST_PLACE_A, nearbyB]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays.some((stay) => stay.placeId === nearbyB.id)).toBe(false);
  });

  it("represents a genuine dwell at the nearby 168 metre place separately", () => {
    const nearbyB = { ...TEST_PLACE_B, latitude: 51.50151 };
    const result = runLocationEngine(engineInput([
      evidence("dwell-a-1", 0, TEST_PLACE_A),
      evidence("dwell-a-2", 6, TEST_PLACE_A),
      evidence("dwell-b-1", 12, nearbyB),
      evidence("dwell-b-2", 20, nearbyB),
      evidence("dwell-a-3", 28, TEST_PLACE_A),
      evidence("dwell-a-4", 34, TEST_PLACE_A)
    ], [TEST_PLACE_A, nearbyB]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays.map((stay) => stay.placeId)).toEqual([
      TEST_PLACE_A.id,
      nearbyB.id,
      TEST_PLACE_A.id
    ]);
  });

  it("ignores a geofence exit for the wrong active place", () => {
    const result = runLocationEngine(engineInput([
      evidence("wrong-exit-a-1", 0, TEST_PLACE_A),
      evidence("wrong-exit-a-2", 6, TEST_PLACE_A),
      evidence("wrong-exit-b", 8, TEST_PLACE_B, {
        kind: "geofence_exit",
        savedPlaceId: TEST_PLACE_B.id
      }),
      evidence("wrong-exit-a-3", 12, TEST_PLACE_A)
    ]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    expect(stays).toHaveLength(1);
    expect(stays[0].placeId).toBe(TEST_PLACE_A.id);
  });

  it("labels an endpoint-only commute as uncertain", () => {
    const result = runLocationEngine(engineInput([
      evidence("endpoint-a-1", 0, TEST_PLACE_A),
      evidence("endpoint-a-2", 6, TEST_PLACE_A),
      evidence("endpoint-b-1", 24, TEST_PLACE_B),
      evidence("endpoint-b-2", 30, TEST_PLACE_B)
    ]));
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");
    expect(commute).toMatchObject({
      kind: "commute",
      routeSampleCount: 0,
      routeDistanceMeters: null,
      continuityStatus: "uncertain_gap",
      confidence: "low"
    });
  });

  it("calculates route distance separately from endpoint straight-line distance", () => {
    const result = runLocationEngine(engineInput([
      evidence("route-a-1", 0, TEST_PLACE_A),
      evidence("route-a-2", 6, TEST_PLACE_A),
      evidence("route-bend-1", 12, { latitude: 51.502, longitude: -0.097 }, { speedMetersPerSecond: 5 }),
      evidence("route-bend-2", 18, { latitude: 51.505, longitude: -0.097 }, { speedMetersPerSecond: 5 }),
      evidence("route-b-1", 24, TEST_PLACE_B),
      evidence("route-b-2", 30, TEST_PLACE_B)
    ]));
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");
    expect(commute?.kind).toBe("commute");
    if (commute?.kind === "commute") {
      expect(commute.routeDistanceMeters).not.toBe(commute.straightLineDistanceMeters);
      expect(commute.routeSampleCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects a teleporting standard sample", () => {
    const result = runLocationEngine(engineInput([
      evidence("teleport-start", 0, TEST_PLACE_A),
      evidence("teleport-end", 0.01, { latitude: 52.5, longitude: 0.9 })
    ]));
    expect(result.rejectedEvidence).toEqual([
      expect.objectContaining({ clientEvidenceId: "teleport-end", reason: "implausible_speed" })
    ]);
  });

  it("maintains ordered non-negative segment invariants over generated evidence", () => {
    let seed = 7;
    const next = () => ((seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647);
    const items = Array.from({ length: 80 }, (_, index) => {
      const base = index % 20 < 10 ? TEST_PLACE_A : TEST_PLACE_B;
      return evidence(`generated-${index}`, index * 3, {
        latitude: base.latitude + (next() - 0.5) * 0.0002,
        longitude: base.longitude + (next() - 0.5) * 0.0002
      }, { horizontalAccuracyMeters: 15 + next() * 45 });
    });
    const result = runLocationEngine(engineInput(items));
    for (const segment of result.segmentUpserts) {
      expect(Date.parse(segment.startedAt)).toBeLessThanOrEqual(Date.parse(segment.stoppedAt ?? result.nextState.lastProcessedAt!));
      expect(new Set(segment.evidenceIds).size).toBe(segment.evidenceIds.length);
    }
  });

  it("handles the Europe/London spring DST transition without duplicating a day", () => {
    expect(localDateKey("2026-03-29T00:30:00.000Z", "Europe/London")).toBe("2026-03-29");
    expect(localDateKey("2026-03-29T01:30:00.000Z", "Europe/London")).toBe("2026-03-29");
  });
});
