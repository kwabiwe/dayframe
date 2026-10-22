import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LocationReviewAction, LocationReviewEvidenceDto } from "@dayframe/shared";

// The Location evidence time wheel simplified (owner, 16 Oct 2026, TF122 staging test): every minute,
// no Every minute / Type time / Done; the same field or a tap outside closes it, the other field
// retargets it, and VoiceOver's activate opens or closes it.

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { announceForAccessibility: vi.fn(), addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => true, isScreenReaderEnabled: async () => false },
  Alert: { alert: vi.fn() },
  Animated: { Value: class { setValue() {} interpolate() { return 0; } }, View: "AnimatedView", timing: () => ({ start() {}, stop() {} }) },
  Keyboard: { addListener: () => ({ remove() {} }), dismiss: vi.fn() },
  Platform: { OS: "ios" },
  Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch",
  Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1, width: 375, height: 812 })
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 }) }));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  return {
    default: { View: "AnimatedView" },
    Easing: { out: (curve: unknown) => curve, cubic: "cubic" },
    useAnimatedStyle: (style: () => object) => style(),
    useSharedValue: (value: number) => useRef({ value }).current,
    withTiming: (value: number) => value
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
// The A11b time wheel panel is native: record what the editor renders it with.
const wheel = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../TimeWheelPanel", () => ({
  TimeWheelPanel: (props: Record<string, unknown>) => {
    wheel.props = props;
    return null;
  }
}));
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
// The Save place sheet draws a native map; these tests never open it.
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
      { id: "poi-a", requestId: request.requestId, title: "Example Bakery", subtitle: "2 Example Road", distanceMeters: 35 },
      { id: "poi-b", requestId: request.requestId, title: "Example Studio", subtitle: null, distanceMeters: 40 },
      { id: "poi-c", requestId: request.requestId, title: "Example Gallery", subtitle: null, distanceMeters: 180 }
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

const field = (label: "Start" | "End") => tree!.root.findAll((node) => isHost(node, "Pressable") && node.props.accessibilityLabel === label)[0];
const screen = () => tree!.root.findAll((node) => typeof node.type === "string" && typeof node.props.onTouchStart === "function" && typeof node.props.onTouchEnd === "function")[0];
const timeRow = () => tree!.root.findAll((node) => typeof node.type === "string" && typeof node.props.onTouchStart === "function" && !node.props.onTouchEnd)[0];
// A touch bubbling up to the screen: from the time row when `inside`, passing through `via` points
// away (a drag), optionally scrolling the page, and ending `moved` points away.
async function touch({ inside = false, moved = 0, via, scroll = false }: { inside?: boolean; moved?: number; via?: number; scroll?: boolean } = {}) {
  await act(async () => {
    if (inside) timeRow().props.onTouchStart();
    screen().props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 300 } });
    if (via !== undefined) screen().props.onTouchMove({ nativeEvent: { pageX: 100, pageY: 300 + via } });
    if (scroll) tree!.root.findAll((node) => isHost(node, "ScrollView"))[0].props.onScrollBeginDrag();
    screen().props.onTouchEnd({ nativeEvent: { pageX: 100, pageY: 300 + moved } });
  });
}
// The panel mock records its last props; clear them, re-render, and see whether it rendered again.
async function wheelShown() {
  wheel.props = null;
  await act(async () => { tree!.update(editor(stay({ matched: true }))); });
  return wheel.props as null | { model: { minuteInterval: number; valueMs: number } } & Record<string, unknown>;
}

describe("Location evidence time wheel (owner, 16 Oct 2026)", () => {
  it("opens from Start every minute with no controls, retargets to End and closes on a second tap", async () => {
    await render(stay({ matched: true }));
    expect(await wheelShown()).toBeNull();

    await press(field("Start"));
    const opened = await wheelShown();
    expect(opened?.model.minuteInterval).toBe(1);
    expect(opened?.model.valueMs).toBe(Date.parse("2026-08-14T09:00:00Z"));
    for (const removed of ["onDone", "onTypeTime", "onToggleEveryMinute", "targetLabel", "busy"]) expect(opened).not.toHaveProperty(removed);
    expect(field("Start").props.accessibilityState.expanded).toBe(true);

    await press(field("End"));
    expect((await wheelShown())?.model.valueMs).toBe(Date.parse("2026-08-14T10:00:00Z"));

    await press(field("End"));
    expect(await wheelShown()).toBeNull();
    // The fields show their times as text: no typing path.
    expect(tree!.root.findAll((node) => isHost(node, "TextInput") && node.props.keyboardType === "number-pad")).toHaveLength(0);
    expect(text(field("Start"))).toMatch(/^\d{2}:\d{2}$/);
  });

  it("closes on a tap outside, on the background or a control, but not on its own touches or a scroll (Codex r1 on #444)", async () => {
    await render(stay({ matched: true }));
    await press(field("Start"));
    // Touches on the time fields (or the panel) and a drag keep it open.
    await touch({ inside: true });
    expect(await wheelShown()).not.toBeNull();
    await touch({ moved: 40 });
    expect(await wheelShown()).not.toBeNull();
    // A drag that comes back near where it started is still a scroll (Codex r2 on #444).
    await touch({ via: 40, moved: 3 });
    expect(await wheelShown()).not.toBeNull();
    await touch({ scroll: true, moved: 2 });
    expect(await wheelShown()).not.toBeNull();
    // A tap on the background closes it.
    await touch();
    expect(await wheelShown()).toBeNull();

    // A tap on a control does its own thing and closes it too.
    await press(field("Start"));
    const chip = () => byTestId("location-evidence-activity-cat-desk")[0];
    await press(chip());
    await touch();
    expect(await wheelShown()).toBeNull();
    expect(chip().props.accessibilityState).toEqual({ selected: true });
  });

  it("lets VoiceOver open and close the wheel by activating the field, with a hint that says which", async () => {
    await render(stay({ matched: true }));
    expect(field("Start").props.accessibilityRole).toBe("adjustable");
    expect(field("Start").props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(["increment", "decrement", "activate", "plusMinute", "minusMinute"]);
    expect(field("Start").props.accessibilityHint).toContain("Double-tap to open the time wheel.");
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }); });
    expect(await wheelShown()).not.toBeNull();
    expect(field("Start").props.accessibilityHint).toContain("Double-tap to close the time wheel.");
    // A swipe moves 5 minutes; Plus / Minus 1 minute reach any minute; the open wheel follows.
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    expect((await wheelShown())?.model.valueMs).toBe(Date.parse("2026-08-14T09:05:00Z"));
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "plusMinute" } }); });
    expect((await wheelShown())?.model.valueMs).toBe(Date.parse("2026-08-14T09:06:00Z"));
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "minusMinute" } }); });
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "minusMinute" } }); });
    expect((await wheelShown())?.model.valueMs).toBe(Date.parse("2026-08-14T09:04:00Z"));
    await act(async () => { field("Start").props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }); });
    expect(await wheelShown()).toBeNull();
  });
});
