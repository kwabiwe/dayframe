import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TimelineTrip } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  Keyboard: { addListener: () => ({ remove: vi.fn() }), dismiss: vi.fn() },
  Modal: "Modal",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {}, hairlineWidth: 1 }
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native-screens", () => ({ FullWindowOverlay: "FullWindowOverlay" }));
vi.mock("@/lib/reportsTypography", async () => import("../../lib/reportsTypography"));
vi.mock("@/lib/editSheetKeyboard", async () => import("../../lib/editSheetKeyboard"));
vi.mock("@/components/SwipeDismissSheet", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  const SwipeDismissSheet = React.forwardRef((props: Record<string, any>, ref: React.ForwardedRef<unknown>) => {
    const dismiss = () => {
      if (props.onDismissStart?.(props.presentationId) === false) return;
      props.onDismiss(props.presentationId);
    };
    React.useImperativeHandle(ref, () => ({ dismiss }));
    return React.createElement("SwipeDismissSheet", props, props.children);
  });
  return { SwipeDismissSheet };
});
const chain = vi.hoisted(() => () => {
  const builder: Record<string, unknown> = {};
  for (const name of ["duration", "reduceMotion", "withInitialValues"]) builder[name] = () => builder;
  return builder;
});
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: chain(),
  FadeOut: chain(),
  ReduceMotion: { Never: "never" }
}));
vi.mock("../../lib/motion", () => ({ MOBILE_MOTION: { control: 140 }, localPresenceEntering: () => ({}), localPresenceExiting: () => ({}) }));
vi.mock("../TimeWheelPanel", () => ({ TimeWheelPanel: "TimeWheelPanel" }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon" }));
vi.mock("../location/LocationEvidenceMap", () => ({ LocationEvidenceMap: "LocationEvidenceMap" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: vi.fn() }));
vi.mock("../../lib/timeWheel", () => ({ timeWheelAccessibilityStep: (ms: number, direction: number, _o: unknown, minutes: number) => ms + direction * minutes * 60_000 }));

import { LocationCorrectionSheet, type LocationCorrectionTarget } from "./LocationCorrectionSheet";

// Location v4 step 12: synthetic ids, names and times only.
const iso = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
const SAVED = "6f000000-0000-4000-8000-000000000001";
const place: TimelinePlace = {
  kind: "place", id: "seg-a", status: "finalised", startedAt: iso(0), stoppedAt: iso(60), placeId: null, learnedPlaceId: null, name: null,
  role: null, matchKind: "unknown", confidence: "low", blockIds: []
};
const trip: TimelineTrip & { route: string } = {
  kind: "trip", id: "trip-1", status: "finalised", startedAt: iso(60), stoppedAt: iso(100), fromId: "seg-a", toId: "seg-b", mode: "automotive",
  legs: [
    { startedAt: iso(60), stoppedAt: iso(70), mode: "walking", confidence: "sure", distanceMeters: 700 },
    { startedAt: iso(70), stoppedAt: iso(100), mode: "automotive", confidence: "unsure", distanceMeters: 9000 }
  ], stopIds: [], distanceMeters: 9700, confidence: "medium", reason: null, blockIds: [], route: "Unknown place → Exampleton Library"
};
const theme = new Proxy({}, { get: (_target, key) => String(key) }) as never;

function mount(target: LocationCorrectionTarget) {
  const onQueue = vi.fn();
  const onDismissed = vi.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <LocationCorrectionSheet clockFormat="24h" evidence={null} onDismissed={onDismissed} onQueue={onQueue}
        places={[{ id: SAVED, name: "Exampleton Library", role: null }]} presentationId={1} reduceMotion={false} rootHosted={false}
        target={target} theme={theme} />
    );
  });
  const press = (testID: string) => act(() => { tree.root.findByProps({ testID }).props.onPress(); });
  const has = (testID: string) => tree.root.findAll((node) => node.props.testID === testID).length > 0;
  return { onDismissed, onQueue, press, has, tree };
}

describe("the iPhone correction sheets (location v4 step 12)", () => {
  it("puts the item's map first, saying so while it loads or when it can't be read (owner feedback, 27 Oct 2026)", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    expect(JSON.stringify(sheet.tree.root.findByProps({ testID: "location-correction-map" }).props.children)).toContain("Loading the map");
    const evidence = { map: { acceptedSamples: [] }, segment: { kind: "stay" } } as never;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<LocationCorrectionSheet clockFormat="24h" evidence={evidence} onDismissed={vi.fn()} onQueue={vi.fn()} places={[]}
        presentationId={1} reduceMotion={false} rootHosted={false} target={{ kind: "trip", trip, legIndex: 1 }} theme={theme} />);
    });
    // On the leg view too: the map is there before anything else to change.
    expect(tree.root.findAllByType("LocationEvidenceMap" as never)[0].props.evidence).toBe(evidence);
  });

  it("names a place from the saved places and queues it on Done", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    expect(sheet.tree.root.findByProps({ testID: "location-correction-place-unknown" }).props.accessibilityState).toEqual({ checked: true });
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).toHaveBeenCalledWith([{
      request: { kind: "place", subject: "place", itemId: "seg-a", placeId: SAVED, learnedPlaceId: null },
      preview: { name: "Exampleton Library", role: null }
    }]);
  });

  it("queues nothing when nothing changed, and offers no place or times for a place in a block", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    const logged = mount({ kind: "place", place: { ...place, blockIds: ["entry-1"] }, label: "Unknown place" });
    expect(logged.has("location-correction-place-unknown")).toBe(false);
    expect(logged.has("location-correction-start")).toBe(false);
  });

  it("pushes a leg inside the trip, sends its mode on its Done and comes back; Back alone sends nothing", () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null });
    expect(sheet.has("location-correction-back")).toBe(false);
    sheet.press("location-correction-leg-1");
    expect(sheet.has("location-correction-back")).toBe(true);
    sheet.press("location-correction-back");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    sheet.press("location-correction-leg-1");
    sheet.press("location-correction-mode-bus");
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).toHaveBeenCalledWith([{
      request: { kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: iso(70), legStoppedAt: iso(100), mode: "bus" }
    }]);
    // Back at the trip, still open.
    expect(sheet.has("location-correction-leg-0")).toBe(true);
    expect(sheet.onDismissed).not.toHaveBeenCalled();
  });

  it("asks once, in place, before taking a trip that wasn't one off the day", () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null });
    sheet.press("location-correction-not-a-trip");
    sheet.press("location-correction-keep-trip");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    sheet.press("location-correction-not-a-trip");
    sheet.press("location-correction-remove-trip");
    expect(sheet.onQueue).toHaveBeenCalledWith([{ request: { kind: "delete", subject: "trip", itemId: "trip-1" } }]);
    const logged = mount({ kind: "trip", trip: { ...trip, blockIds: ["entry-1"] }, legIndex: 0 });
    expect(logged.has("location-correction-not-a-trip")).toBe(false);
  });
});
