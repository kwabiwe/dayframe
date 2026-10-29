import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NearbyPointOfInterestState,
  PlaceSearchProvider,
  PlaceSearchState,
  PlaceSearchSuggestionsResult
} from "./placeSearch";

vi.mock("../../modules/dayframe-place-search", () => ({
  addSuggestionsListener: vi.fn(),
  addSearchErrorListener: vi.fn(),
  cancel: vi.fn(),
  cancelNearby: vi.fn(),
  isAvailable: () => false,
  resolveNearby: vi.fn(),
  resolveSuggestion: vi.fn(),
  searchNearby: vi.fn(),
  setQuery: vi.fn()
}));

vi.mock("expo-location", () => ({
  getForegroundPermissionsAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn()
}));

const {
  NearbyPointOfInterestController,
  PLACE_SEARCH_MAX_LOCATION_AGE_MS,
  nearbyInsideLine,
  rankedNearbyPlaces,
  venueStayFromEvidence,
  PlaceSearchController,
  friendlyPlaceSearchError,
  isSuitableLastKnownLocation,
  resolvePlaceSearchBias,
  robustCoordinateMedian,
  selectPlaceSearchBias,
  visibleNearbyPlaces
} = await import("./placeSearch");

describe("place search provider", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces two-character searches and cancels a cleared query", async () => {
    vi.useFakeTimers();
    const fake = createFakeProvider();
    const states: string[] = [];
    const controller = new PlaceSearchController(fake.provider, (state) => states.push(state.status), 250);

    controller.updateQuery("C", null);
    controller.updateQuery("Ch", null);
    await vi.advanceTimersByTimeAsync(249);
    expect(fake.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.search).toHaveBeenCalledWith("Ch", expect.objectContaining({ requestId: "place-2" }));

    controller.updateQuery("", null);
    expect(fake.cancel).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("idle");
    controller.dispose();
  });

  it("ignores stale results and caps current suggestions at six", () => {
    vi.useFakeTimers();
    const fake = createFakeProvider();
    let latest = {} as PlaceSearchState;
    const controller = new PlaceSearchController(fake.provider, (state) => { latest = state; }, 0);
    controller.updateQuery("Cher", null);
    void vi.runAllTimers();
    fake.emit({ requestId: "place-0", suggestions: suggestions("place-0", 8) });
    expect(latest.suggestions).toHaveLength(0);
    fake.emit({ requestId: "place-1", suggestions: suggestions("place-1", 8) });
    expect(latest.suggestions).toHaveLength(6);
    expect(latest.status).toBe("results");
    controller.dispose();
  });

  it("rejects selection from a stale query generation", async () => {
    const fake = createFakeProvider();
    const controller = new PlaceSearchController(fake.provider, () => undefined);
    controller.updateQuery("Home", null);
    await expect(controller.resolve({
      id: "old",
      requestId: "place-0",
      title: "Old home",
      subtitle: null
    })).rejects.toMatchObject({ code: "stale_suggestion" });
    expect(fake.resolve).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("resolves the current selection and clears resolved state when typing resumes", async () => {
    vi.useFakeTimers();
    const fake = createFakeProvider();
    let latest = {} as PlaceSearchState;
    const controller = new PlaceSearchController(fake.provider, (state) => { latest = state; }, 0);
    controller.updateQuery("Home", null);
    await vi.runAllTimersAsync();
    const [suggestion] = suggestions("place-1", 1);
    fake.emit({ requestId: "place-1", suggestions: [suggestion] });

    await expect(controller.resolve(suggestion)).resolves.toMatchObject({
      latitude: 51,
      longitude: 0
    });
    expect(latest.status).toBe("resolved");
    expect(latest.suggestions).toEqual([]);

    controller.updateQuery("Home changed", null);
    expect(latest.status).toBe("typing");
    expect(latest.suggestions).toEqual([]);
    controller.dispose();
  });

  it("uses coordinate priority and a robust saved-place median", () => {
    const saved = [
      { latitude: 10.73, longitude: 20.45 },
      { latitude: 10.74, longitude: 20.46 },
      { latitude: -33.86, longitude: 151.2 }
    ];
    expect(robustCoordinateMedian(saved)).toEqual({ latitude: 10.73, longitude: 20.46 });
    expect(selectPlaceSearchBias({
      selectedCoordinate: { latitude: 40.7, longitude: -74 },
      existingCoordinate: { latitude: 10.7, longitude: 20.4 },
      savedPlaceCoordinates: saved
    })).toMatchObject({ latitude: 40.7, longitude: -74 });
  });

  it("uses cached location only after existing permission and suitability checks", async () => {
    const now = Date.now();
    const grantedSource = {
      getForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
      getLastKnownPositionAsync: vi.fn().mockResolvedValue({
        coords: { latitude: 10.73, longitude: 20.47, accuracy: 45 },
        timestamp: now - 1_000
      })
    };
    await expect(resolvePlaceSearchBias({}, grantedSource)).resolves.toMatchObject({
      latitude: 10.73,
      longitude: 20.47
    });
    expect(grantedSource.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: PLACE_SEARCH_MAX_LOCATION_AGE_MS,
      requiredAccuracy: 5_000
    });

    const deniedSource = {
      getForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
      getLastKnownPositionAsync: vi.fn()
    };
    await expect(resolvePlaceSearchBias({
      savedPlaceCoordinates: [{ latitude: 10.7, longitude: 20.4 }]
    }, deniedSource)).resolves.toMatchObject({ latitude: 10.7, longitude: 20.4 });
    expect(deniedSource.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it("rejects stale or inaccurate cached locations and maps safe errors", () => {
    const now = Date.now();
    expect(isSuitableLastKnownLocation({
      coords: { latitude: 10.7, longitude: 20.4, accuracy: 20 },
      timestamp: now - PLACE_SEARCH_MAX_LOCATION_AGE_MS - 1
    }, now)).toBe(false);
    expect(isSuitableLastKnownLocation({
      coords: { latitude: 10.7, longitude: 20.4, accuracy: 6_000 },
      timestamp: now
    }, now)).toBe(false);
    expect(friendlyPlaceSearchError({ code: "network_unavailable" })).toContain("offline");
    expect(friendlyPlaceSearchError({ code: "provider.internal.secret" })).not.toContain("secret");
  });

  it("returns a friendly native-unavailable boundary", async () => {
    const { createNativePlaceSearchProvider } = await import("./placeSearch");
    expect(createNativePlaceSearchProvider()).toBeNull();
    expect(friendlyPlaceSearchError({ code: "search_unavailable" })).toContain(
      "Current location"
    );
  });
});

describe("nearby point of interest controller", () => {
  const poi = (title: string, distanceMeters: number, id = title, requestId = "nearby-x") => ({
    id, requestId, title, subtitle: null, distanceMeters
  });
  /** A fake native search that answers for the request it was given. */
  const answering = (...lists: Array<Array<ReturnType<typeof poi>>>) => {
    let call = 0;
    return vi.fn(async ({ requestId }: { requestId: string }) => ({
      requestId,
      places: (lists[Math.min(call++, lists.length - 1)] ?? []).map((place) => ({ ...place, requestId }))
    }));
  };
  const resolved = {
    suggestionId: "a",
    title: "Example Cafe",
    subtitle: "1 Example Road",
    name: "Example Cafe",
    formattedAddress: "1 Example Road",
    latitude: 10,
    longitude: 20
  };

  it("drops repeats, saved places already listed and anything past 400 m, and keeps five", () => {
    expect(visibleNearbyPlaces([
      poi("Library", 0), poi("Cafe", 40), poi(" CAFE ", 45, "cafe-2"), poi("Outside", 401),
      poi("Edge", 400), poi("Bakery", 100), poi("Gym", 120), poi("Pool", 130), poi("Park", 140)
    ], ["  library "]).map((place) => place.title)).toEqual(["Cafe", "Edge", "Bakery", "Gym", "Pool"]);
    expect(visibleNearbyPlaces([{ ...poi("", 10) }, { ...poi("No id", 10), id: "" }])).toEqual([]);
  });

  it("asks for the nearest 60 places, ranks them and shows five", async () => {
    const search = answering(Array.from({ length: 7 }, (_, index) => poi(`Place ${index}`, 50 + index)));
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      { search, resolve: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state),
      () => ["Place 0"]
    );

    await controller.load({ latitude: 10, longitude: 20 });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^nearby-\d+$/),
      radiusMeters: 400,
      limit: 60
    }));
    expect(states.at(-1)).toMatchObject({ status: "results" });
    // Places alike in every other way rank nearest first.
    expect(states.at(-1)?.places.map((place) => place.title)).toEqual(["Place 1", "Place 2", "Place 3", "Place 4", "Place 5"]);
    // Only opaque ids, titles, address lines, distances and the ranking reach the screen: no coordinates.
    for (const place of states.at(-1)?.places ?? []) {
      expect(Object.keys(place).sort()).toEqual(["distanceMeters", "guessed", "id", "inArea", "inside", "kind", "requestId", "share", "subtitle", "suggested", "title"]);
    }
    controller.dispose();
  });

  // Venue resolver v2 (location v3 PR 7): the visit and the areas of interest reach the ranker.
  it("puts the supermarket first with its in-store pharmacy inside it, for a 25-minute visit", async () => {
    const search = vi.fn(async ({ requestId }: { requestId: string }) => ({
      requestId,
      areasOfInterest: [],
      places: [
        { id: "p", requestId, title: "Freshway Pharmacy", subtitle: null, distanceMeters: 18, category: "Pharmacy", offsetEastMeters: 10, offsetNorthMeters: 15, source: "nearby" as const },
        { id: "s", requestId, title: "Freshway Superstore", subtitle: null, distanceMeters: 46, category: "FoodMarket", offsetEastMeters: 30, offsetNorthMeters: 35, source: "nearby" as const },
        { id: "c", requestId, title: "Bean & Bar", subtitle: null, distanceMeters: 36, category: "Cafe", offsetEastMeters: -35, offsetNorthMeters: 10, source: "nearby" as const }
      ]
    }));
    const states: NearbyPointOfInterestState[] = [];
    const stay = vi.fn(() => ({
      startedAt: "2026-10-21T10:00:00.000Z", stoppedAt: "2026-10-21T10:25:00.000Z", now: new Date("2026-10-21T12:00:00.000Z"),
      accuracyMeters: 15, spreadMeters: 20, timeZone: "Europe/London"
    }));
    const controller = new NearbyPointOfInterestController(
      { search, resolve: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state),
      () => [],
      stay
    );
    await controller.load({ latitude: 10, longitude: 20 });
    const places = states.at(-1)!.places;
    expect(places.map((place) => place.title)).toEqual(["Freshway Superstore", "Bean & Bar"]);
    expect(places[0]).toMatchObject({ inside: ["Freshway Pharmacy"], suggested: true });
    expect(nearbyInsideLine(places[0].inside)).toBe("Inside: Freshway Pharmacy");
    expect(stay).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("names the centre from its area of interest, even beyond 400 m, and summarises what is inside", () => {
    const shops = Array.from({ length: 5 }, (_, index) => ({
      ...poi(`Unit Shop ${index + 1}`, 20 + index), category: "Store", offsetEastMeters: 20 + index, offsetNorthMeters: 0
    }));
    const centre = { ...poi("Northgate Shopping Centre", 420), source: "area" as const, offsetEastMeters: 420, offsetNorthMeters: 0 };
    const ranked = rankedNearbyPlaces([...shops, centre], ["Northgate Shopping Centre"], {
      startedAt: "2026-10-21T13:00:00.000Z", stoppedAt: "2026-10-21T14:10:00.000Z", now: new Date("2026-10-21T15:00:00.000Z")
    });
    const visible = visibleNearbyPlaces(ranked);
    expect(visible.map((place) => place.title)).toEqual(["Northgate Shopping Centre"]);
    expect(nearbyInsideLine(visible[0].inside)).toBe("Inside: Unit Shop 1, Unit Shop 2 +3");
    expect(nearbyInsideLine([])).toBeNull();
  });

  it("keeps the area the visit lies in beyond 400 m even when it came from the nearby search (Codex r1 on #517)", () => {
    const shop = { ...poi("Unit Shop", 20), category: "Store", offsetEastMeters: 20, offsetNorthMeters: 0 };
    const centre = { ...poi("Northgate Shopping Centre", 420), source: "nearby" as const, offsetEastMeters: 420, offsetNorthMeters: 0 };
    const visible = visibleNearbyPlaces(rankedNearbyPlaces([shop, centre], ["Northgate Shopping Centre"], {
      startedAt: "2026-10-21T13:00:00.000Z", stoppedAt: "2026-10-21T14:00:00.000Z", now: new Date("2026-10-21T15:00:00.000Z")
    }));
    expect(visible.map((place) => [place.title, place.inside])).toEqual([["Northgate Shopping Centre", ["Unit Shop"]]]);
  });

  it("measures the visit's spread from its readings, not its matching radius (Codex r1 on #517)", () => {
    const at = (east: number, accuracyMeters: number | null) => ({
      id: `s${east}`, point: { type: "Point" as const, coordinates: [east / 71_700, 50] as [number, number] },
      occurredAt: "2026-10-21T10:00:00.000Z", accuracyMeters, kind: "location", role: null
    });
    const stay = venueStayFromEvidence({
      segment: { startedAt: "2026-10-21T10:00:00.000Z", stoppedAt: "2026-10-21T10:30:00.000Z" },
      map: { centre: { type: "Point", coordinates: [0, 50] }, stayRadiusMeters: 120, acceptedSamples: [at(4, 5), at(6, 8), at(10, null)] }
    } as unknown as Parameters<typeof venueStayFromEvidence>[0]);
    expect(stay.accuracyMeters).toBe(8);
    expect(stay.spreadMeters).toBeGreaterThan(5);
    expect(stay.spreadMeters).toBeLessThan(8);
  });

  it("never folds a listable place into one too far to list (Codex r2 on #517)", () => {
    const pharmacy = { ...poi("Freshway Pharmacy", 360), category: "Pharmacy", offsetEastMeters: 360, offsetNorthMeters: 0 };
    const store = { ...poi("Freshway Superstore", 410), category: "FoodMarket", offsetEastMeters: 410, offsetNorthMeters: 0 };
    const visible = visibleNearbyPlaces(rankedNearbyPlaces([pharmacy, store], [], {
      startedAt: "2026-10-21T10:00:00.000Z", stoppedAt: "2026-10-21T10:25:00.000Z", now: new Date("2026-10-21T11:00:00.000Z")
    }));
    expect(visible.map((place) => [place.title, place.inside])).toEqual([["Freshway Pharmacy", []]]);
  });

  it("counts a venue you picked near here before, by its Place ID (location v3 PR 8)", () => {
    const evidence = (history: string[]) => ({
      segment: { startedAt: "2026-10-21T10:00:00.000Z", stoppedAt: "2026-10-21T10:40:00.000Z" },
      map: { centre: { type: "Point", coordinates: [0, 50] }, stayRadiusMeters: 120, acceptedSamples: [] },
      venue: { confirmedPlaceId: null, suggestedPlaceId: null, historyPlaceIds: history }
    }) as unknown as Parameters<typeof venueStayFromEvidence>[0];
    const cafes = [
      { ...poi("Alder Café", 18), category: "Cafe", offsetEastMeters: 15, offsetNorthMeters: 10, placeId: "IALDER" },
      { ...poi("Birch Café", 14), category: "Cafe", offsetEastMeters: 12, offsetNorthMeters: 8, placeId: "IBIRCH" }
    ];
    expect(rankedNearbyPlaces(cafes, [], venueStayFromEvidence(evidence([])))[0].title).toBe("Birch Café");
    expect(rankedNearbyPlaces(cafes, [], venueStayFromEvidence(evidence(["IALDER"])))[0].title).toBe("Alder Café");
  });

  it("resolves a picked place from the current list only", async () => {
    const resolve = vi.fn().mockResolvedValue(resolved);
    const search = answering([poi("Example Cafe", 40, "a")], [poi("Example Cafe", 40, "b")]);
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      { search, resolve, cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state)
    );
    await controller.load({ latitude: 10, longitude: 20 });
    const first = states.at(-1)!.places[0];
    await expect(controller.resolve(first)).resolves.toEqual(resolved);
    expect(resolve).toHaveBeenCalledWith(first);

    await controller.load({ latitude: 10, longitude: 20 });
    await expect(controller.resolve(first)).rejects.toMatchObject({ code: "stale_suggestion" });
    expect(resolve).toHaveBeenCalledTimes(1);

    // A list replaced while the pick resolves is refused too.
    let finish!: (value: typeof resolved) => void;
    resolve.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const current = states.at(-1)!.places[0];
    const pending = controller.resolve(current);
    await controller.cancel();
    finish(resolved);
    await expect(pending).rejects.toMatchObject({ code: "stale_suggestion" });
    controller.dispose();
  });

  it("never reuses a request id across controllers, so a reopened screen cannot accept an old pick", async () => {
    const resolve = vi.fn().mockResolvedValue(resolved);
    const firstStates: NearbyPointOfInterestState[] = [];
    const reopened = new NearbyPointOfInterestController(
      { search: answering([poi("Example Cafe", 40, "a")]), resolve, cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => firstStates.push(state)
    );
    const oldStates: NearbyPointOfInterestState[] = [];
    const old = new NearbyPointOfInterestController(
      { search: answering([poi("Example Cafe", 40, "a")]), resolve, cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => oldStates.push(state)
    );
    await old.load({ latitude: 10, longitude: 20 });
    old.dispose();
    await reopened.load({ latitude: 10, longitude: 20 });
    const stalePick = oldStates.at(-1)!.places[0];
    expect(stalePick.requestId).not.toBe(firstStates.at(-1)!.requestId);
    await expect(reopened.resolve(stalePick)).rejects.toMatchObject({ code: "stale_suggestion" });
    expect(resolve).not.toHaveBeenCalled();
    reopened.dispose();
  });

  it("ignores stale results after cancellation", async () => {
    let resolveSearch!: (value: { requestId: string; places: [] }) => void;
    const search = vi.fn().mockImplementation(() => new Promise<{ requestId: string; places: [] }>((resolve) => {
      resolveSearch = resolve;
    }));
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      { search, resolve: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state)
    );
    const pending = controller.load({ latitude: 10, longitude: 20 });
    await controller.cancel();
    resolveSearch({ requestId: search.mock.calls[0][0].requestId, places: [] });
    await pending;
    expect(states.at(-1)).toMatchObject({ status: "idle", places: [] });
    controller.dispose();
  });

  it("keeps a safe fallback when nearby search fails", async () => {
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      {
        search: vi.fn().mockRejectedValue(Object.assign(new Error("offline"), {
          code: "network_unavailable"
        })),
        resolve: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined)
      },
      (state) => states.push(state)
    );
    await controller.load({ latitude: 10, longitude: 20 });
    expect(states.at(-1)).toMatchObject({
      status: "error",
      places: [],
      message: expect.stringContaining("You can still search")
    });
    controller.dispose();
  });
});

function createFakeProvider() {
  let listener: ((result: PlaceSearchSuggestionsResult) => void) | null = null;
  const search = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const resolve = vi.fn().mockResolvedValue({
    suggestionId: "one",
    title: "One",
    subtitle: null,
    name: "One",
    formattedAddress: null,
    latitude: 51,
    longitude: 0
  });
  const provider: PlaceSearchProvider = {
    search,
    cancel,
    resolve,
    subscribe(next) {
      listener = next;
      return () => { listener = null; };
    },
    subscribeErrors() { return () => undefined; }
  };
  return {
    provider,
    search,
    cancel,
    resolve,
    emit(result: PlaceSearchSuggestionsResult) { listener?.(result); }
  };
}

function suggestions(requestId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    requestId,
    title: `Result ${index}`,
    subtitle: null
  }));
}
