import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("../../../modules/dayframe-place-search", () => ({
  addSuggestionsListener: vi.fn(), addSearchErrorListener: vi.fn(), cancel: vi.fn(), cancelNearby: vi.fn(), isAvailable: () => false,
  resolveNearby: vi.fn(), resolveSuggestion: vi.fn(), searchNearby: vi.fn(), setQuery: vi.fn()
}));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: vi.fn(), getLastKnownPositionAsync: vi.fn() }));
const mocks = vi.hoisted(() => ({
  readEvidence: vi.fn(), revalidate: vi.fn(), search: vi.fn(), cancel: vi.fn(async () => undefined),
  appState: { current: "active", listeners: new Set<(state: string) => void>() }
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return mocks.appState.current; },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mocks.appState.listeners.add(listener);
      return { remove: () => mocks.appState.listeners.delete(listener) };
    }
  }
}));
vi.mock("../../lib/locationReviewEvidenceCache", () => ({ readLocationReviewEvidence: mocks.readEvidence, revalidateLocationReviewEvidence: mocks.revalidate }));
vi.mock("../../lib/placeSearch", async () => {
  const actual = await vi.importActual<typeof import("../../lib/placeSearch")>("../../lib/placeSearch");
  return { ...actual, createNativeNearbyPointOfInterestProvider: () => ({ search: mocks.search, resolve: vi.fn(), cancel: mocks.cancel }) };
});

const { __resetCheckVenueGuessesForTests, streetOf, useCheckVenueGuess, venueGuessEligible } = await import("./useCheckVenueGuess");
import type { MobileReviewItem } from "../../lib/api";

// Card B part 2: synthetic places, ids and coordinates only (nobody's real places).
const OWNER = { userId: "u", workspaceId: "w" };
const stay = {
  id: "item-1", title: "Unknown place", eventSource: "location_learning", eventType: "unknown_stay", rawPayload: { clientSegmentId: "seg-1" },
  suggestedStartedAt: "2026-10-27T09:00:00.000Z", suggestedStoppedAt: "2026-10-27T09:40:00.000Z", status: "open"
} as unknown as MobileReviewItem;
const evidence = {
  segment: { kind: "stay", startedAt: "2026-10-27T09:00:00.000Z", stoppedAt: "2026-10-27T09:40:00.000Z" },
  map: { centre: { type: "Point", coordinates: [20, 10] }, stayRadiusMeters: 40, acceptedSamples: [], gaps: [] },
  venue: { confirmedPlaceId: null, suggestedPlaceId: null, historyPlaceIds: [] }
};
let seen: ReturnType<typeof useCheckVenueGuess> | null = null;
function Probe({ item, owner = OWNER, onScreen = true }: { item: MobileReviewItem | null; owner?: typeof OWNER; onScreen?: boolean }) {
  seen = useCheckVenueGuess({ item, outing: false, owner, onScreen });
  return null;
}
const venueOf = (value: typeof seen) => value && { venue: value.venue, searching: value.searching };
const bakery = async ({ requestId }: { requestId: string }) => ({
  requestId, areasOfInterest: [],
  places: [{ id: "p1", requestId, title: "Exampleton Bakery", subtitle: "12 Example Street, Exampleton", distanceMeters: 8,
    category: "MKPOICategoryBakery", offsetEastMeters: 0, offsetNorthMeters: 0, source: "nearby", placeId: "I1234567890ABCDEF" }]
});
const setAppState = (state: string) => act(async () => {
  mocks.appState.current = state;
  for (const listener of mocks.appState.listeners) listener(state);
});
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("the iPhone's guess for an unnamed visit (card B part 2)", () => {
  afterEach(() => {
    __resetCheckVenueGuessesForTests();
    vi.clearAllMocks();
    mocks.appState.current = "active";
    mocks.appState.listeners.clear();
  });

  it("asks only for an unnamed visit with its window, never a named place, a trip or an outing", () => {
    expect(venueGuessEligible(stay, false)).toBe(true);
    expect(venueGuessEligible({ ...stay, title: "Office" }, false)).toBe(false);
    expect(venueGuessEligible({ ...stay, eventType: "commute_detected" }, false)).toBe(false);
    expect(venueGuessEligible(stay, true)).toBe(false);
    expect(venueGuessEligible({ ...stay, suggestedStoppedAt: null }, false)).toBe(false);
    expect(streetOf("12 Example Street, Exampleton, EX1 2AB")).toBe("12 Example Street");
    expect(streetOf(null)).toBeNull();
  });

  it("names the place the ranker is confident about, searching once for its open question", async () => {
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    mocks.search.mockImplementation(async ({ requestId }: { requestId: string }) => ({
      requestId, areasOfInterest: [],
      places: [{ id: "p1", requestId, title: "Exampleton Bakery", subtitle: "12 Example Street, Exampleton", distanceMeters: 8,
        category: "MKPOICategoryBakery", offsetEastMeters: 0, offsetNorthMeters: 0, source: "nearby", placeId: "I1234567890ABCDEF" }]
    }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)).toEqual({ venue: { name: "Exampleton Bakery", street: "12 Example Street", applePlaceId: "I1234567890ABCDEF" }, searching: false });
    // Closed and opened again: no second search.
    await act(async () => { tree.update(<Probe item={null} />); });
    await act(async () => { tree.update(<Probe item={stay} />); });
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search.mock.calls[0][0]).toMatchObject({ latitude: 10, longitude: 20 });
  });

  it("guesses nothing when the ranker isn't sure, and searches again after a failure", async () => {
    mocks.readEvidence.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ evidence, source: "network", cachedAt: null });
    mocks.search.mockImplementation(async ({ requestId }: { requestId: string }) => ({ requestId, areasOfInterest: [], places: [] }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)).toEqual({ venue: null, searching: false });
    await act(async () => { tree.update(<Probe item={null} />); });
    await act(async () => { tree.update(<Probe item={stay} />); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(venueOf(seen)).toEqual({ venue: null, searching: false });
  });

  it("never searches with the app in the background or the Calendar off screen, and searches on return", async () => {
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    mocks.search.mockImplementation(bakery);
    mocks.appState.current = "background";
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(mocks.readEvidence).not.toHaveBeenCalled();
    await act(async () => { tree.update(<Probe item={stay} onScreen={false} />); });
    await setAppState("active");
    await settle();
    expect(mocks.readEvidence).not.toHaveBeenCalled();
    await act(async () => { tree.update(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)?.venue?.name).toBe("Exampleton Bakery");
  });

  it("stops a search already running when the app goes to the background", async () => {
    let resolveEvidence!: (value: unknown) => void;
    mocks.readEvidence.mockImplementationOnce(() => new Promise((resolve) => { resolveEvidence = resolve; }))
      .mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    mocks.search.mockImplementation(bakery);
    await act(async () => { create(<Probe item={stay} />); });
    const signal = mocks.readEvidence.mock.calls[0][0].signal as AbortSignal;
    await setAppState("background");
    expect(signal.aborted).toBe(true);
    await act(async () => { resolveEvidence({ evidence, source: "cache", cachedAt: null }); });
    await settle();
    expect(mocks.search).not.toHaveBeenCalled();
    await setAppState("active");
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("gives the native search up to the editor, then searches again once the Calendar is back", async () => {
    let searchCalls = 0;
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    // The first search never answers: the editor's search cancels it.
    mocks.search.mockImplementation((request: { requestId: string }) => (++searchCalls === 1 ? new Promise(() => undefined) : bakery(request)));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(1);
    await act(async () => { seen!.release(); });
    expect(mocks.cancel).toHaveBeenCalled();
    expect(venueOf(seen)).toEqual({ venue: null, searching: false });
    // The editor is pushed over the Calendar, then closed.
    await act(async () => { tree.update(<Probe item={stay} onScreen={false} />); });
    await act(async () => { tree.update(<Probe item={stay} />); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(venueOf(seen)?.venue?.name).toBe("Exampleton Bakery");
  });

  it("is not left searching when another search cancels it without a word", async () => {
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    mocks.search.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { code: "cancelled" })).mockImplementation(bakery);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)).toEqual({ venue: null, searching: false });
    await act(async () => { tree.update(<Probe item={null} />); });
    await act(async () => { tree.update(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)?.venue?.name).toBe("Exampleton Bakery");
  });

  it("guesses again, from fresh evidence, when a replay moves the suggestion", async () => {
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    const moved = { ...stay, suggestedStartedAt: "2026-10-27T09:10:00.000Z" } as MobileReviewItem;
    const movedEvidence = { ...evidence, segment: { ...evidence.segment, startedAt: "2026-10-27T09:10:00.000Z" } };
    mocks.revalidate.mockResolvedValue({ evidence: movedEvidence, source: "network", cachedAt: null });
    mocks.search.mockImplementationOnce(async ({ requestId }: { requestId: string }) => ({ requestId, areasOfInterest: [], places: [] }))
      .mockImplementation(bakery);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    expect(venueOf(seen)).toEqual({ venue: null, searching: false });
    await act(async () => { tree.update(<Probe item={moved} />); });
    await settle();
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(venueOf(seen)?.venue?.name).toBe("Exampleton Bakery");
  });

  it("forgets the last account's guesses when another signs in", async () => {
    mocks.readEvidence.mockResolvedValue({ evidence, source: "cache", cachedAt: null });
    mocks.search.mockImplementation(bakery);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe item={stay} />); });
    await settle();
    await act(async () => { tree.update(<Probe item={stay} owner={{ userId: "u2", workspaceId: "w2" }} />); });
    await settle();
    await act(async () => { tree.update(<Probe item={stay} />); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(3);
  });
});
