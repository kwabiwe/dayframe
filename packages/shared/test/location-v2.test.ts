import { describe, expect, it } from "vitest";
import {
  accuracyWeightedCentre,
  LOCATION_ACCEPTANCE_PLACE_IDS,
  LOCATION_ENGINE_V2_CONFIG,
  coalesceCompatibleUnknownStays,
  locationAcceptanceFixture,
  localDateKey,
  matchLocationToPlaces,
  nearbySavedPlaceFixture,
  runLocationEngine,
  type ClassifiedEvidence,
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
const TEST_PLACE_FAR: SavedPlaceForMatching = {
  id: "10000000-0000-4000-8000-000000000093",
  name: "Far destination",
  latitude: 51.54,
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

function classified(item: LocationEvidence): ClassifiedEvidence {
  return {
    evidence: item,
    match: null,
    impliedSpeedMetersPerSecond: item.speedMetersPerSecond ?? null
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

  it("chooses the stable best saved place and retains overlapping alternatives", () => {
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
    expect(match.kind).toBe("saved");
    expect(match.placeId).toBe("a");
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

  it("keeps a sparse gym visit continuous and constructs both surrounding commutes", () => {
    const home = TEST_PLACE_A;
    const gym = { latitude: 51.53, longitude: -0.1 };
    const routePoint = (id: string, minute: number, latitude: number, speed = 12) =>
      evidence(id, minute, { latitude, longitude: -0.1 }, { speedMetersPerSecond: speed });
    const result = runLocationEngine(engineInput([
      evidence("home-0543", 0, home),
      evidence("home-0550", 7, home),
      evidence("home-0557", 14, home),
      routePoint("out-0602", 19, 51.508),
      routePoint("out-0606", 23, 51.517),
      routePoint("out-0610", 27, 51.526),
      evidence("gym-0613-a", 30, gym),
      evidence("gym-0613-b", 31, { latitude: 51.53005, longitude: -0.1 }),
      // Core Location is quiet while stationary, then reports the same site
      // when movement resumes. This gap must not manufacture a second visit.
      evidence("gym-0703", 80, { latitude: 51.53004, longitude: -0.1 }),
      routePoint("leave-past-gym", 82, 51.5299, 4),
      routePoint("return-0708", 85, 51.522),
      routePoint("return-0711", 88, 51.512),
      routePoint("return-0714", 91, 51.504),
      evidence("home-0715", 92, home),
      evidence("home-0718", 95, home),
      evidence("home-0720", 97, home)
    ], [home]));

    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const gymStays = stays.filter((stay) => stay.placeMatchKind === "unknown");
    const commutes = result.segmentUpserts.filter((segment) => segment.kind === "commute");

    expect(gymStays).toHaveLength(1);
    expect(gymStays[0]).toMatchObject({
      startedAt: "2026-07-20T08:31:00.000Z",
      sampleCount: 3
    });
    expect(Date.parse(gymStays[0].stoppedAt!)).toBeGreaterThanOrEqual(Date.parse("2026-07-20T09:20:00.000Z"));
    expect(commutes).toHaveLength(2);
    expect(commutes.map((commute) => [commute.fromPlaceId, commute.toPlaceId])).toEqual([
      [home.id, null],
      [null, home.id]
    ]);
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
    expect(stays[0]).toMatchObject({
      stoppedAt: "2026-07-20T08:12:30.000Z",
      stopUpperBoundAt: "2026-07-20T08:25:00.000Z"
    });
  });

  it.each([
    ["another saved place", TEST_PLACE_B, [TEST_PLACE_A, TEST_PLACE_B]],
    ["corroborated outside samples", TEST_PLACE_B, [TEST_PLACE_A]],
    ["a long observation gap", TEST_PLACE_FAR, [TEST_PLACE_A, TEST_PLACE_FAR]]
  ])("preserves a completed Visit departure before %s", (_label, destination, places) => {
    const departureAt = "2026-07-20T09:00:00.000Z";
    const outsideMinute = destination === TEST_PLACE_FAR ? 90 : 61;
    const result = runLocationEngine(engineInput([
      evidence("bounded-visit", 0, TEST_PLACE_A, { kind: "visit", endedAt: departureAt }),
      evidence("inside-visit", 30, TEST_PLACE_A),
      evidence("outside-1", outsideMinute, destination),
      evidence("outside-2", outsideMinute + 2, destination)
    ], places));
    const origin = result.segmentUpserts.find((segment) => segment.kind === "stay" && segment.placeId === TEST_PLACE_A.id);
    expect(origin).toMatchObject({
      stoppedAt: departureAt,
      stopLowerBoundAt: departureAt,
      stopUpperBoundAt: departureAt
    });
  });

  it("uses later inside evidence when it contradicts an earlier Visit departure", () => {
    const result = runLocationEngine(engineInput([
      evidence("earlier-departure", 0, TEST_PLACE_A, {
        kind: "visit", endedAt: "2026-07-20T09:00:00.000Z"
      }),
      evidence("later-inside", 65, TEST_PLACE_A),
      evidence("later-outside", 70, TEST_PLACE_B)
    ]));
    const origin = result.segmentUpserts.find((segment) => segment.kind === "stay" && segment.placeId === TEST_PLACE_A.id);
    expect(origin).toMatchObject({
      stoppedAt: "2026-07-20T09:07:30.000Z",
      stopLowerBoundAt: "2026-07-20T09:05:00.000Z",
      stopUpperBoundAt: "2026-07-20T09:10:00.000Z"
    });
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

  it("rejects endpoint-only movement between nearby places", () => {
    const result = runLocationEngine(engineInput([
      evidence("endpoint-a-1", 0, TEST_PLACE_A),
      evidence("endpoint-a-2", 6, TEST_PLACE_A),
      evidence("endpoint-b-1", 24, TEST_PLACE_B),
      evidence("endpoint-b-2", 30, TEST_PLACE_B)
    ]));
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");
    expect(commute).toBeUndefined();
  });

  it("rejects a pedestrian retail-site loop even with one speed outlier", () => {
    const retailCarPark = {
      ...TEST_PLACE_B,
      latitude: 51.5018
    };
    const result = runLocationEngine(engineInput([
      evidence("retail-a-1", 0, TEST_PLACE_A),
      evidence("retail-a-2", 6, TEST_PLACE_A),
      evidence("retail-walk-1", 10, { latitude: 51.5007, longitude: -0.0998 }, {
        speedMetersPerSecond: 1.2
      }),
      evidence("retail-outlier", 14, { latitude: 51.5012, longitude: -0.0996 }, {
        speedMetersPerSecond: 12
      }),
      evidence("retail-walk-2", 18, { latitude: 51.5015, longitude: -0.0998 }, {
        speedMetersPerSecond: 1.1
      }),
      evidence("retail-b-1", 24, retailCarPark),
      evidence("retail-b-2", 32, retailCarPark)
    ], [TEST_PLACE_A, retailCarPark]));

    expect(result.segmentUpserts.some((segment) => segment.kind === "commute")).toBe(false);
  });

  it("keeps a meaningful slow journey possible without using speed as a transport gate", () => {
    const result = runLocationEngine(engineInput([
      evidence("slow-a-1", 0, TEST_PLACE_A),
      evidence("slow-a-2", 6, TEST_PLACE_A),
      evidence("slow-route-1", 18, { latitude: 51.512, longitude: -0.1 }, {
        speedMetersPerSecond: 1.8
      }),
      evidence("slow-route-2", 34, { latitude: 51.526, longitude: -0.1 }, {
        speedMetersPerSecond: 2
      }),
      evidence("slow-route-3", 50, { latitude: 51.536, longitude: -0.1 }, {
        speedMetersPerSecond: 1.6
      }),
      evidence("slow-far-1", 60, TEST_PLACE_FAR),
      evidence("slow-far-2", 66, TEST_PLACE_FAR)
    ], [TEST_PLACE_A, TEST_PLACE_FAR]));

    expect(result.segmentUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "commute",
        qualificationReason: "significant_endpoint_displacement"
      })
    ]));
  });

  it("recovers one uncertain commute after a car-park GPS blackout", () => {
    const carPark = { latitude: 51.503, longitude: -0.1 };
    const result = runLocationEngine(engineInput([
      evidence("car-park-origin-1", 0, TEST_PLACE_A),
      evidence("car-park-origin-2", 6, TEST_PLACE_A),
      evidence("car-park-walk-1", 10, { latitude: 51.5013, longitude: -0.1 }, {
        speedMetersPerSecond: 1.2
      }),
      evidence("car-park-walk-2", 14, { latitude: 51.5025, longitude: -0.1 }, {
        speedMetersPerSecond: 1.1
      }),
      evidence("car-park-wait-1", 18, carPark),
      evidence("car-park-wait-2", 28, carPark),
      evidence("car-park-wait-3", 38, carPark),
      evidence("car-park-pause", 40, carPark, {
        kind: "location_paused",
        latitude: null,
        longitude: null
      }),
      evidence("car-park-resume", 55, carPark, {
        kind: "location_resumed",
        latitude: null,
        longitude: null
      }),
      evidence("car-park-route-1", 58, { latitude: 51.512, longitude: -0.1 }, {
        speedMetersPerSecond: 10
      }),
      evidence("car-park-route-2", 63, { latitude: 51.526, longitude: -0.1 }, {
        speedMetersPerSecond: 10
      }),
      evidence("car-park-home-1", 70, TEST_PLACE_FAR),
      evidence("car-park-home-2", 76, TEST_PLACE_FAR)
    ], [TEST_PLACE_A, TEST_PLACE_FAR]));
    const commutes = result.segmentUpserts.filter((segment) => segment.kind === "commute");

    expect(commutes).toHaveLength(1);
    expect(commutes[0]).toMatchObject({
      continuityStatus: "uncertain_gap",
      startLowerBoundAt: evidence("lower", 38, carPark).occurredAt,
      startUpperBoundAt: evidence("upper", 58, carPark).occurredAt,
      qualificationReason: "significant_endpoint_displacement"
    });
    expect(Date.parse(commutes[0].startedAt)).toBeGreaterThan(
      Date.parse(evidence("not-stale", 30, carPark).occurredAt)
    );
  });

  it("does not infer travel when coordinates return at the same place after GPS loss", () => {
    const result = runLocationEngine(engineInput([
      evidence("no-move-a-1", 0, TEST_PLACE_A),
      evidence("no-move-a-2", 6, TEST_PLACE_A),
      evidence("no-move-pause", 8, TEST_PLACE_A, {
        kind: "location_paused",
        latitude: null,
        longitude: null
      }),
      evidence("no-move-resume", 30, TEST_PLACE_A, {
        kind: "location_resumed",
        latitude: null,
        longitude: null
      }),
      evidence("no-move-a-3", 31, TEST_PLACE_A),
      evidence("no-move-a-4", 37, TEST_PLACE_A)
    ], [TEST_PLACE_A]));

    expect(result.segmentUpserts.some((segment) => segment.kind === "commute")).toBe(false);
  });

  it("does not fabricate a commute from a distant arrival without departure or route evidence", () => {
    const result = runLocationEngine(engineInput([
      evidence("sparse-a-1", 0, TEST_PLACE_A),
      evidence("sparse-a-2", 6, TEST_PLACE_A),
      evidence("sparse-far-1", 60, TEST_PLACE_FAR),
      evidence("sparse-far-2", 66, TEST_PLACE_FAR)
    ], [TEST_PLACE_A, TEST_PLACE_FAR]));
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");

    expect(commute).toBeUndefined();
  });

  it("waits for the existing finalisation lag before emitting a recovered journey", () => {
    const items = [
      evidence("lifecycle-a-1", 0, TEST_PLACE_A),
      evidence("lifecycle-a-2", 6, TEST_PLACE_A),
      evidence("lifecycle-route", 30, { latitude: 51.52, longitude: -0.1 }, {
        speedMetersPerSecond: 12
      }),
      evidence("lifecycle-far-1", 60, TEST_PLACE_FAR),
      evidence("lifecycle-far-2", 66, TEST_PLACE_FAR)
    ];
    const beforeLag = runLocationEngine({
      ...engineInput(items, [TEST_PLACE_A, TEST_PLACE_FAR]),
      processingAt: evidence("lifecycle-before", 69, TEST_PLACE_FAR).occurredAt
    });
    const afterLag = runLocationEngine({
      ...engineInput(items, [TEST_PLACE_A, TEST_PLACE_FAR]),
      processingAt: evidence("lifecycle-after", 71, TEST_PLACE_FAR).occurredAt
    });

    expect(beforeLag.segmentUpserts.find((segment) => segment.kind === "commute")).toMatchObject({
      kind: "commute",
      status: "closed"
    });
    expect(beforeLag.finalisedSegments.some((segment) => segment.kind === "commute")).toBe(false);
    expect(afterLag.finalisedSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "commute", status: "finalised" })
    ]));
  });

  it("rejects a short same-place pedestrian loop with one fast outlier", () => {
    const result = runLocationEngine(engineInput([
      evidence("same-walk-a-1", 0, TEST_PLACE_A),
      evidence("same-walk-a-2", 6, TEST_PLACE_A),
      evidence("same-walk-exit", 8, TEST_PLACE_A, {
        kind: "geofence_exit",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("same-walk-route-1", 12, { latitude: 51.5015, longitude: -0.1 }, {
        speedMetersPerSecond: 1.1
      }),
      evidence("same-walk-route-2", 16, { latitude: 51.5025, longitude: -0.1 }, {
        speedMetersPerSecond: 9
      }),
      evidence("same-walk-route-3", 20, { latitude: 51.5015, longitude: -0.1 }, {
        speedMetersPerSecond: 1.2
      }),
      evidence("same-walk-return", 24, TEST_PLACE_A, {
        kind: "geofence_enter",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("same-walk-return-support", 30, TEST_PLACE_A)
    ], [TEST_PLACE_A]));

    expect(result.segmentUpserts.some((segment) => segment.kind === "commute")).toBe(false);
  });

  it("coalesces a visit-supported shopping-centre stay and nearby car-park dwell", () => {
    const firstCentre = { latitude: 51.5, longitude: -0.1 };
    const secondCentre = { latitude: 51.5036, longitude: -0.1 };
    const visit = classified(evidence("site-visit", 0, firstCentre, {
      kind: "visit",
      endedAt: evidence("site-visit-end", 120, firstCentre).occurredAt
    }));
    const walkOne = classified(evidence(
      "site-walk-1",
      123,
      { latitude: 51.5013, longitude: -0.1 },
      { speedMetersPerSecond: 1.1 }
    ));
    const walkTwo = classified(evidence(
      "site-walk-2",
      126,
      { latitude: 51.5024, longitude: -0.1 },
      { speedMetersPerSecond: 1.2 }
    ));
    const laterOne = classified(evidence("site-car-park-1", 130, secondCentre));
    const laterTwo = classified(evidence("site-car-park-2", 150, secondCentre));
    const laterThree = classified(evidence("site-car-park-3", 160, secondCentre));
    const firstStay: StaySegment = {
      kind: "stay",
      clientSegmentId: "first-site-stay",
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      status: "finalised",
      startedAt: visit.evidence.occurredAt,
      stoppedAt: evidence("site-first-stop", 120, firstCentre).occurredAt,
      startLowerBoundAt: visit.evidence.occurredAt,
      startUpperBoundAt: visit.evidence.occurredAt,
      stopLowerBoundAt: evidence("site-first-lower", 118, firstCentre).occurredAt,
      stopUpperBoundAt: evidence("site-first-upper", 123, firstCentre).occurredAt,
      placeId: null,
      learnedPlaceId: null,
      placeMatchKind: "unknown",
      candidatePlaceIds: [],
      centreLatitude: firstCentre.latitude,
      centreLongitude: firstCentre.longitude,
      radiusMeters: 120,
      sampleCount: 3,
      continuityStatus: "broken_by_other_place",
      confidence: "medium",
      evidenceIds: [visit.evidence.clientEvidenceId]
    };
    const laterStay: StaySegment = {
      ...firstStay,
      clientSegmentId: "second-site-stay",
      status: "open",
      startedAt: laterOne.evidence.occurredAt,
      stoppedAt: null,
      startLowerBoundAt: laterOne.evidence.occurredAt,
      startUpperBoundAt: laterOne.evidence.occurredAt,
      stopLowerBoundAt: null,
      stopUpperBoundAt: null,
      centreLatitude: secondCentre.latitude,
      centreLongitude: secondCentre.longitude,
      evidenceIds: [
        laterOne.evidence.clientEvidenceId,
        laterTwo.evidence.clientEvidenceId,
        laterThree.evidence.clientEvidenceId
      ]
    };
    const accepted = [visit, walkOne, walkTwo, laterOne, laterTwo, laterThree];
    const coalesced = coalesceCompatibleUnknownStays(
      [firstStay, laterStay],
      accepted,
      engineInput([])
    );
    const replayed = coalesceCompatibleUnknownStays(
      [firstStay, laterStay],
      [...accepted].reverse(),
      engineInput([])
    );

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toMatchObject({
      clientSegmentId: firstStay.clientSegmentId,
      startedAt: firstStay.startedAt,
      stoppedAt: null,
      status: "open",
      continuityStatus: "supported_by_visit",
      sampleCount: 6
    });
    expect(new Set(coalesced[0].evidenceIds).size).toBe(coalesced[0].evidenceIds.length);
    expect(replayed[0].clientSegmentId).toBe(coalesced[0].clientSegmentId);
  });

  it("does not coalesce nearby unknown stays across credible vehicle movement", () => {
    const firstCentre = { latitude: 51.5, longitude: -0.1 };
    const secondCentre = { latitude: 51.5036, longitude: -0.1 };
    const visit = classified(evidence("vehicle-site-visit", 0, firstCentre, { kind: "visit" }));
    const route = [
      classified(evidence("vehicle-site-route-1", 12, { latitude: 51.5013, longitude: -0.1 }, {
        speedMetersPerSecond: 8
      })),
      classified(evidence("vehicle-site-route-2", 14, { latitude: 51.5024, longitude: -0.1 }, {
        speedMetersPerSecond: 9
      }))
    ];
    const baseStay: StaySegment = {
      kind: "stay",
      clientSegmentId: "vehicle-site-first",
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      status: "finalised",
      startedAt: visit.evidence.occurredAt,
      stoppedAt: evidence("vehicle-site-stop", 10, firstCentre).occurredAt,
      placeId: null,
      learnedPlaceId: null,
      placeMatchKind: "unknown",
      candidatePlaceIds: [],
      centreLatitude: firstCentre.latitude,
      centreLongitude: firstCentre.longitude,
      radiusMeters: 120,
      sampleCount: 3,
      continuityStatus: "broken_by_other_place",
      confidence: "medium",
      evidenceIds: [visit.evidence.clientEvidenceId]
    };
    const nextEvidence = classified(evidence("vehicle-site-next", 18, secondCentre));
    const nextStay: StaySegment = {
      ...baseStay,
      clientSegmentId: "vehicle-site-second",
      startedAt: nextEvidence.evidence.occurredAt,
      stoppedAt: null,
      centreLatitude: secondCentre.latitude,
      centreLongitude: secondCentre.longitude,
      evidenceIds: [nextEvidence.evidence.clientEvidenceId]
    };

    expect(
      coalesceCompatibleUnknownStays(
        [baseStay, nextStay],
        [visit, ...route, nextEvidence],
        engineInput([])
      )
    ).toHaveLength(2);
  });

  it("calculates route distance separately from endpoint straight-line distance", () => {
    const distantDestination = {
      ...TEST_PLACE_B,
      latitude: 51.509
    };
    const result = runLocationEngine(engineInput([
      evidence("route-a-1", 0, TEST_PLACE_A),
      evidence("route-a-2", 6, TEST_PLACE_A),
      evidence("route-bend-1", 12, { latitude: 51.504, longitude: -0.094 }, { speedMetersPerSecond: 5 }),
      evidence("route-bend-2", 18, { latitude: 51.507, longitude: -0.094 }, { speedMetersPerSecond: 5 }),
      evidence("route-b-1", 24, distantDestination),
      evidence("route-b-2", 30, distantDestination)
    ], [TEST_PLACE_A, distantDestination]));
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");
    expect(commute?.kind).toBe("commute");
    if (commute?.kind === "commute") {
      expect(commute.routeDistanceMeters).not.toBe(commute.straightLineDistanceMeters);
      expect(commute.routeSampleCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses later same-place evidence as the commute boundary and drops stale same-place gaps", () => {
    const result = runLocationEngine(engineInput([
      evidence("home-before-gap-1", 0, TEST_PLACE_A),
      evidence("home-before-gap-2", 6, TEST_PLACE_A),
      evidence("home-after-gap", 58, TEST_PLACE_A),
      evidence("home-at-real-departure", 77, TEST_PLACE_A),
      evidence("home-exit", 77.01, TEST_PLACE_A, {
        kind: "geofence_exit",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("outbound-route-1", 82, { latitude: 51.505, longitude: -0.095 }, {
        speedMetersPerSecond: 8
      }),
      evidence("outbound-route-2", 84.5, { latitude: 51.51, longitude: -0.09 }, {
        speedMetersPerSecond: 8
      }),
      evidence("outbound-route-3", 87, { latitude: 51.506, longitude: -0.094 }, {
        speedMetersPerSecond: 8
      }),
      evidence("home-return", 89, TEST_PLACE_A, {
        kind: "geofence_enter",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("home-return-support", 94, TEST_PLACE_A),
      evidence("late-provider-exit", 335, TEST_PLACE_A, {
        kind: "geofence_exit",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("late-provider-enter", 335, TEST_PLACE_A, {
        kind: "geofence_enter",
        savedPlaceId: TEST_PLACE_A.id
      }),
      evidence("late-provider-support", 340, TEST_PLACE_A)
    ], [TEST_PLACE_A]));
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const commutes = result.segmentUpserts.filter((segment) => segment.kind === "commute");

    expect(stays).toHaveLength(3);
    expect(stays[1].stoppedAt).toBe(evidence("expected-return-support", 94, TEST_PLACE_A).occurredAt);
    expect(commutes).toHaveLength(1);
    expect(commutes[0]).toMatchObject({
      startedAt: evidence("expected-start", 77.01, TEST_PLACE_A).occurredAt,
      stoppedAt: evidence("expected-stop", 89, TEST_PLACE_A).occurredAt,
      routeSampleCount: 3,
      gapDurationSeconds: 719
    });
  });

  it("recognises the 7 September unsaved-place return as one evidence-backed round trip", () => {
    const observed = (
      id: string,
      occurredAt: string,
      latitude: number,
      longitude: number,
      options: Partial<LocationEvidence> = {}
    ): LocationEvidence => ({
      clientEvidenceId: id,
      deviceId: "device-1",
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      kind: "standard_location",
      occurredAt,
      latitude,
      longitude,
      horizontalAccuracyMeters: 25,
      receivedAt: "2026-09-07T20:00:00.000Z",
      timeZone: "Europe/London",
      ...options
    });
    // Synthetic coordinates preserve the route shape without retaining a private trace.
    const sep7Input = engineInput([
      observed("sep7-home-visit", "2026-09-07T15:34:04.000Z", 51.5, -0.1, {
        kind: "visit",
        endedAt: "2026-09-07T17:15:53.000Z",
        horizontalAccuracyMeters: 17.4
      }),
      observed("sep7-home-support", "2026-09-07T16:32:19.376Z", 51.4999, -0.1001, {
        speedMetersPerSecond: 0.97,
        horizontalAccuracyMeters: 5.9
      }),
      observed("sep7-route-1", "2026-09-07T17:16:26.566Z", 51.4998, -0.095, {
        speedMetersPerSecond: 7.17,
        horizontalAccuracyMeters: 14.3
      }),
      observed("sep7-route-2", "2026-09-07T17:17:24.000Z", 51.4955, -0.093, {
        kind: "significant_change",
        horizontalAccuracyMeters: 64.3
      }),
      observed("sep7-route-3", "2026-09-07T17:17:32.677Z", 51.494, -0.0925, {
        speedMetersPerSecond: 1.82,
        horizontalAccuracyMeters: 23.2
      }),
      observed("sep7-route-4", "2026-09-07T17:20:27.000Z", 51.4895, -0.0755, {
        kind: "visit",
        horizontalAccuracyMeters: 26
      }),
      observed("sep7-route-5", "2026-09-07T17:22:27.000Z", 51.4877, -0.0715, {
        kind: "significant_change",
        horizontalAccuracyMeters: 38.6
      }),
      observed("sep7-route-6", "2026-09-07T17:25:58.637Z", 51.4904, -0.0754, {
        horizontalAccuracyMeters: 4.7
      }),
      observed("sep7-route-7", "2026-09-07T17:27:32.654Z", 51.4918, -0.0816, {
        horizontalAccuracyMeters: 18.3
      }),
      observed("sep7-route-8", "2026-09-07T17:28:27.642Z", 51.4926, -0.087, {
        speedMetersPerSecond: 8.67,
        horizontalAccuracyMeters: 23.7
      }),
      observed("sep7-return-visit", "2026-09-07T17:30:30.000Z", 51.5001, -0.0999, {
        kind: "visit",
        horizontalAccuracyMeters: 20
      }),
      observed("sep7-return-support-1", "2026-09-07T17:31:39.999Z", 51.5, -0.1001, {
        horizontalAccuracyMeters: 5
      }),
      observed("sep7-return-support-2", "2026-09-07T17:32:37.000Z", 51.5, -0.1001, {
        kind: "significant_change",
        horizontalAccuracyMeters: 5.4
      })
    ], []);
    const result = runLocationEngine({
      ...sep7Input,
      processingAt: "2026-09-07T20:00:00.000Z"
    });
    const stays = result.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const commute = result.segmentUpserts.find((segment) => segment.kind === "commute");

    expect(stays).toHaveLength(2);
    // 17:15:53 UTC is 18:15:53 BST. The previous GPS midpoint was
    // 16:54:22.971 UTC (17:54:22 BST), over 21 minutes before departure.
    expect(stays[0]).toMatchObject({
      stoppedAt: "2026-09-07T17:15:53.000Z",
      stopLowerBoundAt: "2026-09-07T17:15:53.000Z",
      stopUpperBoundAt: "2026-09-07T17:15:53.000Z"
    });
    expect(commute).toMatchObject({
      kind: "commute",
      startedAt: "2026-09-07T17:15:53.000Z",
      startLowerBoundAt: "2026-09-07T17:15:53.000Z",
      startUpperBoundAt: "2026-09-07T17:15:53.000Z",
      qualificationReason: "same_place_meaningful_round_trip"
    });
    if (commute?.kind === "commute") {
      expect(commute.straightLineDistanceMeters).toBeLessThan(20);
      expect(commute.routeDistanceMeters).toBeGreaterThan(5_000);
      expect(commute.routeSampleCount).toBeGreaterThanOrEqual(8);
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
