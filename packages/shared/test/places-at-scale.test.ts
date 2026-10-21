import { describe, expect, it } from "vitest";
import {
  indexPlacesByLatitude,
  LOCATION_ENGINE_V2_CONFIG,
  placesNearLatitude,
  runLocationEngine,
  type LocationEngineInput,
  type SavedPlaceForMatching
} from "../src/location";
import { distanceMeters } from "../src/location/geo";
import { gymVisitDepartureFixture } from "../src/location/gymVisitDepartureFixture";
import { journeyIdentityFixture } from "../src/location/journeyIdentityFixture";
import { incident } from "../src/location/savedPlaceQualityFixture";
import { schoolEdgeStopFixture } from "../src/location/schoolEdgeStopFixture";
import { schoolRunArrivalFixture } from "../src/location/schoolRunArrivalFixture";
import { schoolVisitFixture } from "../src/location/schoolVisitFixture";

// Places at scale (location v3 PR 16, design §11.1): each reading meets only the places in its
// latitude band. Synthetic fixtures and generated places only.

/** A deterministic spread of `count` places, each at least `minMeters` from every fixture point. */
function farPlaces(input: LocationEngineInput, count: number, minMeters: number): SavedPlaceForMatching[] {
  const points = input.evidence.flatMap((evidence) => evidence.latitude != null && evidence.longitude != null
    ? [{ latitude: evidence.latitude, longitude: evidence.longitude }] : []);
  const centre = points[0];
  const places: SavedPlaceForMatching[] = [];
  let seed = 7;
  const next = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
  while (places.length < count) {
    const candidate = { latitude: centre.latitude + (next() - 0.5) * 0.6, longitude: centre.longitude + (next() - 0.5) * 0.6 };
    if (points.some((point) => distanceMeters(point, candidate) < minMeters)) continue;
    places.push({ id: `90000000-0000-4000-8000-${String(places.length).padStart(12, "0")}`, name: `Generated ${places.length}`,
      ...candidate, radiusMeters: 50 + Math.round(next() * 250), priority: 0 });
  }
  return places;
}

const fixtures: Array<[string, () => LocationEngineInput]> = [
  ["journey identity", journeyIdentityFixture],
  ["gym visit departure", () => gymVisitDepartureFixture()],
  ["school edge stop", () => schoolEdgeStopFixture()],
  ["school run arrival", () => schoolRunArrivalFixture()],
  ["school visit", () => schoolVisitFixture()],
  ["saved-place quality", () => incident()]
];

describe("places at scale", () => {
  it("finds every place a reading could match, and leaves out only places beyond any reach", () => {
    const places = farPlaces(journeyIdentityFixture(), 500, 0);
    const index = indexPlacesByLatitude(places, LOCATION_ENGINE_V2_CONFIG);
    for (const reading of places.slice(0, 50)) {
      const near = new Set(placesNearLatitude(index, reading.latitude).map((place) => place.id));
      for (const place of places) {
        const reach = Math.max(20, place.radiusMeters) + LOCATION_ENGINE_V2_CONFIG.maxAccuracyAllowanceMeters + 25;
        if (distanceMeters(reading, place) <= reach) expect(near.has(place.id)).toBe(true);
      }
      // A latitude band, not the whole list.
      expect(near.size).toBeLessThan(places.length / 10);
    }
  });

  it.each(fixtures)("gives %s the same Stays and Moves beside 500 more places farther away", (_name, fixture) => {
    const baseline = runLocationEngine(fixture());
    const crowded = fixture();
    crowded.savedPlaces = [...crowded.savedPlaces, ...farPlaces(crowded, 500, 2_000)];
    const output = runLocationEngine(crowded);
    expect(output.segmentUpserts).toEqual(baseline.segmentUpserts);
    expect(output.diagnostics).toEqual(baseline.diagnostics);
  });
});
