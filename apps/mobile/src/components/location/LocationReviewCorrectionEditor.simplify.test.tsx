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

const keyboard = vi.hoisted(() => ({ listeners: new Map<string, (event?: unknown) => void>() }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn(), addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => true, isScreenReaderEnabled: async () => false },
  Alert: { alert: vi.fn() },
  Animated: { Value: class { setValue() {} interpolate() { return 0; } }, View: "AnimatedView", timing: () => ({ start() {}, stop() {} }) },
  Keyboard: {
    addListener: (name: string, listener: (event?: unknown) => void) => {
      keyboard.listeners.set(name, listener);
      return { remove() {} };
    },
    dismiss: vi.fn()
  },
  Platform: { OS: "ios" },
  Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 375, height: 812 })
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }) }));
const reanimated = vi.hoisted(() => ({ withTiming: vi.fn((value: number) => value) }));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: { View: "AnimatedView" },
    Easing: { out: (curve: unknown) => curve, cubic: "cubic" },
    useAnimatedStyle: (style: () => object) => style(),
    useSharedValue: (value: number) => useRef({ value }).current,
    withTiming: reanimated.withTiming
  };
});
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
vi.mock("@/lib/transitGuess", () => import("../../lib/transitGuess"));

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
let categoryList = categories;

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
let onVenueSuggested = vi.fn();
beforeEach(() => {
  focused = true;
  saving = false;
  onResolve = vi.fn(async (_action: LocationReviewAction, _message: string) => undefined);
  onVenueSuggested = vi.fn();
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

let focused = true;
let saving = false;
function editor(evidence: LocationReviewEvidenceDto, recent: string[] = [], reviewItem: object = { suggestedCategoryId: null, status: "open" }) {
  return (
    <LocationReviewCorrectionEditor
      adjacentReview={undefined}
      categories={categoryList}
      evidence={evidence}
      isFocused={focused}
      onCreateActivity={async () => ({ id: "cat-new" })}
      onResolve={onResolve}
      onVenueSuggested={onVenueSuggested}
      places={[]}
      recentActivityIds={recent}
      reviewItem={reviewItem as never}
      saving={saving}
    />
  );
}

async function render(evidence: LocationReviewEvidenceDto, recent: string[] = [], reviewItem?: object) {
  await act(async () => { tree = create(editor(evidence, recent, reviewItem)); });
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

  it("keeps the primary action at the bottom of the screen, outside the scroll view", async () => {
    await render(stay({ matched: true }));
    const bar = tree!.root.findAll((node) => node.props.testID === "location-evidence-primary-bar" && typeof node.type === "string");
    expect(bar).toHaveLength(1);
    let ancestor = bar[0].parent;
    while (ancestor) {
      expect(ancestor.type).not.toBe("ScrollView");
      ancestor = ancestor.parent;
    }
    expect(bar[0].findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button")).toHaveLength(1);
    expect(texts("Record visit")).toHaveLength(1);
  });

  it("rides the primary bar above the keyboard, and back down when it hides (Codex r1 on #480)", async () => {
    await render(stay({ matched: true }));
    reanimated.withTiming.mockClear();
    // An 812-point window with a 34-point home indicator inset; the keyboard's top at 476: the bar
    // rises by the keyboard's overlap, on the keyboard's own duration, and comes back down.
    await act(async () => keyboard.listeners.get("keyboardWillChangeFrame")?.({ duration: 250, endCoordinates: { screenY: 476 } }));
    expect(reanimated.withTiming).toHaveBeenLastCalledWith(812 - 34 - 476, expect.objectContaining({ duration: 250 }));
    await act(async () => keyboard.listeners.get("keyboardWillHide")?.({ duration: 250 }));
    expect(reanimated.withTiming).toHaveBeenLastCalledWith(0, expect.objectContaining({ duration: 250 }));
    // Prefer Cross-Fade Transitions can report a zero frame, also while the keyboard is open: no
    // space is made (Codex r2/r3 on #480).
    await act(async () => keyboard.listeners.get("keyboardWillChangeFrame")?.({ duration: 250, endCoordinates: { screenY: 476 } }));
    expect(reanimated.withTiming).toHaveBeenLastCalledWith(812 - 34 - 476, expect.objectContaining({ duration: 250 }));
    await act(async () => keyboard.listeners.get("keyboardWillChangeFrame")?.({ duration: 250, endCoordinates: { screenY: 0, height: 0 } }));
    expect(reanimated.withTiming).toHaveBeenLastCalledWith(0, expect.objectContaining({ duration: 250 }));
  });

  it("says beside Record why it did nothing, wherever the page is scrolled (Codex r1 on #480)", async () => {
    const { AccessibilityInfo } = await import("react-native") as unknown as { AccessibilityInfo: { announceForAccessibility: Mock } };
    const evidence = stay({ matched: true });
    (evidence.segment as { stoppedAt: string | null }).stoppedAt = null;
    await render(evidence);
    await press(primary());
    const bar = tree!.root.findAll((node) => node.props.testID === "location-evidence-primary-bar" && typeof node.type === "string")[0];
    expect(bar.findAll((node) => typeof node.type === "string" && text(node) === "This suggestion does not have a complete time range.")).not.toHaveLength(0);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("This suggestion does not have a complete time range.");
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("offers a learned name one tap away in Name, and only while the field doesn't hold it", async () => {
    await render(stay({ matched: false }), [], { suggestedCategoryId: null, title: "Swimming", rawPayload: { nameSource: "learned" } });
    const chip = () => tree!.root.findAll((node) => node.props.testID === "location-evidence-learned-name" && typeof node.type === "string");
    expect(chip()).toHaveLength(1);
    expect(chip()[0].props.accessibilityLabel).toBe("Use the name Swimming");
    await press(chip()[0]);
    expect(tree!.root.findAll((node) => isHost(node, "TextInput") && node.props.value === "Swimming")).toHaveLength(1);
    expect(chip()).toHaveLength(0);
    await press(primary());
    // Using the chip is the person's own choice: a typed name, which teaches the pattern.
    expect((onResolve.mock.calls[0][0] as { edit?: { description?: string; descriptionTyped?: boolean } }).edit)
      .toMatchObject({ description: "Swimming", descriptionTyped: true });
  });

  it("never sends a learned name the person did not choose as typed", async () => {
    // A stay whose display title is the learned name starts with it in Name, untouched.
    const evidence = stay({ matched: false });
    (evidence.display as { title: string }).title = "Swimming";
    await render(evidence, [], { suggestedCategoryId: null, title: "Swimming", rawPayload: { nameSource: "learned" } });
    expect(byTestId("location-evidence-learned-name")).toHaveLength(0);
    await press(primary());
    expect((onResolve.mock.calls[0][0] as { edit?: { descriptionTyped?: boolean } }).edit?.descriptionTyped).not.toBe(true);
  });

  it("says what the suggestion rests on in one line under the map that opens to the details", async () => {
    const evidence = stay({ matched: true });
    (evidence.map as { gaps: unknown[] }).gaps = [{ startedAt: "2026-08-14T09:20:00Z", stoppedAt: "2026-08-14T09:45:00Z", durationSeconds: 1500, fromPoint: null, toPoint: null }];
    (evidence.segment as { evidenceCount: number }).evidenceCount = 42;
    await render(evidence);
    const line = tree!.root.findAll((node) => node.props.testID === "location-evidence-line" && typeof node.type === "string")[0];
    expect(text(line)).toBe("Based on 42 readings · 25-min gap");
    expect(line.props.accessibilityState).toEqual({ expanded: false });
    expect(byTestId("location-evidence-details")).toHaveLength(0);
    await press(line);
    expect(byTestId("location-evidence-details")).toHaveLength(1);
    expect(texts("Synthetic test visit")).toHaveLength(1);
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
    expect(native.searchNearby).toHaveBeenCalledWith(expect.objectContaining({ radiusMeters: 400, limit: 60 }));
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
    // Its ✕ goes back to no place.
    await press(byLabel("Clear Example Bakery")[0]);
    expect(texts("Record visit")).toHaveLength(1);
  });

  it("asks the map to show each place chosen from a list, never one chosen on the map (Codex r3 on #482)", async () => {
    native.resolveNearby.mockResolvedValue({
      suggestionId: "poi-a", title: "Example Bakery", subtitle: "2 Example Road", name: "Example Bakery",
      formattedAddress: "2 Example Road", latitude: 10.003, longitude: 20.0001
    });
    await render(stay({ matched: true }));
    const token = () => map.props!.revealChoiceToken as number;
    const opening = token();
    await press(byTestId("location-evidence-nearby-0")[0]);
    expect(map.props!.selectedPoint).toEqual({ latitude: 10.003, longitude: 20.0001 });
    expect(token()).toBe(opening + 1);
    // Back to the match from its row: shown again, and again for a second tap at the same point.
    const studio = () => tree!.root.findAll((node) => node.props.accessibilityRole === "radio" && typeof node.type === "string"
      && String(node.props.accessibilityLabel).startsWith("Example Studio"))[0];
    await press(studio());
    expect(token()).toBe(opening + 2);
    await press(studio());
    expect(token()).toBe(opening + 3);
    // A tap on the place's own marker is on the map, so the map stays put.
    act(() => { (map.props!.onSelectSavedPlace as (id: string) => void)("place-studio"); });
    expect(token()).toBe(opening + 3);
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
    expect(byLabel("Clear Example Bakery")).toHaveLength(0);
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
    expect(byLabel("Clear Example Bakery")).toHaveLength(0);
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
    expect(byLabel("Clear Example Bakery")).toHaveLength(0);
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
    expect(byLabel("Clear Example Bakery")).toHaveLength(0);
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
    expect(byLabel("Clear Example Bakery")).toHaveLength(0);
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
    // The visible chips (the off-screen measuring copies are hidden from VoiceOver).
    const hidden = (node: ReactTestInstance | null): boolean => Boolean(node && (node.props.accessibilityElementsHidden || hidden(node.parent)));
    const labels = chips.findAll((node) => isHost(node, "Pressable") && !hidden(node)).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Set activity to Desk work", "Set activity to Reading", "All activities, 4"]);
    expect(texts("No activity")).toHaveLength(0);
  });

  it("fits the chips and All activities into two rows, keeping the chosen chip (owner, 17 Oct 2026)", async () => {
    await render(stay({ matched: false }), ["cat-read"]);
    await press(byTestId("location-evidence-activity-cat-read")[0]);
    const chips = byTestId("location-evidence-activity-chips")[0];
    const hidden = (node: ReactTestInstance | null): boolean => Boolean(node && (node.props.accessibilityElementsHidden || hidden(node.parent)));
    const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 38, x: 0, y: 0 } } });
    await act(async () => {
      chips.props.onLayout(layout(220));
      for (const node of chips.findAll((candidate) => typeof candidate.type === "string" && hidden(candidate) && candidate.props.onLayout)) node.props.onLayout(layout(150));
      byTestId("location-evidence-activity-all")[0].props.onLayout(layout(100));
    });
    // 220 wide, 150-wide chips: one chip and the pill take two rows; the chosen Reading stays.
    const visible = byTestId("location-evidence-activity-chips")[0].findAll((node) => isHost(node, "Pressable") && !hidden(node))
      .map((node) => node.props.accessibilityLabel);
    expect(visible).toEqual(["Set activity to Reading", "All activities, 4"]);
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
    // The pick never unmounts the picker (TestFlight 124, 20 Oct 2026): it stays mounted while its
    // sheet runs its exit, and the editor removes it only from onClose, once that exit has run.
    picker.props = null;
    await act(async () => {
      byTestId("location-evidence-activity-all")[0].props.onLayout({ nativeEvent: { layout: { height: 36, width: 120, x: 0, y: 0 } } });
    });
    expect(picker.props).not.toBeNull();
    await act(async () => (picker.props!.onClose as () => void)());
    picker.props = null;
    await act(async () => {
      byTestId("location-evidence-activity-all")[0].props.onLayout({ nativeEvent: { layout: { height: 36, width: 140, x: 0, y: 0 } } });
    });
    expect(picker.props).toBeNull();
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

  // Location v3 PR 8: Apple Place IDs, never names, go to the server.
  describe("venue Place IDs", () => {
    const confident = (request: { requestId: string }) => ({
      requestId: request.requestId,
      areasOfInterest: [],
      places: [
        { id: "poi-s", requestId: request.requestId, title: "Freshway Superstore", subtitle: null, distanceMeters: 30, category: "FoodMarket",
          offsetEastMeters: 20, offsetNorthMeters: 20, source: "nearby", placeId: "ISYNTHETICSTORE" },
        { id: "poi-p", requestId: request.requestId, title: "Freshway Pharmacy", subtitle: null, distanceMeters: 15, category: "Pharmacy",
          offsetEastMeters: 10, offsetNorthMeters: 10, source: "nearby", placeId: "ISYNTHETICPHARMACY" }
      ]
    });

    it("records a picked nearby venue with its Place ID", async () => {
      native.searchNearby.mockImplementation(async (request: { requestId: string }) => confident(request));
      native.resolveNearby.mockResolvedValue({
        suggestionId: "poi-s", title: "Freshway Superstore", subtitle: null, name: "Freshway Superstore",
        formattedAddress: null, latitude: 10.0002, longitude: 20.0002
      });
      await render(stay({ matched: false }));
      await press(byTestId("location-evidence-nearby-0")[0]);
      await press(primary());
      expect(onResolve.mock.calls[0][0]).toMatchObject({ action: "record_poi_once", name: "Freshway Superstore", applePlaceId: "ISYNTHETICSTORE" });
    });

    it("reports the confident venue once for an unsaved stay, and not when the server already has it", async () => {
      native.searchNearby.mockImplementation(async (request: { requestId: string }) => confident(request));
      await render(stay({ matched: false }));
      expect(onVenueSuggested.mock.calls).toEqual([["20000000-0000-4000-8000-000000000001", "ISYNTHETICSTORE"]]);
      await act(async () => tree!.update(editor(stay({ matched: false }))));
      expect(onVenueSuggested).toHaveBeenCalledTimes(1);

      act(() => tree!.unmount());
      onVenueSuggested = vi.fn();
      const known = { ...stay({ matched: false }), venue: { confirmedPlaceId: null, suggestedPlaceId: "ISYNTHETICSTORE", historyPlaceIds: [] } } as LocationReviewEvidenceDto;
      await render(known);
      expect(onVenueSuggested).not.toHaveBeenCalled();
    });

    it("never reports for a decided card or while the card is being decided (Codex r1 on #522)", async () => {
      native.searchNearby.mockImplementation(async (request: { requestId: string }) => confident(request));
      await render(stay({ matched: false }), [], { suggestedCategoryId: null, status: "accepted" });
      expect(onVenueSuggested).not.toHaveBeenCalled();
      act(() => tree!.unmount());
      saving = true;
      await render(stay({ matched: false }));
      expect(onVenueSuggested).not.toHaveBeenCalled();
    });

    it("reports once per card however the nearby list reloads (Codex r1 on #522)", async () => {
      const other = (request: { requestId: string }) => ({
        ...confident(request),
        places: confident(request).places.map((place) => place.id === "poi-s" ? { ...place, placeId: "ISYNTHETICOTHER" } : place)
      });
      native.searchNearby
        .mockImplementationOnce(async (request: { requestId: string }) => confident(request))
        .mockImplementationOnce(async (request: { requestId: string }) => other(request))
        .mockImplementation(async (request: { requestId: string }) => confident(request));
      await render(stay({ matched: false }));
      for (const value of [false, true, false, true]) {
        focused = value;
        await act(async () => tree!.update(editor(stay({ matched: false }))));
      }
      expect(onVenueSuggested.mock.calls).toEqual([["20000000-0000-4000-8000-000000000001", "ISYNTHETICSTORE"]]);
    });

    it("reports once the evidence's account is known, not counting the card before (Codex r4 on #522)", async () => {
      native.searchNearby.mockImplementation(async (request: { requestId: string }) => confident(request));
      const reported = onVenueSuggested;
      // Cached evidence first: no reporter yet.
      onVenueSuggested = undefined as never;
      await render(stay({ matched: false }));
      expect(reported).not.toHaveBeenCalled();
      // The owned network read lands: the reporter arrives and the card reports once.
      onVenueSuggested = reported;
      await act(async () => tree!.update(editor(stay({ matched: false }))));
      expect(reported.mock.calls).toEqual([["20000000-0000-4000-8000-000000000001", "ISYNTHETICSTORE"]]);
    });

    it("never reports a venue for a stay at a saved place", async () => {
      native.searchNearby.mockImplementation(async (request: { requestId: string }) => confident(request));
      await render(stay({ matched: true }));
      expect(onVenueSuggested).not.toHaveBeenCalled();
    });
  });

  // Transit, a best guess only (owner, 21 Oct 2026, option A).
  describe("transit best guess", () => {
    beforeEach(() => {
      categoryList = [...categories, { id: "cat-around", name: "Getting around", color: "rust", icon: null, isPinned: false, starterKey: "travel" } as never];
    });
    afterEach(() => {
      categoryList = categories;
    });
    const drive = (travelMode: string | null = "automotive") => {
      const evidence = journey() as unknown as { segment: Record<string, unknown>; map: Record<string, unknown> };
      evidence.segment.travelMode = travelMode;
      evidence.map.route = { type: "LineString", coordinates: [[20, 10], [20.015, 10], [20.03, 10]] };
      return evidence as unknown as LocationReviewEvidenceDto;
    };
    const stations = (first: string, second: string) => {
      let call = 0;
      return async (request: { requestId: string }) => ({
        requestId: request.requestId,
        areasOfInterest: [],
        places: [{ id: `s${call}`, requestId: request.requestId, title: call++ === 0 ? first : second, subtitle: null, distanceMeters: 60,
          category: "PublicTransport", offsetEastMeters: 60, offsetNorthMeters: 0, source: "nearby" }]
      });
    };

    it("says it looks like public transport and offers the chip, which fills the name and Getting around", async () => {
      native.searchNearby.mockImplementation(stations("Exampleton Station", "Kelp Station"));
      await render(drive());
      expect(native.searchNearby).toHaveBeenCalledTimes(2);
      expect(text(byTestId("location-evidence-transit-line")[0])).toBe("Looks like public transport · Exampleton Station → Kelp Station");
      await press(byTestId("location-evidence-transit-chip")[0]);
      // Applied: the chip goes, the line stays.
      expect(byTestId("location-evidence-transit-chip")).toHaveLength(0);
      expect(byTestId("location-evidence-transit-line")).toHaveLength(1);
      await press(primary());
      expect(onResolve.mock.calls[0][0]).toMatchObject({ edit: expect.objectContaining({ description: "Public transport", categoryId: "cat-around" }) });
    });

    it("changes nothing without a tap and offers nothing when an end is no station", async () => {
      native.searchNearby.mockImplementation(stations("Exampleton Station", "Alder Books (Stop K)"));
      await render(drive(null));
      expect(byTestId("location-evidence-transit-line")).toHaveLength(0);
      await press(primary());
      expect(onResolve.mock.calls[0][0]).not.toMatchObject({ edit: expect.objectContaining({ description: "Public transport" }) });
    });

    it("never checks a walk, a ride or a run", async () => {
      native.searchNearby.mockImplementation(stations("Exampleton Station", "Kelp Station"));
      for (const mode of ["walking", "cycling", "running"]) {
        await render(drive(mode));
        act(() => tree!.unmount());
        tree = undefined;
      }
      expect(native.searchNearby).not.toHaveBeenCalled();
    });
  });
});
