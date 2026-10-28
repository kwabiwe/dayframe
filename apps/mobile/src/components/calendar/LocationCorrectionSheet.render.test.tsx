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
  TextInput: "TextInput",
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

type Queue = (corrections: unknown[], options: { closing: boolean }) => Promise<void>;
function mount(target: LocationCorrectionTarget, onQueue = vi.fn<Queue>(async () => undefined), onSavePlace?: (name: string) => Promise<void>) {
  const onDismissed = vi.fn();
  let tree!: ReturnType<typeof create>;
  const element = (next: LocationCorrectionTarget, stale = false) => (
    <LocationCorrectionSheet clockFormat="24h" evidence={null} onDismissed={onDismissed} onQueue={onQueue} onSavePlace={onSavePlace}
      places={[{ id: SAVED, name: "Exampleton Library", role: null }]} presentationId={1} reduceMotion={false} rootHosted={false}
      stale={stale} target={next} theme={theme} />
  );
  act(() => { tree = create(element(target)); });
  const press = (testID: string) => act(() => { tree.root.findByProps({ testID }).props.onPress(); });
  const has = (testID: string) => tree.root.findAll((node) => node.props.testID === testID).length > 0;
  const update = (next: LocationCorrectionTarget, stale = false) => act(() => { tree.update(element(next, stale)); });
  // A kept correction settles (its write resolves) before the sheet moves on.
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { onDismissed, onQueue, press, has, settle, tree, update };
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

  it("names a place from the saved places and queues it on Done", async () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    expect(sheet.tree.root.findByProps({ testID: "location-correction-place-unknown" }).props.accessibilityState).toEqual({ checked: true });
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).toHaveBeenCalledWith([{
      request: { kind: "place", subject: "place", itemId: "seg-a", placeId: SAVED, learnedPlaceId: null },
      preview: { name: "Exampleton Library", role: null }
    }], { closing: true });
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledTimes(1);
  });

  it("queues nothing when nothing changed, and offers no place or times for a place in a block", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    const logged = mount({ kind: "place", place: { ...place, blockIds: ["entry-1"] }, label: "Unknown place" });
    expect(logged.has("location-correction-place-unknown")).toBe(false);
    expect(logged.has("location-correction-start")).toBe(false);
  });

  it("pushes a leg inside the trip, sends its mode on its Done and comes back; Back alone sends nothing", async () => {
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
    }], { closing: false });
    await sheet.settle();
    // Back at the trip, still open.
    expect(sheet.has("location-correction-leg-0")).toBe(true);
    expect(sheet.onDismissed).not.toHaveBeenCalled();
  });

  it("asks once, in place, before taking a trip that wasn't one off the day", async () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null });
    sheet.press("location-correction-not-a-trip");
    sheet.press("location-correction-keep-trip");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    sheet.press("location-correction-not-a-trip");
    sheet.press("location-correction-remove-trip");
    expect(sheet.onQueue).toHaveBeenCalledWith([{ request: { kind: "delete", subject: "trip", itemId: "trip-1" } }], { closing: true });
    const logged = mount({ kind: "trip", trip: { ...trip, blockIds: ["entry-1"] }, legIndex: 0 });
    expect(logged.has("location-correction-not-a-trip")).toBe(false);
  });

  // Codex r1 on #602.
  it("lets an untouched end follow a refreshed item, so Done with no edit sends nothing", async () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.update({ kind: "place", place: { ...place, startedAt: iso(5), stoppedAt: iso(65) }, label: "Unknown place" });
    sheet.press("location-correction-sheet-action");
    await sheet.settle();
    expect(sheet.onQueue).not.toHaveBeenCalled();
  });

  it("keeps the picked leg by its times when a refresh merges the legs before it, and goes back if it left", async () => {
    const three = { ...trip, legs: [
      { startedAt: iso(60), stoppedAt: iso(65), mode: "walking" as const, confidence: "sure" as const, distanceMeters: 300 },
      { startedAt: iso(65), stoppedAt: iso(70), mode: "walking" as const, confidence: "sure" as const, distanceMeters: 400 },
      { startedAt: iso(70), stoppedAt: iso(100), mode: "automotive" as const, confidence: "unsure" as const, distanceMeters: 9000 }
    ] };
    const sheet = mount({ kind: "trip", trip: three, legIndex: null });
    sheet.press("location-correction-leg-2");
    sheet.update({ kind: "trip", trip, legIndex: null });
    sheet.press("location-correction-mode-bus");
    sheet.press("location-correction-sheet-action");
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledWith([{
      request: { kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: iso(70), legStoppedAt: iso(100), mode: "bus" }
    }], { closing: false });
    sheet.press("location-correction-leg-1");
    sheet.update({ kind: "trip", trip: { ...trip, legs: [{ ...trip.legs[0], stoppedAt: iso(100) }] }, legIndex: null });
    expect(sheet.has("location-correction-back")).toBe(false);
  });

  it("stays open with its draft, saying so, when the change couldn't be kept on the phone", async () => {
    const onQueue = vi.fn<Queue>(async () => { throw new Error("storage full"); });
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, onQueue);
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-sheet-action");
    await sheet.settle();
    expect(sheet.has("location-correction-error")).toBe(true);
    expect(sheet.onDismissed).not.toHaveBeenCalled();
    expect(sheet.tree.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.accessibilityState).toEqual({ checked: true });
  });

  it("forgets an asked removal after Keep it, so a later Done sends only the times", async () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null });
    sheet.press("location-correction-not-a-trip");
    sheet.press("location-correction-keep-trip");
    sheet.press("location-correction-sheet-action");
    await sheet.settle();
    expect(sheet.onQueue).not.toHaveBeenCalled();
  });

  it("offers nothing to change once its item left the List", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.update({ kind: "place", place, label: "Unknown place" }, true);
    expect(sheet.has("location-correction-stale")).toBe(true);
    expect(sheet.tree.root.findByProps({ testID: "location-correction-sheet-action" }).props.disabled).toBe(true);
  });

  // Codex r2 on #602.
  it("closes once the change is kept, after Done is enabled again", async () => {
    let resolve!: () => void;
    const onQueue = vi.fn<Queue>(() => new Promise<void>((done) => { resolve = done; }));
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, onQueue);
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-sheet-action");
    expect(sheet.tree.root.findByProps({ testID: "location-correction-sheet-action" }).props.disabled).toBe(true);
    await act(async () => { resolve(); });
    await sheet.settle();
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(onQueue.mock.calls[0][1]).toEqual({ closing: true });
  });

  // Step 12 part 4.
  it("takes a place you weren't at off the day once you confirm, and only when the List can join its trips", async () => {
    const plain = mount({ kind: "place", place, label: "Unknown place" });
    expect(plain.has("location-correction-not-here")).toBe(false);
    const sheet = mount({ kind: "place", place, label: "Unknown place", notHere: true });
    sheet.press("location-correction-not-here");
    sheet.press("location-correction-keep-not-here");
    expect(sheet.has("location-correction-confirm-not-here")).toBe(false);
    expect(sheet.onQueue).not.toHaveBeenCalled();
    sheet.press("location-correction-not-here");
    sheet.press("location-correction-confirm-not-here");
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledWith([{ request: { kind: "delete", subject: "place", itemId: "seg-a" } }], { closing: true });
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
  });

  it("makes a trip's two visits one stay when you didn't leave, offered only when the List allows it", async () => {
    const plain = mount({ kind: "trip", trip, legIndex: null });
    expect(plain.has("location-correction-didnt-leave")).toBe(false);
    const sheet = mount({ kind: "trip", trip, legIndex: null, didntLeave: true });
    sheet.press("location-correction-didnt-leave");
    sheet.press("location-correction-confirm-didnt-leave");
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledWith([{ request: { kind: "merge", subject: "trip", itemId: "trip-1" } }], { closing: true });
  });

  it("saves an unknown place under the name typed, closing once it is saved, and says so when it can't be", async () => {
    const onSavePlace = vi.fn(async (_name: string) => undefined);
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, onSavePlace);
    sheet.press("location-correction-save-place");
    expect(sheet.tree.root.findByProps({ testID: "location-correction-confirm-save-place" }).props.disabled).toBe(true);
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("  Exampleton Bakery "); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(onSavePlace).toHaveBeenCalledWith("Exampleton Bakery");
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);

    const failing = mount({ kind: "place", place, label: "Unknown place" }, undefined, vi.fn(async () => { throw new Error("offline"); }));
    failing.press("location-correction-save-place");
    act(() => { failing.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Exampleton Bakery"); });
    failing.press("location-correction-confirm-save-place");
    await failing.settle();
    expect(failing.has("location-correction-error")).toBe(true);
    expect(failing.onDismissed).not.toHaveBeenCalled();
    expect(mount({ kind: "place", place, label: "Unknown place" }).has("location-correction-save-place")).toBe(false);
  });

  // Codex r3 on #602.
  it("keeps the draft as it was while a change is being kept, and still closes once it is", async () => {
    let resolve!: () => void;
    const onQueue = vi.fn<Queue>(() => new Promise<void>((done) => { resolve = done; }));
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, onQueue);
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-sheet-action");
    sheet.press("location-correction-place-unknown");
    expect(sheet.tree.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.accessibilityState).toEqual({ checked: true });
    await act(async () => { resolve(); });
    await sheet.settle();
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
    expect(onQueue).toHaveBeenCalledTimes(1);
  });
});

