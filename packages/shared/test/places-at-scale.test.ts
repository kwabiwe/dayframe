import { describe, expect, it, vi } from "vitest";
import {
  indexPlacesByLatitude,
  LOCATION_ENGINE_V2_CONFIG,
  matchLocationToPlaces,
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

  it("picks the same place with and without the band, near-ties included (Codex r1 on #507)", () => {
    // Codex's reduced repro: the distance tolerance is not transitive, so far places used to change the winner.
    const at = (suffix: number, latitude: number, priority: number): SavedPlaceForMatching =>
      ({ id: `91000000-0000-4000-8000-0000000000${suffix}`, name: `P${suffix}`, latitude, longitude: 0, radiusMeters: 100, priority });
    const repro = [at(21, 0.0002174642, 0), at(24, 0.0002877333, 3), at(25, 1, 1), at(26, 0.0002533564, 3), at(27, 1, 3),
      at(28, 0.0003093777, 3), at(29, 0.0002387847, 3)];
    const reading = { latitude: 0, longitude: 0, horizontalAccuracyMeters: 10 };
    const pruned = placesNearLatitude(indexPlacesByLatitude(repro, LOCATION_ENGINE_V2_CONFIG), 0);
    expect(pruned.length).toBeLessThan(repro.length);
    expect(matchLocationToPlaces(reading, pruned, [], LOCATION_ENGINE_V2_CONFIG).placeId)
      .toBe(matchLocationToPlaces(reading, repro, [], LOCATION_ENGINE_V2_CONFIG).placeId);
    // And across many generated catalogues of overlapping and far places, saved and learned.
    let seed = 11;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    for (let round = 0; round < 300; round += 1) {
      const saved: SavedPlaceForMatching[] = Array.from({ length: 12 }, (_, i) => ({
        id: `92000000-0000-4000-8000-${String(round * 100 + i).padStart(12, "0")}`, name: "S",
        latitude: next() < 0.6 ? (next() - 0.5) * 0.004 : (next() - 0.5) * 2, longitude: (next() - 0.5) * 0.004,
        radiusMeters: 30 + Math.round(next() * 200), priority: Math.floor(next() * 4)
      }));
      const learned = saved.slice(0, 3).map((place, i) => ({ ...place, id: `93000000-0000-4000-8000-${String(round * 100 + i).padStart(12, "0")}`,
        latitude: place.latitude + (next() - 0.5) * 0.0004, accepted: true as const }));
      const probe = { latitude: (next() - 0.5) * 0.004, longitude: (next() - 0.5) * 0.004, horizontalAccuracyMeters: Math.round(next() * 80),
        savedPlaceIdHint: next() < 0.2 ? saved[0].id : null, activePlaceId: next() < 0.2 ? saved[1].id : null };
      const full = matchLocationToPlaces(probe, saved, learned, LOCATION_ENGINE_V2_CONFIG);
      const banded = matchLocationToPlaces(probe,
        placesNearLatitude(indexPlacesByLatitude(saved, LOCATION_ENGINE_V2_CONFIG), probe.latitude),
        placesNearLatitude(indexPlacesByLatitude(learned, LOCATION_ENGINE_V2_CONFIG), probe.latitude), LOCATION_ENGINE_V2_CONFIG);
      const near = (match: typeof full) => match.candidates.filter((candidate) => candidate.matchClass !== "outside");
      expect({ kind: banded.kind, placeId: banded.placeId, near: near(banded) }).toEqual({ kind: full.kind, placeId: full.placeId, near: near(full) });
    }
  });

  it("leaves nothing out when a catalogue value breaks the band (Codex r1 on #507)", () => {
    const base = { id: "94000000-0000-4000-8000-000000000001", name: "Valid", latitude: 0, longitude: 0, radiusMeters: 100 };
    for (const broken of [{ latitude: Number.NaN }, { radiusMeters: Number.NaN }, { latitude: 360 }, { longitude: Number.POSITIVE_INFINITY }]) {
      const places = [{ ...base, id: "94000000-0000-4000-8000-000000000002", latitude: 1 }, { ...base, ...broken, id: "94000000-0000-4000-8000-000000000003" }, base];
      expect(placesNearLatitude(indexPlacesByLatitude(places, LOCATION_ENGINE_V2_CONFIG), 0)).toEqual(places);
    }
    const valid = [base];
    expect(placesNearLatitude(indexPlacesByLatitude(valid, LOCATION_ENGINE_V2_CONFIG), Number.NaN)).toEqual(valid);
  });

  it.each(fixtures)("gives %s the same engine output as the engine without the band, among 500 places (Codex r1 on #507)", async (_name, fixture) => {
    const crowded = fixture();
    crowded.savedPlaces = [...crowded.savedPlaces, ...farPlaces(crowded, 500, 150)];
    const banded = runLocationEngine(crowded);
    vi.resetModules();
    vi.doMock("../src/location/placeMatcher", async (original) => ({
      ...(await original<typeof import("../src/location/placeMatcher")>()),
      placesNearLatitude: <T,>(index: { places: T[] }) => index.places
    }));
    const unbanded = (await import("../src/location")).runLocationEngine(crowded);
    vi.doUnmock("../src/location/placeMatcher");
    vi.resetModules();
    expect(banded.segmentUpserts).toEqual(unbanded.segmentUpserts);
    expect(banded.diagnostics).toEqual(unbanded.diagnostics);
  });
});
