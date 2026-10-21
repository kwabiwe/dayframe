import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  freshestGeofenceFix,
  GEOFENCE_POSITION_MAX_AGE_MS,
  GEOFENCE_REFRESH_MAX_RADIUS_METERS,
  GEOFENCE_REFRESH_MIN_RADIUS_METERS,
  insideRefreshCircle,
  IOS_GEOFENCE_LIMIT,
  selectGeofencePlaces,
  type GeofenceCandidate
} from "./geofenceSelection";

// Synthetic places on a made-up grid around (10, 20); 0.01° of latitude is about 1.1 km.
const here = { latitude: 10, longitude: 20 };
function place(index: number, overrides: Partial<GeofenceCandidate> = {}): GeofenceCandidate {
  return {
    id: `place-${String(index).padStart(3, "0")}`,
    latitude: 10 + index * 0.01,
    longitude: 20,
    radiusMeters: 100,
    priority: 0,
    ...overrides
  };
}
const ids = (places: GeofenceCandidate[]) => places.map((item) => item.id);

describe("nearest-place geofence selection (location v3 PR 16b)", () => {
  it("watches every place in today's priority order when twenty or fewer have a location", () => {
    const places = Array.from({ length: IOS_GEOFENCE_LIMIT }, (_, index) => place(index + 1, { priority: index % 3 }));
    const selection = selectGeofencePlaces(places, here);
    expect(selection.mode).toBe("all");
    expect(selection.refresh).toBeNull();
    expect(selection.unwatched).toEqual([]);
    // Priority, then the smaller radius, then id: the same order whether or not a position is known.
    expect(ids(selection.places)).toEqual(ids(selectGeofencePlaces(places, null).places));
    expect(selection.places[0].priority).toBe(2);
  });

  it("does not count places without a location against the limit", () => {
    const places = [
      ...Array.from({ length: IOS_GEOFENCE_LIMIT }, (_, index) => place(index + 1)),
      place(90, { latitude: null }),
      place(91, { longitude: undefined })
    ];
    const selection = selectGeofencePlaces(places, here);
    expect(selection.mode).toBe("all");
    expect(selection.places).toHaveLength(IOS_GEOFENCE_LIMIT);
    expect(ids(selection.places)).not.toContain("place-090");
  });

  it("above twenty, keeps Home and Work and then the nearest places, leaving one slot for the refresh circle", () => {
    const home = place(200, { role: "home", priority: -5 });
    const work = place(201, { role: "work" });
    const others = Array.from({ length: 30 }, (_, index) => place(30 - index, { priority: index }));
    const selection = selectGeofencePlaces([...others, home, work], here);
    expect(selection.mode).toBe("nearest");
    expect(selection.places).toHaveLength(IOS_GEOFENCE_LIMIT - 1);
    // Home and Work come first (between them, in priority order), however far away they are.
    expect(ids(selection.places.slice(0, 2))).toEqual(["place-201", "place-200"]);
    // Distance, not priority: places 1–17 are the nearest even though place 30 has the top priority.
    expect(ids(selection.places.slice(2))).toEqual(Array.from({ length: 17 }, (_, index) => `place-${String(index + 1).padStart(3, "0")}`));
    expect(ids(selection.unwatched)).toEqual(Array.from({ length: 13 }, (_, index) => `place-${String(index + 18).padStart(3, "0")}`));
    expect(selection.refresh).toMatchObject({ latitude: 10, longitude: 20 });
  });

  it("reaches the refresh circle to the edge of the nearest unwatched place", () => {
    const places = Array.from({ length: 21 }, (_, index) => place(index + 1, { latitude: 10 + (index + 1) * 0.005 }));
    const selection = selectGeofencePlaces(places, here);
    const firstUnwatched = selection.unwatched[0];
    expect(firstUnwatched.id).toBe("place-020");
    const edge = distanceMeters(10, 20, firstUnwatched.latitude, firstUnwatched.longitude) - 100;
    expect(selection.refresh!.radiusMeters).toBe(Math.round(edge));
    // The farthest watched place is inside the circle's reach.
    const farthestWatched = selection.places.at(-1)!;
    expect(distanceMeters(10, 20, farthestWatched.latitude, farthestWatched.longitude) - 100)
      .toBeLessThanOrEqual(selection.refresh!.radiusMeters);
  });

  it("keeps the refresh circle between its minimum and maximum radius", () => {
    // Dense: 25 places within a few hundred metres.
    const dense = Array.from({ length: 25 }, (_, index) => place(index + 1, { latitude: 10 + index * 0.0002 }));
    expect(selectGeofencePlaces(dense, here).refresh!.radiusMeters).toBe(GEOFENCE_REFRESH_MIN_RADIUS_METERS);
    // Sparse: the 20th place is hundreds of kilometres away.
    const sparse = Array.from({ length: 25 }, (_, index) => place(index + 1, { latitude: 10 + (index < 19 ? index * 0.001 : 5 + index) }));
    expect(selectGeofencePlaces(sparse, here).refresh!.radiusMeters).toBe(GEOFENCE_REFRESH_MAX_RADIUS_METERS);
  });

  it("measures to a place's circle, so a large place near the phone counts as near", () => {
    const places = Array.from({ length: 20 }, (_, index) => place(index + 1, { latitude: 10.05 + index * 0.001 }));
    const large = place(99, { latitude: 10.07, radiusMeters: 2000 });
    const selection = selectGeofencePlaces([...places, large], here);
    expect(ids(selection.places)).toContain("place-099");
  });

  it("breaks exact distance ties the same way whatever the input order", () => {
    // Pairs mirrored east and west of the phone are exactly as far.
    const places = Array.from({ length: 24 }, (_, index) => place(index + 1, {
      latitude: 10,
      longitude: 20 + (index % 2 === 0 ? 1 : -1) * (Math.floor(index / 2) + 1) * 0.01
    }));
    const forward = selectGeofencePlaces(places, here);
    const backward = selectGeofencePlaces([...places].reverse(), here);
    expect(ids(forward.places)).toEqual(ids(backward.places));
    expect(forward.refresh).toEqual(backward.refresh);
    // The 19th slot is half of a tied pair: the lower id wins.
    expect(ids(forward.places)).toContain("place-019");
    expect(ids(forward.places)).not.toContain("place-020");
  });

  it("falls back to today's priority order, with Home and Work kept, when the position is unknown", () => {
    const home = place(200, { role: "home", priority: -5 });
    const others = Array.from({ length: 25 }, (_, index) => place(index + 1, { priority: 100 - index }));
    for (const position of [null, { latitude: Number.NaN, longitude: 20 }]) {
      const selection = selectGeofencePlaces([...others, home], position);
      expect(selection.mode).toBe("priority");
      expect(selection.refresh).toBeNull();
      expect(selection.places).toHaveLength(IOS_GEOFENCE_LIMIT);
      expect(ids(selection.places)).toEqual(["place-200", ...Array.from({ length: 19 }, (_, index) => `place-${String(index + 1).padStart(3, "0")}`)]);
    }
  });

  it("tells whether a position is inside the refresh circle", () => {
    const circle = { latitude: 10, longitude: 20, radiusMeters: 1000 };
    expect(insideRefreshCircle({ latitude: 10.005, longitude: 20 }, circle)).toBe(true);
    expect(insideRefreshCircle({ latitude: 10.02, longitude: 20 }, circle)).toBe(false);
  });

  it("re-picks only from a recent, accurate enough reading, the newest first", () => {
    const now = Date.parse("2026-10-21T08:00:00.000Z");
    const fix = (minutesAgo: number, accuracy: number | null = 20) =>
      ({ latitude: 10, longitude: 20 + minutesAgo / 1000, accuracy, timestamp: now - minutesAgo * 60_000 });
    expect(freshestGeofenceFix([fix(10), fix(2), fix(5)], now)).toEqual(fix(2));
    expect(freshestGeofenceFix([fix(GEOFENCE_POSITION_MAX_AGE_MS / 60_000 + 1)], now)).toBeNull();
    expect(freshestGeofenceFix([fix(1, 5000)], now)).toBeNull();
    expect(freshestGeofenceFix([fix(1, null)], now)).toEqual(fix(1, null));
    expect(freshestGeofenceFix([fix(-5)], now)).toBeNull();
    expect(freshestGeofenceFix([null, undefined, { ...fix(1), latitude: Number.NaN }], now)).toBeNull();
  });
});
