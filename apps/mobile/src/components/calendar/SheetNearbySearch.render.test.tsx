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
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  Pressable: "Pressable",
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
    createNativePlaceSearchProvider: () => null };
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
});
