import { describe, expect, it, vi } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";

vi.mock("../../modules/dayframe-place-search", () => ({
  addSuggestionsListener: vi.fn(), addSearchErrorListener: vi.fn(), cancel: vi.fn(), cancelNearby: vi.fn(),
  isAvailable: () => false, resolveNearby: vi.fn(), resolveSuggestion: vi.fn(), searchNearby: vi.fn(), setQuery: vi.fn()
}));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: vi.fn(), getLastKnownPositionAsync: vi.fn() }));

const { guessTransit, transitGuessEndpoints, transitGuessLine, TRANSIT_STATION_RADIUS_METERS } = await import("./transitGuess");

// Synthetic Exampleton trip: about 2.2 km east (0.03° of longitude at 50° N).
const trip = (segment: Record<string, unknown> = {}, map: Record<string, unknown> = {}) => ({
  segment: { kind: "commute", travelMode: "automotive", timeAway: false, ...segment },
  map: { route: { type: "LineString", coordinates: [[0, 50], [0.015, 50], [0.03, 50]] }, straightLineFallback: null, ...map }
}) as unknown as Pick<LocationReviewEvidenceDto, "segment" | "map">;

const station = (id: string, title: string, distanceMeters: number, category = "PublicTransport") => ({
  id, requestId: "", title, subtitle: null, distanceMeters, category, offsetEastMeters: distanceMeters, offsetNorthMeters: 0, source: "nearby" as const
});

function provider(...answers: ReturnType<typeof station>[][]) {
  let call = 0;
  const search = vi.fn(async ({ requestId }: { requestId: string }) => ({
    requestId,
    areasOfInterest: [],
    places: (answers[call++] ?? []).map((place) => ({ ...place, requestId }))
  }));
  return { search, resolve: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) };
}

describe("transitGuessEndpoints", () => {
  it("checks a driven or unknown-mode journey from its route's ends", () => {
    expect(transitGuessEndpoints(trip())).toEqual({ start: { latitude: 50, longitude: 0 }, end: { latitude: 50, longitude: 0.03 } });
    expect(transitGuessEndpoints(trip({ travelMode: null }))).not.toBeNull();
    expect(transitGuessEndpoints(trip({ travelMode: undefined }, { route: null, straightLineFallback: { type: "LineString", coordinates: [[0, 50], [0.03, 50]] } }))).not.toBeNull();
  });

  it("skips a stay, time away, a walk or ride, and a short trip", () => {
    expect(transitGuessEndpoints(trip({ kind: "stay" }))).toBeNull();
    expect(transitGuessEndpoints(trip({ timeAway: true }))).toBeNull();
    for (const travelMode of ["walking", "running", "cycling"]) expect(transitGuessEndpoints(trip({ travelMode }))).toBeNull();
    expect(transitGuessEndpoints(trip({}, { route: { type: "LineString", coordinates: [[0, 50], [0.004, 50]] } }))).toBeNull();
    expect(transitGuessEndpoints(trip({}, { route: null, straightLineFallback: null }))).toBeNull();
  });
});

describe("guessTransit", () => {
  const ends = transitGuessEndpoints(trip())!;

  it("names both stations when the trip starts and ends at one", async () => {
    const native = provider([station("a", "Exampleton Station", 60)], [station("b", "Kelp Station", 90)]);
    await expect(guessTransit(native, ends, () => true)).resolves.toEqual({ from: "Exampleton Station", to: "Kelp Station" });
    expect(native.search).toHaveBeenCalledTimes(2);
    expect(transitGuessLine({ from: "Exampleton Station", to: "Kelp Station" })).toBe("Looks like public transport · Exampleton Station → Kelp Station");
  });

  it("stops after the start when it isn't a station, and never counts a bus stop or a far station", async () => {
    const shop = provider([{ ...station("s", "Alder Books", 20), category: "Store" }]);
    await expect(guessTransit(shop, ends, () => true)).resolves.toBeNull();
    expect(shop.search).toHaveBeenCalledTimes(1);
    await expect(guessTransit(provider([station("k", "Market Street (Stop K)", 10)]), ends, () => true)).resolves.toBeNull();
    await expect(guessTransit(provider([station("f", "Far Station", TRANSIT_STATION_RADIUS_METERS + 20)]), ends, () => true)).resolves.toBeNull();
    await expect(guessTransit(provider([station("a", "Exampleton Station", 60)], [station("k", "High Road (Stop K)", 10)]), ends, () => true)).resolves.toBeNull();
  });

  it("gives up when it is no longer current", async () => {
    let current = true;
    const native = provider([station("a", "Exampleton Station", 60)], [station("b", "Kelp Station", 90)]);
    native.search.mockImplementationOnce(async ({ requestId }: { requestId: string }) => {
      current = false;
      return { requestId, areasOfInterest: [], places: [{ ...station("a", "Exampleton Station", 60), requestId }] };
    });
    await expect(guessTransit(native, ends, () => current)).resolves.toBeNull();
    expect(native.search).toHaveBeenCalledTimes(1);
  });
});
