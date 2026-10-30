import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("../../../modules/dayframe-place-search", () => ({
  addSuggestionsListener: vi.fn(), addSearchErrorListener: vi.fn(), cancel: vi.fn(), cancelNearby: vi.fn(), isAvailable: () => false,
  resolveNearby: vi.fn(), resolveSuggestion: vi.fn(), searchNearby: vi.fn(), setQuery: vi.fn()
}));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: vi.fn(), getLastKnownPositionAsync: vi.fn() }));
const mocks = vi.hoisted(() => ({ search: vi.fn(), emit: null as null | ((state: unknown) => void), searchAvailable: false, updateQuery: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }
}));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon" }));
vi.mock("./useCheckVenueGuess", () => ({ streetOf: (subtitle: string | null | undefined) => subtitle?.split(",")[0]?.trim() || null }));
vi.mock("../InsetDivider", () => ({ InsetDivider: "InsetDivider" }));
vi.mock("../../lib/placeSearch", async () => {
  const actual = await vi.importActual<typeof import("../../lib/placeSearch")>("../../lib/placeSearch");
  return { ...actual, createNativeNearbyPointOfInterestProvider: () => ({ search: mocks.search, resolve: vi.fn(), cancel: vi.fn(async () => undefined) }),
    createNativePlaceSearchProvider: () => mocks.searchAvailable ? {} : null,
    PlaceSearchController: class {
      constructor(_provider: unknown, onState: (state: unknown) => void) { mocks.emit = onState; }
      updateQuery(query: string) { mocks.updateQuery(query); mocks.emit?.({ requestId: "r", query, status: "typing", suggestions: [], message: null }); }
      dispose() {}
    } };
});

const { SheetNearbySearch } = await import("./SheetNearbySearch");

// Synthetic places only: a café and a gym the same distance from the visit's centre.
const theme = new Proxy({}, { get: (_target, key) => String(key) }) as never;
const centre = { latitude: 10, longitude: 20 };
const evidence = (minutes: number) => ({
  segment: { startedAt: "2026-10-21T10:00:00.000Z", stoppedAt: new Date(Date.parse("2026-10-21T10:00:00.000Z") + minutes * 60_000).toISOString() },
  map: { centre: { type: "Point", coordinates: [20, 10] }, acceptedSamples: [] },
  venue: { confirmedPlaceId: null, suggestedPlaceId: null, historyPlaceIds: [] }
}) as never;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("the sheet's Nearby list (PRD D23; Codex r1 on #620)", () => {
  it("ranks again when the visit's times change at the same centre, and fences each guess to its visit", async () => {
    mocks.search.mockImplementation(async ({ requestId }: { requestId: string }) => ({
      requestId, areasOfInterest: [],
      places: [
        { id: "c", requestId, title: "Alder Café", subtitle: null, distanceMeters: 20, category: "Cafe", offsetEastMeters: 20, offsetNorthMeters: 0, source: "nearby" },
        { id: "g", requestId, title: "Birch Fitness", subtitle: null, distanceMeters: 20, category: "FitnessCenter", offsetEastMeters: -20, offsetNorthMeters: 0, source: "nearby" },
        { id: "f", requestId, title: "Cedar Books", subtitle: null, distanceMeters: 300, category: "Store", offsetEastMeters: 0, offsetNorthMeters: 300, source: "nearby" }
      ]
    }));
    const guesses: Array<[string | null, string]> = [];
    const onGuess = (venue: { name: string } | null, proposal: string) => guesses.push([venue?.name ?? null, proposal]);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<SheetNearbySearch centre={centre} evidence={evidence(25)} onGuess={onGuess} onPick={vi.fn()} theme={theme} />); });
    await settle();
    const short = guesses.at(-1)!;
    expect(short[0]).toBe("Alder Café");
    await act(async () => { tree.update(<SheetNearbySearch centre={centre} evidence={evidence(90)} onGuess={onGuess} onPick={vi.fn()} theme={theme} />); });
    await settle();
    expect(mocks.search).toHaveBeenCalledTimes(2);
    const long = guesses.at(-1)!;
    expect(long[0]).toBe("Birch Fitness");
    expect(long[1]).not.toBe(short[1]);
    // The rows show nearest first, whatever the ranking.
    const titles = tree.root.findAll((node) => node.type === ("Text" as never) && node.props.numberOfLines === 1 && typeof node.props.children === "string")
      .map((node) => node.props.children);
    expect(titles.indexOf("Cedar Books")).toBeGreaterThan(Math.max(titles.indexOf("Alder Café"), titles.indexOf("Birch Fitness")));
  });

  const nearbyAnswer = async ({ requestId }: { requestId: string }) => ({ requestId, areasOfInterest: [], places: ["a", "b", "c", "d", "e"].map((id, index) => ({
    id, requestId, title: `Place ${id}`, subtitle: null, distanceMeters: 40 + index * 30, category: "Store", offsetEastMeters: 40 + index * 30, offsetNorthMeters: 0, source: "nearby" })) });
  const ids = (tree: ReturnType<typeof create>, prefix: string) => tree.root.findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith(prefix) && typeof node.props.onPress === "function")
    .map((node) => node.props.testID.slice(prefix.length));
  const saved = (text: string) => (text ? [] : [{ key: "s1", title: "Library", detail: "Saved place · 120 m away", glyph: "map-pin", checked: false, onPress: vi.fn() }, { key: "s2", title: "Gym", detail: "Saved place", glyph: "map-pin", checked: false, onPress: vi.fn() }]) as never[];
  const type = (tree: ReturnType<typeof create>, text: string) => act(() => { tree.root.findByProps({ testID: "location-correction-search" }).props.onChangeText(text); });

  it("lists Apple's three nearest, then the sheet's saved rows, in the same row with the same distance wording", async () => {
    mocks.search.mockImplementation(nearbyAnswer);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<SheetNearbySearch centre={centre} evidence={evidence(25)} onPick={vi.fn()} savedRows={saved} theme={theme} />); });
    await settle();
    expect(ids(tree, "location-correction-nearby-")).toEqual(["a", "b", "c"]);
    expect(ids(tree, "location-correction-place-")).toEqual(["s1", "s2"]);
    const label = (testID: string) => tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID)[0].props.accessibilityLabel;
    expect(label("location-correction-nearby-a")).toBe("Place a, 40 m away");
    expect(label("location-correction-place-s1")).toBe("Library, Saved place · 120 m away");
  });

  it("keeps one height and the old rows while searching, with a quiet spinner and a pinned Save slot", async () => {
    mocks.searchAvailable = true;
    mocks.search.mockImplementation(nearbyAnswer);
    const onSaveTyped = vi.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<SheetNearbySearch centre={centre} evidence={evidence(25)} onPick={vi.fn()} onSaveTyped={onSaveTyped} reduceMotion theme={theme} />); });
    await settle();
    const height = () => tree.root.findByProps({ testID: "location-correction-results" }).props.style.height;
    expect(height()).toBe(260);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-save-typed")).toHaveLength(0);
    type(tree, "Pret");
    // Searching: the rows stay, the spinner is in the field (still under Reduce Motion), and Save has its slot.
    expect(ids(tree, "location-correction-nearby-")).toEqual(["a", "b", "c"]);
    const spinner = tree.root.findByProps({ testID: "location-correction-search-spinner" });
    expect(spinner.props).toMatchObject({ animating: false, hidesWhenStopped: false });
    expect(height()).toBe(260);
    act(() => { tree.root.findAll((node) => node.props.testID === "location-correction-save-typed" && typeof node.props.onPress === "function")[0].props.onPress(); });
    expect(onSaveTyped).toHaveBeenCalledWith("Pret");
    // The answer replaces the rows, at most three, and the spinner goes.
    act(() => { mocks.emit?.({ requestId: "r", query: "Pret", status: "results", message: null,
      suggestions: ["1", "2", "3", "4"].map((id) => ({ id, title: `Pret ${id}`, subtitle: "1 High Street" })) }); });
    expect(ids(tree, "location-correction-nearby-")).toEqual(["1", "2", "3"]);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-search-spinner")).toHaveLength(0);
    // The next search holds those rows until it answers; a blank field brings Nearby back.
    type(tree, "Pret A");
    expect(ids(tree, "location-correction-nearby-")).toEqual(["1", "2", "3"]);
    type(tree, "");
    expect(ids(tree, "location-correction-nearby-")).toEqual(["a", "b", "c"]);
    mocks.searchAvailable = false;
  });

  it("never spins for text too short to search", async () => {
    mocks.searchAvailable = true;
    mocks.search.mockImplementation(nearbyAnswer);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<SheetNearbySearch centre={centre} evidence={evidence(25)} onPick={vi.fn()} theme={theme} />); });
    await settle();
    type(tree, "P");
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-search-spinner")).toHaveLength(0);
    expect(ids(tree, "location-correction-nearby-")).toEqual(["a", "b", "c"]);
    mocks.searchAvailable = false;
  });

  it("with no centre, searches only the saved places: nothing goes to Apple", async () => {
    mocks.search.mockClear();
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<SheetNearbySearch centre={null} onPick={vi.fn()} savedRows={saved} theme={theme} />); });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(ids(tree, "location-correction-place-")).toEqual(["s1", "s2"]);
  });
});
