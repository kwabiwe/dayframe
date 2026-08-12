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
  PlaceSearchController,
  friendlyPlaceSearchError,
  isSuitableLastKnownLocation,
  resolvePlaceSearchBias,
  robustCoordinateMedian,
  selectPlaceSearchBias
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
      { latitude: 51.73, longitude: 0.45 },
      { latitude: 51.74, longitude: 0.46 },
      { latitude: -33.86, longitude: 151.2 }
    ];
    expect(robustCoordinateMedian(saved)).toEqual({ latitude: 51.73, longitude: 0.46 });
    expect(selectPlaceSearchBias({
      selectedCoordinate: { latitude: 40.7, longitude: -74 },
      existingCoordinate: { latitude: 51.7, longitude: 0.4 },
      savedPlaceCoordinates: saved
    })).toMatchObject({ latitude: 40.7, longitude: -74 });
  });

  it("uses cached location only after existing permission and suitability checks", async () => {
    const now = Date.now();
    const grantedSource = {
      getForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
      getLastKnownPositionAsync: vi.fn().mockResolvedValue({
        coords: { latitude: 51.73, longitude: 0.47, accuracy: 45 },
        timestamp: now - 1_000
      })
    };
    await expect(resolvePlaceSearchBias({}, grantedSource)).resolves.toMatchObject({
      latitude: 51.73,
      longitude: 0.47
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
      savedPlaceCoordinates: [{ latitude: 51.7, longitude: 0.4 }]
    }, deniedSource)).resolves.toMatchObject({ latitude: 51.7, longitude: 0.4 });
    expect(deniedSource.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it("rejects stale or inaccurate cached locations and maps safe errors", () => {
    const now = Date.now();
    expect(isSuitableLastKnownLocation({
      coords: { latitude: 51.7, longitude: 0.4, accuracy: 20 },
      timestamp: now - PLACE_SEARCH_MAX_LOCATION_AGE_MS - 1
    }, now)).toBe(false);
    expect(isSuitableLastKnownLocation({
      coords: { latitude: 51.7, longitude: 0.4, accuracy: 6_000 },
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
  it("loads within 750 metres and caps visible results at three", async () => {
    const search = vi.fn().mockResolvedValue({
      requestId: "nearby-1",
      places: Array.from({ length: 5 }, (_, index) => ({
        name: `Place ${index}`,
        formattedAddress: null,
        latitude: 51.5,
        longitude: 0.4,
        distanceMeters: 50 + index
      }))
    });
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      { search, cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state)
    );

    await controller.load({ latitude: 51.5, longitude: 0.4 });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "nearby-1",
      radiusMeters: 750
    }));
    expect(states.at(-1)).toMatchObject({ status: "results" });
    expect(states.at(-1)?.places).toHaveLength(3);
    controller.dispose();
  });

  it("ignores stale results after cancellation", async () => {
    let resolveSearch!: (value: { requestId: string; places: [] }) => void;
    const search = vi.fn().mockImplementation(() => new Promise<{ requestId: string; places: [] }>((resolve) => {
      resolveSearch = resolve;
    }));
    const states: NearbyPointOfInterestState[] = [];
    const controller = new NearbyPointOfInterestController(
      { search, cancel: vi.fn().mockResolvedValue(undefined) },
      (state) => states.push(state)
    );
    const pending = controller.load({ latitude: 51.5, longitude: 0.4 });
    await controller.cancel();
    resolveSearch({ requestId: "nearby-1", places: [] });
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
        cancel: vi.fn().mockResolvedValue(undefined)
      },
      (state) => states.push(state)
    );
    await controller.load({ latitude: 51.5, longitude: 0.4 });
    expect(states.at(-1)).toMatchObject({
      status: "error",
      places: [],
      message: expect.stringContaining("search or record this as unknown")
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
