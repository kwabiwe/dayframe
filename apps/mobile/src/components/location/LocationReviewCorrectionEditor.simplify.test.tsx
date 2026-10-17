import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LocationReviewAction, LocationReviewEvidenceDto } from "@dayframe/shared";

// Staging feedback D1–D3 (12 October 2026): Blocks activity chips with All activities, fewer and
// plainer place choices, and nearby places under the empty search field for every stay.

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => true, isScreenReaderEnabled: async () => false },
  Alert: { alert: vi.fn() },
  Animated: { Value: class { setValue() {} interpolate() { return 0; } }, View: "AnimatedView", timing: () => ({ start() {}, stop() {} }) },
  Keyboard: { addListener: () => ({ remove() {} }), dismiss: vi.fn() },
  Platform: { OS: "ios" },
  Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 375, height: 812 })
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Ellipse: "Ellipse", G: "G", Line: "Line", Path: "Path", Polygon: "Polygon", Polyline: "Polyline", Rect: "Rect" }));
vi.mock("@/lib/mobileTheme", () => ({
  pressable: (value: unknown) => value,
  useMobileTheme: () => ({ styles: {}, theme: {
    mode: "light",
    textPrimary: "primary", textSecondary: "secondary", textMuted: "muted-text", border: "border",
    surface: "surface", surfaceRaised: "raised", surfaceMuted: "muted", surfaceInset: "inset",
    background: "background", danger: "danger", dangerText: "dangerText"
  } })
}));
vi.mock("@/lib/motion", () => ({
  useReduceMotionPreference: () => false,
  localLayoutTransition: () => ({ marker: "local-layout" }),
  localPresenceEntering: () => ({ marker: "local-enter" }),
  localPresenceExiting: () => ({ marker: "local-exit" })
}));

// The real place-search controllers over a fake native module, so the editor's wiring is tested.
const native = vi.hoisted(() => ({
  searchNearby: vi.fn(),
  resolveNearby: vi.fn(),
  cancelNearby: vi.fn(async () => undefined),
  setQuery: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined)
}));
vi.mock("../../../modules/dayframe-place-search", () => ({
  addSuggestionsListener: () => ({ remove() {} }),
  addSearchErrorListener: () => ({ remove() {} }),
  cancel: native.cancel,
  cancelNearby: native.cancelNearby,
  isAvailable: () => true,
  resolveNearby: native.resolveNearby,
  resolveSuggestion: vi.fn(),
  searchNearby: native.searchNearby,
  setQuery: native.setQuery
}));
// The A11b time wheel panel and haptics are native; these tests render the editor's text only.
vi.mock("../TimeWheelPanel", () => ({ TimeWheelPanel: () => null }));
vi.mock("../../lib/haptics", () => ({ playHaptic: vi.fn() }));
vi.mock("expo-location", () => ({ getForegroundPermissionsAsync: vi.fn(), getLastKnownPositionAsync: vi.fn() }));
vi.mock("@/lib/placeSearch", () => import("../../lib/placeSearch"));

const picker = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../ActivityPickerSheet", () => ({
  ActivityPickerSheet: (props: Record<string, unknown>) => {
    picker.props = props;
    return null;
  }
}));
const map = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("./LocationEvidenceMap", () => ({
  LocationEvidenceMap: (props: Record<string, unknown>) => {
    map.props = props;
    return null;
  }
}));
vi.mock("@/lib/locationReviewDraft", () => import("../../lib/locationReviewDraft"));
vi.mock("@/lib/mobileTypography", () => import("../../lib/mobileTypography"));

const { LocationReviewCorrectionEditor } = await import("./LocationReviewCorrectionEditor");

const categories = [
  { id: "cat-desk", name: "Desk work", color: "blue", icon: null, isPinned: true },
  { id: "cat-errand", name: "Errands", color: "green", icon: null, isPinned: false },
  { id: "cat-gym", name: "Training", color: "orange", icon: null, isPinned: false },
  { id: "cat-read", name: "Reading", color: "purple", icon: null, isPinned: false }
] as never[];

function stay({ matched }: { matched: boolean }) {
  return {
    reviewItemId: "20000000-0000-4000-8000-000000000001",
    eventId: "20000000-0000-4000-8000-000000000002",
    segment: { id: "visit", kind: "stay", status: "finalised", startedAt: "2026-08-14T09:00:00Z", stoppedAt: "2026-08-14T10:00:00Z",
      approximateArrival: false, confidence: "medium", continuityStatus: "continuous", algorithmVersion: "location-v2.0",
      evidenceCount: 3, rejectedEvidenceCount: 0 },
    display: matched
      ? { title: "Visit at Example Studio", subtitle: null, placeId: "place-studio", placeName: "Example Studio", addressSummary: "1 Example Road" }
      : { title: "Visit at an unknown place", subtitle: null, placeId: null, placeName: null, addressSummary: null },
    map: { centre: { type: "Point", coordinates: [20, 10] }, stayRadiusMeters: 80, route: null, straightLineFallback: null,
      acceptedSamples: [], rejectedSamples: [], anchors: [], gaps: [],
      nearbySavedPlaces: matched ? [{ id: "place-studio", name: "Example Studio", distanceMeters: 12, point: { type: "Point", coordinates: [20, 10] } }] : [] },
    stops: [], suggestedSplitPoints: [], evidenceExpiresAt: null, evidenceExpired: false, rawEvidenceAvailable: true,
    textualSummary: "Synthetic test visit"
  } as unknown as LocationReviewEvidenceDto;
}

function journey() {
  const evidence = stay({ matched: false }) as unknown as { segment: Record<string, unknown>; map: Record<string, unknown>; display: Record<string, unknown> };
  evidence.segment.kind = "commute";
  evidence.map.centre = null;
  evidence.display.title = "Possible journey";
  return evidence as unknown as LocationReviewEvidenceDto;
}

let tree: ReturnType<typeof create> | undefined;
let onResolve: Mock<(action: LocationReviewAction, message: string) => Promise<void>>;
beforeEach(() => {
  onResolve = vi.fn(async (_action: LocationReviewAction, _message: string) => undefined);
  picker.props = null;
  native.searchNearby.mockReset();
  native.resolveNearby.mockReset();
  native.searchNearby.mockImplementation(async (request: { requestId: string }) => ({
    requestId: request.requestId,
    places: [
      { id: "poi-a", requestId: request.requestId, title: "Example Bakery", subtitle: "2 Example Road", distanceMeters: 35, category: "Bakery" },
      { id: "poi-b", requestId: request.requestId, title: "Example Studio", subtitle: null, distanceMeters: 40 },
      { id: "poi-c", requestId: request.requestId, title: "Example Gallery", subtitle: null, distanceMeters: 180, category: "FitnessCenter" }
    ]
  }));
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

function editor(evidence: LocationReviewEvidenceDto, recent: string[] = []) {
  return (
    <LocationReviewCorrectionEditor
      adjacentReview={undefined}
      categories={categories}
      evidence={evidence}
      isFocused
      onCreateActivity={async () => ({ id: "cat-new" })}
      onResolve={onResolve}
      places={[]}
      recentActivityIds={recent}
      reviewItem={{ suggestedCategoryId: null } as never}
      saving={false}
    />
  );
}

async function render(evidence: LocationReviewEvidenceDto, recent: string[] = []) {
  await act(async () => { tree = create(editor(evidence, recent)); });
}

const isHost = (node: ReactTestInstance, type: string) => (node.type as unknown) === type;
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? child : text(child as ReactTestInstance)).join("");
const texts = (value: string) => tree!.root.findAllByType("Text" as never).filter((node) => text(node) === value);
const byTestId = (id: string) => tree!.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const byLabel = (label: string) => tree!.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.type === "string");
const press = async (node: ReactTestInstance) => { await act(async () => { await node.props.onPress(); }); };
const primary = () => tree!.root.findAll((node) => isHost(node, "Pressable") && node.props.accessibilityRole === "button" && node.props.onPress)
  .find((node) => ["Record visit", "Record", "Save place and record", "Use place and record", "Record commute", "Record trip"].includes(text(node)))!;

describe("Location evidence polish (owner, 17 Oct 2026)", () => {
  it("labels the duration plainly on screen and tells VoiceOver it is estimated", async () => {
    const evidence = stay({ matched: true });
    (evidence.segment as { approximateArrival?: boolean }).approximateArrival = true;
    await render(evidence);
    expect(texts("Duration")).toHaveLength(1);
    expect(texts("Estimated duration")).toHaveLength(0);
    expect(tree!.root.findAll((node) => typeof node.type === "string" &&
      typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.startsWith("Estimated duration "))).not.toHaveLength(0);
  });

  it("offers Skip in neutral text and no second Record once", async () => {
    await render(stay({ matched: true }));
    const skip = tree!.root.findAll((node) => node.props.testID === "location-evidence-skip" && typeof node.type !== "string");
    expect(skip.length).toBeGreaterThan(0);
    expect(skip.every((node) => !node.props.danger)).toBe(true);
    expect(texts("Record once")).toHaveLength(0);
  });
});

describe("Where were you? (D2, D3)", () => {
  it("lists the matched place once, in plain words, with nearby places under the empty search field", async () => {
    await render(stay({ matched: true }));
    // One row for the matched place: no separate answer card and no "Current match".
    expect(texts("Example Studio")).toHaveLength(1);
    // One short line: what it is and how far (owner, 17 Oct 2026).
    expect(texts("Matched place · 10 m")).toHaveLength(1);
    expect(texts("Current match")).toHaveLength(0);
    expect(texts("Record without choosing a place")).toHaveLength(0);
    expect(texts("Search other places")).toHaveLength(0);
    // D3: a saved match no longer hides nearby places. The one named like the saved place is not repeated.
    expect(native.searchNearby).toHaveBeenCalledWith(expect.objectContaining({ radiusMeters: 400, limit: 5 }));
    expect(byTestId("location-evidence-nearby")).toHaveLength(1);
    expect(texts("Example Bakery")).toHaveLength(1);
    // Each nearby row is its kind and distance, never the address (owner, 17 Oct 2026).
    expect(texts("Bakery · 40 m")).toHaveLength(1);
    expect(texts("Gym · 180 m")).toHaveLength(1);
    expect(texts("2 Example Road")).toHaveLength(0);
    expect(tree!.root.findAll((node) => node.props.glyph === "dumbbell")).not.toHaveLength(0);
    // Nearby sits under the search field.
    const order = tree!.root.findAll((node) => typeof node.type === "string" && (node.props.accessibilityLabel === "Search places" || node.props.testID === "location-evidence-nearby"));
    expect(order.map((node) => node.props.accessibilityLabel ?? node.props.testID)).toEqual(["Search places", "location-evidence-nearby"]);
  });

  it("hides nearby places while a search is typed and brings them back when it is cleared", async () => {
    await render(stay({ matched: false }));
    const field = () => byLabel("Search places")[0];
    await act(async () => field().props.onChangeText("Ex"));
    expect(byTestId("location-evidence-nearby")).toHaveLength(0);
    await act(async () => field().props.onChangeText(""));
    expect(byTestId("location-evidence-nearby")).toHaveLength(1);
  });

  it("resolves a picked nearby place only then, shows it as the chosen row and records it once by default", async () => {
    native.resolveNearby.mockResolvedValue({
      suggestionId: "poi-a", title: "Example Bakery", subtitle: "2 Example Road", name: "Example Bakery",
      formattedAddress: "2 Example Road", latitude: 10.0001, longitude: 20.0001
    });
    await render(stay({ matched: false }));
    expect(native.resolveNearby).not.toHaveBeenCalled();
    await press(byTestId("location-evidence-nearby-0")[0]);
    expect(native.resolveNearby).toHaveBeenCalledWith({ id: "poi-a", requestId: expect.stringMatching(/^nearby-\d+$/) });
    // The chosen place is the selected row (with Remove) and leaves the nearby list.
    const chosen = tree!.root.findAll((node) => node.props.accessibilityRole === "radio" && typeof node.type === "string");
    // One short line, no address; a single ✕ clears it (owner, 17 Oct 2026).
    expect(chosen.map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.checked])).toEqual([["Example Bakery, New place · 20 m", true]]);
    expect(byLabel("Clear Example Bakery")).toHaveLength(1);
    expect(texts("Save place")).toHaveLength(0);
    expect(texts("Record")).toHaveLength(1);
    expect(tree!.root.findAll((node) => node.props.label === "Save for future visits")).not.toHaveLength(0);
    expect(byTestId("location-evidence-nearby-0")[0].props.accessibilityLabel).toMatch(/^Example Studio/);
    await press(primary());
    expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "record_poi_once", name: "Example Bakery" });
    // Remove goes back to no place.
    await press(byLabel("Clear Example Bakery")[0]);
    expect(texts("Record visit")).toHaveLength(1);
  });

  // Codex r1 on #358: a pick that resolves late never overwrites what the person did meanwhile.
  function deferNearbyResolution() {
    let finish!: () => void;
    native.resolveNearby.mockImplementation(() => new Promise((done) => {
      finish = () => done({
        suggestionId: "poi-a", title: "Example Bakery", subtitle: "2 Example Road", name: "Example Bakery",
        formattedAddress: "2 Example Road", latitude: 10.0001, longitude: 20.0001
      });
    }));
    return () => finish();
  }

  it("drops a late nearby pick after the saved match is chosen", async () => {
    const finish = deferNearbyResolution();
    await render(stay({ matched: true }));
    // Pick a nearby place, then choose the matched place before the pick resolves.
    let pick!: Promise<void>;
    act(() => { pick = byTestId("location-evidence-nearby-0")[0].props.onPress(); });
    await press(tree!.root.findAll((node) => node.props.accessibilityRole === "radio" && typeof node.type === "string")[0]);
    await act(async () => { finish(); await pick; });
    expect(byLabel("Remove Example Bakery")).toHaveLength(0);
    await press(primary());
    expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "edit_and_confirm" });
    expect(onResolve.mock.calls[0][0].action).not.toBe("record_poi_once");
  });

  it("drops a late nearby pick after a newer query is typed, keeping the query", async () => {
    const finish = deferNearbyResolution();
    await render(stay({ matched: false }));
    let pick!: Promise<void>;
    act(() => { pick = byTestId("location-evidence-nearby-0")[0].props.onPress(); });
    await act(async () => byLabel("Search places")[0].props.onChangeText("Lib"));
    await act(async () => { finish(); await pick; });
    expect(byLabel("Search places")[0].props.value).toBe("Lib");
    expect(byLabel("Remove Example Bakery")).toHaveLength(0);
    expect(texts("Record visit")).toHaveLength(1);
  });

  // Codex r2 on #358: a map-pin correction made while a pick resolves wins over the late pick.
  const pinName = () => byLabel("New saved place name")[0];
  const movePin = async (point: { latitude: number; longitude: number }) => {
    await act(async () => (map.props!.onSelectPoint as (value: typeof point) => void)(point));
  };
  const moved = { latitude: 10.002, longitude: 20.003 };

  it("drops a late nearby pick after the pin is moved, keeping the moved pin and pin editing", async () => {
    await render(stay({ matched: false }));
    await press(byTestId("location-evidence-map-pin")[0]);
    const finish = deferNearbyResolution();
    let pick!: Promise<void>;
    act(() => { pick = byTestId("location-evidence-nearby-0")[0].props.onPress(); });
    await movePin(moved);
    await act(async () => { finish(); await pick; });
    expect(map.props!.selectedPoint).toEqual(moved);
    expect(typeof map.props!.onSelectPoint).toBe("function");
    expect(byLabel("Remove Example Bakery")).toHaveLength(0);
  });

  it("drops a late nearby pick after the pin is renamed, and saves the pin's own name and coordinate", async () => {
    await render(stay({ matched: false }));
    await press(byTestId("location-evidence-map-pin")[0]);
    await movePin(moved);
    const finish = deferNearbyResolution();
    let pick!: Promise<void>;
    act(() => { pick = byTestId("location-evidence-nearby-0")[0].props.onPress(); });
    await act(async () => pinName().props.onChangeText("Corner spot"));
    await act(async () => { finish(); await pick; });
    expect(byLabel("Remove Example Bakery")).toHaveLength(0);
    expect(map.props!.selectedPoint).toEqual(moved);
    await press(tree!.root.find((node) => node.props.label === "Use this pin"));
    const save = tree!.root.findAll((node) => node.props.label === "Save for future visits" && typeof node.props.onValueChange === "function")[0];
    await act(async () => save.props.onValueChange(true));
    await press(primary());
    expect(onResolve.mock.calls[0][0]).toMatchObject({
      action: "save_place_and_confirm", name: "Corner spot", latitude: moved.latitude, longitude: moved.longitude
    });
  });

  it("drops a late nearby pick when the pin editor is opened", async () => {
    await render(stay({ matched: false }));
    const finish = deferNearbyResolution();
    let pick!: Promise<void>;
    act(() => { pick = byTestId("location-evidence-nearby-0")[0].props.onPress(); });
    await press(byTestId("location-evidence-map-pin")[0]);
    await act(async () => { finish(); await pick; });
    expect(byLabel("Remove Example Bakery")).toHaveLength(0);
    expect(typeof map.props!.onSelectPoint).toBe("function");
  });

  it("keeps recording without the matched place, behind More options", async () => {
    await render(stay({ matched: true }));
    const row = byTestId("location-evidence-record-without-place");
    expect(row).toHaveLength(1);
    await press(row[0]);
    expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "change_place_and_confirm", placeId: null });
  });

  it("does not offer it when nothing was matched", async () => {
    await render(stay({ matched: false }));
    expect(byTestId("location-evidence-record-without-place")).toHaveLength(0);
  });
});

describe("What did you do? (D1)", () => {
  it("shows wrapped Blocks chips (chosen, pinned, recent) and All activities, never a sideways scroller", async () => {
    await render(stay({ matched: false }), ["cat-read"]);
    expect(tree!.root.findAll((node) => isHost(node, "ScrollView") && node.props.horizontal)).toHaveLength(0);
    const chips = byTestId("location-evidence-activity-chips")[0];
    const labels = chips.findAll((node) => isHost(node, "Pressable")).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Set activity to Desk work", "Set activity to Reading", "All activities, 4"]);
    expect(texts("No activity")).toHaveLength(0);
  });

  it("picks with a tap, clears with a second tap, and sends the choice", async () => {
    await render(stay({ matched: false }));
    const chip = () => byTestId("location-evidence-activity-cat-desk")[0];
    await press(chip());
    expect(chip().props.accessibilityState).toEqual({ selected: true });
    await press(chip());
    expect(chip().props.accessibilityState).toEqual({ selected: false });
    await press(primary());
    expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "edit_and_confirm", edit: { categoryId: null } });
  });

  it("opens All activities with Create and puts a picked activity first, chosen", async () => {
    await render(stay({ matched: false }));
    await press(byTestId("location-evidence-activity-all")[0]);
    expect(picker.props).toMatchObject({ selectedId: null });
    expect(typeof picker.props!.onCreate).toBe("function");
    await act(async () => (picker.props!.onPick as (id: string) => void)("cat-gym"));
    const chips = byTestId("location-evidence-activity-chips")[0].findAll((node) => isHost(node, "Pressable"));
    expect(chips[0].props.accessibilityLabel).toBe("Set activity to Training");
    expect(chips[0].props.accessibilityState).toEqual({ selected: true });
    await press(primary());
    expect(onResolve.mock.calls[0][0]).toMatchObject({ edit: { categoryId: "cat-gym" } });
  });

  it("files a journey as Commute automatically until an activity is chosen, and clearing goes back to it", async () => {
    await render(journey());
    const caption = () => texts("Commute automatically, unless you choose an activity.");
    expect(caption()).toHaveLength(1);
    await press(byTestId("location-evidence-activity-cat-desk")[0]);
    expect(caption()).toHaveLength(0);
    await press(byTestId("location-evidence-activity-cat-desk")[0]);
    expect(caption()).toHaveLength(1);
    await press(primary());
    // Untouched: no categoryId, so the server files it as Commute.
    expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "edit_and_confirm" });
    expect((onResolve.mock.calls[0][0] as { edit: object }).edit).not.toHaveProperty("categoryId");
  });
});
