import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TimelineTrip } from "@dayframe/shared";

// The sheet's search (native Apple Maps search) has its own tests: here it only draws the saved rows it is given.
vi.mock("./SheetNearbySearch", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return { SheetNearbySearch: (props: { savedRows: (text: string) => Array<{ key: string; title: string; detail: string; checked: boolean; onPress: () => void }> }) =>
    React.createElement("SheetNearbySearch", props, props.savedRows("").map((row) => React.createElement("Pressable", {
      accessibilityState: { selected: row.checked }, detail: row.detail, key: row.key, onPress: row.onPress, rowTitle: row.title, testID: `location-correction-place-${row.key}` }))) };
});
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
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon", ActivityIcon: "ActivityIcon" }));
vi.mock("../location/LocationEvidenceMap", () => ({ LocationEvidenceMap: "LocationEvidenceMap" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: vi.fn() }));
vi.mock("../../lib/placeCategories", () => ({ formatPlaceDistance: (meters: number) => meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km` }));
vi.mock("../../lib/timeWheel", () => ({ timeWheelAccessibilityStep: (ms: number, direction: number, _o: unknown, minutes: number) => ms + direction * minutes * 60_000 }));

import { LocationCorrectionSheet, SHEET_MORE_OPTIONS_ORDER, SHEET_SECTION_ORDER, type LocationCorrectionTarget } from "./LocationCorrectionSheet";

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
// The map, with the one saved place near the visit that the sheet lists.
const nearSaved = {
  map: { acceptedSamples: [], centre: { type: "Point", coordinates: [20, 10] }, nearbySavedPlaces: [{ id: SAVED, distanceMeters: 120 }], gaps: [] },
  segment: { kind: "stay", evidenceCount: 0 }, evidenceExpired: false
} as never;
/** Presses a control, opening "More options" first when it lives there. */
function tap(tree: ReturnType<typeof create>, testID: string) {
  const find = () => tree.root.findAll((node) => node.props.testID === testID && typeof node.props.onPress === "function");
  if (!find().length) {
    const more = tree.root.findAll((node) => node.props.testID === "location-correction-more" && typeof node.props.onPress === "function")[0];
    if (more && !more.props.accessibilityState.expanded) act(() => { more.props.onPress(); });
  }
  act(() => { find()[0].props.onPress(); });
}
function openMore(tree: ReturnType<typeof create>) {
  const more = tree.root.findAll((node) => node.props.testID === "location-correction-more" && typeof node.props.onPress === "function")[0];
  if (more && !more.props.accessibilityState.expanded) act(() => { more.props.onPress(); });
}

type Queue = (corrections: unknown[], options: { closing: boolean }) => Promise<void>;
function mount(target: LocationCorrectionTarget, onQueue = vi.fn<Queue>(async () => undefined), onSavePlace?: (name: string, rest: unknown[]) => Promise<void>,
  logAs?: { activities: Array<{ id: string; name: string }>; onLog: (categoryId: string) => void }) {
  const onDismissed = vi.fn();
  let tree!: ReturnType<typeof create>;
  const element = (next: LocationCorrectionTarget, stale = false) => (
    <LocationCorrectionSheet clockFormat="24h" evidence={nearSaved} onDismissed={onDismissed} onQueue={onQueue} onSavePlace={onSavePlace} logAs={logAs}
      places={[{ id: SAVED, name: "Exampleton Library", role: null }]} presentationId={1} reduceMotion={false} rootHosted={false}
      stale={stale} target={next} theme={theme} />
  );
  act(() => { tree = create(element(target)); });
  const press = (testID: string) => tap(tree, testID);
  const has = (testID: string) => { openMore(tree); return tree.root.findAll((node) => node.props.testID === testID).length > 0; };
  const update = (next: LocationCorrectionTarget, stale = false) => act(() => { tree.update(element(next, stale)); });
  // A kept correction settles (its write resolves) before the sheet moves on.
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { onDismissed, onQueue, press, has, settle, tree, update };
}

describe("the iPhone correction sheets (location v4 step 12)", () => {
  it("puts the item's map first, holding its frame while it loads and saying so when it can't be read (owner feedback, 27 Oct 2026)", () => {
    let loading!: ReturnType<typeof create>;
    act(() => {
      loading = create(<LocationCorrectionSheet clockFormat="24h" evidence={null} onDismissed={vi.fn()} onQueue={vi.fn()} places={[]}
        presentationId={1} reduceMotion={false} rootHosted={false} target={{ kind: "place", place, label: "Unknown place" }} theme={theme} />);
    });
    expect(loading.root.findAllByType("LocationEvidenceMap" as never)).toHaveLength(0);
    expect(JSON.stringify(loading.root.findByProps({ testID: "location-correction-map" }).props.style)).toContain('"height":160');
    const evidence = { map: { acceptedSamples: [] }, segment: { kind: "stay" } } as never;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<LocationCorrectionSheet clockFormat="24h" evidence={evidence} onDismissed={vi.fn()} onQueue={vi.fn()} places={[]}
        presentationId={1} reduceMotion rootHosted={false} target={{ kind: "trip", trip, legIndex: 1 }} theme={theme} />);
    });
    // On the leg view too: the map is there before anything else to change.
    expect(tree.root.findAllByType("LocationEvidenceMap" as never)[0].props.evidence).toBe(evidence);
  });

  it("a tap on a saved place answers at once, with its name, as the web's list does", async () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.press(`location-correction-place-${SAVED}`);
    expect(sheet.onQueue).toHaveBeenCalledWith([{
      request: { kind: "place", subject: "place", itemId: "seg-a", placeId: SAVED, learnedPlaceId: null },
      preview: { name: "Exampleton Library", role: null }
    }], { closing: true });
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledTimes(1);
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
  });

  it("queues nothing when nothing changed, and offers no place or times for a place in a block", () => {
    const sheet = mount({ kind: "place", place, label: "Unknown place" });
    sheet.press("location-correction-sheet-action");
    expect(sheet.onQueue).not.toHaveBeenCalled();
    const logged = mount({ kind: "place", place: { ...place, blockIds: ["entry-1"] }, label: "Unknown place" });
    expect(logged.has("location-correction-where")).toBe(false);
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
    await sheet.settle();
    expect(sheet.has("location-correction-error")).toBe(true);
    expect(sheet.onDismissed).not.toHaveBeenCalled();
    expect(sheet.tree.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.accessibilityState).toEqual({ selected: true });
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
    const onSavePlace = vi.fn(async (_name: string, _rest: unknown[]) => undefined);
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, onSavePlace);
    openMore(sheet.tree);
    expect(sheet.tree.root.findByProps({ testID: "location-correction-confirm-save-place" }).props.disabled).toBe(true);
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("  Exampleton Bakery "); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(onSavePlace).toHaveBeenCalledWith("Exampleton Bakery", [], undefined, null);
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);

    const failing = mount({ kind: "place", place, label: "Unknown place" }, undefined, vi.fn(async () => { throw new Error("offline"); }));
    openMore(failing.tree);
    act(() => { failing.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Exampleton Bakery"); });
    failing.press("location-correction-confirm-save-place");
    await failing.settle();
    expect(failing.has("location-correction-error")).toBe(true);
    expect(failing.onDismissed).not.toHaveBeenCalled();
    expect(mount({ kind: "place", place, label: "Unknown place" }).has("location-correction-save-form")).toBe(false);
  });

  // Codex r3 on #602.
  it("keeps the draft as it was while a change is being kept, and still closes once it is", async () => {
    let resolve!: () => void;
    const onQueue = vi.fn<Queue>(() => new Promise<void>((done) => { resolve = done; }));
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, onQueue);
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press(`location-correction-place-${SAVED}`);
    await act(async () => { resolve(); });
    await sheet.settle();
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
    expect(onQueue).toHaveBeenCalledTimes(1);
  });

  it("logs a place as the activity picked, after its own changes are kept, and Don't log leaves it as it is (step 12 part 4c)", async () => {
    const onLog = vi.fn();
    const logAs = { activities: [{ id: "cat-errands", name: "Errands" }], onLog };
    const plain = mount({ kind: "place", place, label: "Unknown place" }, undefined, undefined, logAs);
    openMore(plain.tree);
    // Nothing picked is "don't log": no selected "Don't log" pill, and no activity checked.
    expect(plain.has("location-correction-log-none")).toBe(false);
    expect(plain.tree.root.findByProps({ testID: "location-correction-log-cat-errands" }).props.selected).toBe(false);
    // Picked, "Don't log" is a quiet way back.
    plain.press("location-correction-log-cat-errands");
    plain.press("location-correction-log-none");
    expect(plain.has("location-correction-log-none")).toBe(false);
    plain.press("location-correction-sheet-action");
    expect(onLog).not.toHaveBeenCalled();

    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, undefined, logAs);
    sheet.press("location-correction-log-cat-errands");
    sheet.press(`location-correction-place-${SAVED}`);
    expect(onLog).not.toHaveBeenCalled();
    await sheet.settle();
    expect(sheet.onQueue).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith("cat-errands");
  });

  // Codex r1 on #606.
  it("saves a place with the sheet's Logs as, in one Done", async () => {
    const onSavePlace = vi.fn(async (_name: string, _rest: unknown[]) => undefined);
    const onLog = vi.fn();
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, onSavePlace,
      { activities: [{ id: "cat-errands", name: "Errands" }], onLog });
    sheet.press("location-correction-log-cat-errands");
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Exampleton Bakery"); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(onSavePlace).toHaveBeenCalledWith("Exampleton Bakery", [], undefined, null);
    expect(onLog).toHaveBeenCalledWith("cat-errands");
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
  });

  it("saves a place with a Logs as that waits for the server to accept its corrections, never logging at once (Codex r4 on #610)", async () => {
    const order: string[] = [];
    const start = vi.fn(() => { order.push("start"); });
    const onLogAfter = vi.fn(async (categoryId: string, ids: readonly string[]) => { order.push(`hold ${categoryId} ${ids.join(",")}`);
      return { start, cancel: vi.fn(async () => undefined) }; });
    // The List's save: the place on the server, then the waiting log with the corrections' ids, then the corrections.
    const onSavePlace = vi.fn(async (_name: string, _rest: unknown[], beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void }>) => {
      order.push("place created");
      const waiting = await beforeEnqueue?.(["cid-1"]);
      order.push("queued");
      waiting?.start();
    });
    const onLog = vi.fn();
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, onSavePlace as never,
      { activities: [{ id: "cat-errands", name: "Errands" }], onLog, onLogAfter } as never);
    sheet.press("location-correction-log-cat-errands");
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Exampleton Bakery"); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(order).toEqual(["place created", "hold cat-errands cid-1", "queued", "start"]);
    expect(onLog).not.toHaveBeenCalled();
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
  });

  it("never sends a join the List no longer allows, and holds the shape actions still while a change is kept", async () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null, didntLeave: true });
    sheet.press("location-correction-didnt-leave");
    sheet.update({ kind: "trip", trip, legIndex: null, didntLeave: false });
    expect(sheet.has("location-correction-confirm-didnt-leave")).toBe(false);

    let resolve!: () => void;
    const slow = mount({ kind: "place", place, label: "Unknown place", notHere: true }, vi.fn<Queue>(() => new Promise<void>((done) => { resolve = done; })));
    openMore(slow.tree);
    slow.press(`location-correction-place-${SAVED}`);
    slow.press("location-correction-not-here");
    expect(slow.has("location-correction-confirm-not-here")).toBe(false);
    await act(async () => { resolve(); });
    await slow.settle();
    expect(slow.onDismissed).toHaveBeenCalledWith(1);
  });
});


describe("the correction sheet's question, Done and saved places (owner, 28 Oct 2026)", () => {
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>;
  const nearMap = (distances: Record<string, number>) => ({
    map: { acceptedSamples: [], centre: null, nearbySavedPlaces: Object.entries(distances).map(([id, distanceMeters]) => ({ id, distanceMeters })) },
    segment: { kind: "stay" }
  }) as never;
  const NEAR = "6f000000-0000-4000-8000-000000000002";
  const FAR = "6f000000-0000-4000-8000-000000000003";
  function sheetWith(props: Partial<Parameters<typeof LocationCorrectionSheet>[0]>) {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<LocationCorrectionSheet clockFormat="24h" evidence={nearSaved} onDismissed={vi.fn()} onQueue={vi.fn(async () => undefined)}
        places={[{ id: SAVED, name: "Exampleton Library", role: null }]} presentationId={1} reduceMotion rootHosted={false}
        target={{ kind: "place", place, label: "Unknown place" }} theme={theme} {...props} />);
    });
    return tree;
  }
  const action = (tree: ReturnType<typeof create>) => tree.root.findByProps({ testID: "location-correction-sheet-action" });

  it("asks a plain question in one line, with Yes in the footer until something changes and a quiet Not now, as the web's", () => {
    const onAnswer = vi.fn();
    const onDismissed = vi.fn();
    const tree = sheetWith({ onDismissed, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer } });
    expect(JSON.stringify(tree.root.findByProps({ testID: "location-correction-ask" }).props.children)).toContain("Visited Pret?");
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-question")).toHaveLength(0);
    expect(action(tree).props.accessibilityLabel).toBe("Yes");
    tap(tree, "location-correction-sheet-action");
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onDismissed).toHaveBeenCalledWith(1);
    // A change turns the footer's Yes into Save, and saves it without answering.
    const onQueue = vi.fn(async () => undefined);
    const answer = vi.fn();
    const changed = sheetWith({ onQueue, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer: answer } });
    openMore(changed);
    act(() => { changed.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    expect(action(changed).props.accessibilityLabel).toBe("Save");
    tap(changed, "location-correction-sheet-action");
    expect(onQueue).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
  });

  it("has no Done bar or duplicate exits: Save, Not now, and ✕ closing with no change", () => {
    const onQueue = vi.fn(async () => undefined);
    const onDismissed = vi.fn();
    const tree = sheetWith({ onDismissed, onQueue, question: { text: "Where were you?", detail: null, yesLabel: null, noLabel: "Not now", onAnswer: vi.fn() } });
    expect(action(tree).props.accessibilityLabel).toBe("Save");
    expect(flat(action(tree).props.style).backgroundColor).toBe("accent");
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/"Done"/);
    // The shell's own footer stands alone without a Not now.
    openMore(tree);
    act(() => { tree.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    tap(tree, "location-correction-close");
    expect(onQueue).not.toHaveBeenCalled();
    expect(onDismissed).toHaveBeenCalledWith(1);
  });

  it("Save with nothing changed closes and answers nothing; Not now answers and closes", () => {
    const onAnswer = vi.fn();
    const onDismissed = vi.fn();
    const question = { text: "Where were you?", detail: null, yesLabel: null, noLabel: "Not now", onAnswer };
    const tree = sheetWith({ onDismissed, question });
    tap(tree, "location-correction-sheet-action");
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDismissed).toHaveBeenCalledWith(1);
    const onDismissedToo = vi.fn();
    const no = sheetWith({ onDismissed: onDismissedToo, question });
    tap(no, "location-correction-question-no");
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onDismissedToo).toHaveBeenCalledWith(1);
  });

  it("one tap keeps the sheet's changes and its answer, the answer kept first and waiting for them (owner, 28 Oct 2026; Codex r2 on #610)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const order: string[] = [];
    const start = vi.fn(() => { order.push("start"); });
    const answerAfter = vi.fn(async (_yes: boolean, ids: readonly string[]) => { order.push(`hold ${ids.join(",")}`); return { start, cancel: vi.fn(async () => undefined) }; });
    // The List's queue: the waiting answer is kept with the corrections' ids, then the corrections, then it starts.
    const onQueue = vi.fn(async (_corrections: unknown[], options: { closing: boolean; beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void }> }) => {
      const waiting = await options.beforeEnqueue?.(["cid-1"]);
      order.push("queued");
      waiting?.start();
    });
    const onAnswer = vi.fn();
    const onDismissed = vi.fn();
    const moveStart = (tree: ReturnType<typeof create>) => {
      openMore(tree);
      act(() => { tree.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    };
    const ok = sheetWith({ onDismissed, onQueue: onQueue as never,
      question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer, answerAfter } });
    moveStart(ok);
    tap(ok, "location-correction-question-no");
    await settle();
    expect(onQueue).toHaveBeenCalledOnce();
    expect(onQueue.mock.calls[0][0]).toEqual([expect.objectContaining({ request: expect.objectContaining({ kind: "times" }) })]);
    // With the tap's account lifetime the queue carries (here: none given by this stand-in queue).
    expect(answerAfter).toHaveBeenCalledWith(false, ["cid-1"], undefined);
    expect(order).toEqual(["hold cid-1", "queued", "start"]);
    // Never answered straight away: only through the waiting record.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onDismissed).toHaveBeenCalledWith(1);
    // The changes can't be kept: no answer starts, the sheet says why and stays open.
    const failedDismiss = vi.fn();
    const failingAnswer = vi.fn(async () => ({ start, cancel: vi.fn(async () => undefined) }));
    start.mockClear();
    const failing = sheetWith({ onDismissed: failedDismiss, onQueue: vi.fn(async () => { throw new Error("disk full"); }),
      question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer, answerAfter: failingAnswer } });
    moveStart(failing);
    tap(failing, "location-correction-question-no");
    await settle();
    expect(start).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(failedDismiss).not.toHaveBeenCalled();
    expect(failing.root.findAll((node) => node.props.testID === "location-correction-error").length).toBeGreaterThan(0);
  });

  it("Logs as on a place with a \"?\" queues log_place only, never an answer too (#609)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const onLog = vi.fn();
    const onAnswer = vi.fn();
    const answerAfter = vi.fn();
    const question = { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer, answerAfter };
    const logAs = { activities: [{ id: "cat-errands", name: "Errands" }], onLog };
    const done = sheetWith({ logAs, question });
    tap(done, "location-correction-log-cat-errands");
    tap(done, "location-correction-sheet-action");
    await settle();
    expect(onLog).toHaveBeenCalledWith("cat-errands");
    expect(onAnswer).not.toHaveBeenCalled();
    expect(answerAfter).not.toHaveBeenCalled();
  });

  it("never loses a Logs as pick: a place tapped with an activity is Logs as, after its correction; Not now drops it (Codex r3 on #610)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const onLog = vi.fn();
    const onAnswer = vi.fn();
    const answerAfter = vi.fn();
    const question = { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer, answerAfter };
    const logAs = { activities: [{ id: "cat-errands", name: "Errands" }], onLog };
    // Yes with Errands picked and a place change: the change is kept with Logs as waiting for it (log_place only once
    // the server has acknowledged the change, Codex r4 on #610; #609 then closes the "?").
    const order: string[] = [];
    const start = vi.fn(() => { order.push("start"); });
    const onLogAfter = vi.fn(async (categoryId: string, ids: readonly string[]) => { order.push(`hold ${categoryId} ${ids.join(",")}`);
      return { start, cancel: vi.fn(async () => undefined) }; });
    const onQueue = vi.fn(async (_corrections: unknown[], options: { beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void }> }) => {
      const waiting = await options.beforeEnqueue?.(["cid-1"]);
      order.push("queue");
      waiting?.start();
    });
    const onDismissed = vi.fn();
    const yes = sheetWith({ logAs: { ...logAs, onLogAfter }, question, onQueue: onQueue as never, onDismissed });
    tap(yes, "location-correction-log-cat-errands");
    tap(yes, `location-correction-place-${SAVED}`);
    await settle();
    expect(order).toEqual(["hold cat-errands cid-1", "queue", "start"]);
    // Never logged straight away.
    expect(onLog).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(answerAfter).not.toHaveBeenCalled();
    expect(onDismissed).toHaveBeenCalledWith(1);
    // Not now with Errands picked: answers Not now, logs nothing.
    onLog.mockClear();
    const no = sheetWith({ logAs, question });
    tap(no, "location-correction-log-cat-errands");
    tap(no, "location-correction-question-no");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onLog).not.toHaveBeenCalled();
  });

  it("keeps an unavailable answer unavailable, and stays open with its question when an answer is refused (Codex r16 on #610)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // No skip label (an incomplete suggestion, a rejected change of its own): no "Not now" in its place.
    const none = sheetWith({ question: { text: "Log your sleep?", detail: "It has no complete time yet, so it can't be answered here.",
      yesLabel: null, noLabel: null, onAnswer: vi.fn() } });
    expect(none.root.findAll((node) => node.props.testID === "location-correction-question-no")).toHaveLength(0);
    expect(action(none).props.accessibilityLabel).toBe("Save");
    // The gate refuses it: the sheet stays open, says so, and nothing is taken as answered.
    const onDismissed = vi.fn();
    const refused = sheetWith({ onDismissed, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer: () => false } });
    tap(refused, "location-correction-sheet-action");
    await settle();
    expect(onDismissed).not.toHaveBeenCalled();
    expect(refused.root.findAll((node) => node.props.testID === "location-correction-ask").length).toBeGreaterThan(0);
    expect(refused.root.findAll((node) => node.props.testID === "location-correction-error").length).toBeGreaterThan(0);
    // With changes of its own, refused before anything is queued: stays open too.
    const onQueue = vi.fn(async (_corrections: unknown[], options: { beforeEnqueue?: (ids: readonly string[]) => Promise<unknown> }) => {
      await options.beforeEnqueue?.(["cid-1"]);
    });
    const dismissedToo = vi.fn();
    const withChanges = sheetWith({ onDismissed: dismissedToo, onQueue: onQueue as never, question: { text: "Visited Pret?", detail: null,
      yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn(), answerAfter: async () => { throw new Error("This can't be answered here now."); } } });
    openMore(withChanges);
    act(() => { withChanges.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    tap(withChanges, "location-correction-question-no");
    await settle();
    expect(dismissedToo).not.toHaveBeenCalled();
    expect(withChanges.root.findAll((node) => node.props.testID === "location-correction-error").length).toBeGreaterThan(0);
  });

  it("answers at once when the sheet has nothing of its own to keep", () => {
    const onAnswer = vi.fn();
    const onQueue = vi.fn(async () => undefined);
    const tree = sheetWith({ onQueue, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer } });
    tap(tree, "location-correction-question-no");
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onQueue).not.toHaveBeenCalled();
  });

  it("lists at most two saved places, nearest first, from the server's list (within 500 m today), with no Show all saved places", () => {
    // `FAR` is beyond the server's 500 m, so its evidence has no row for it.
    const CLOSE = "6f000000-0000-4000-8000-000000000004";
    const tree = sheetWith({
      evidence: { map: { acceptedSamples: [], centre: { type: "Point", coordinates: [20, 10] }, nearbySavedPlaces: [NEAR, SAVED, CLOSE].map((id, index) => ({ id, distanceMeters: [140, 480, 300][index] })) }, segment: { kind: "stay" } } as never,
      places: [{ id: FAR, name: "Far Gym", role: null }, { id: SAVED, name: "Exampleton Library", role: null }, { id: CLOSE, name: "Close Bar", role: null }, { id: NEAR, name: "Near Café", role: null }]
    });
    expect(tree.root.findAllByType("LocationEvidenceMap" as never)[0].props).toMatchObject({ visitOnly: true, height: 160 });
    const rows = tree.root.findAll((node) => typeof node.props.testID === "string" && /^location-correction-place-6f/.test(node.props.testID) && typeof node.props.onPress === "function");
    expect(rows.map((node) => node.props.testID.replace("location-correction-place-", ""))).toEqual([NEAR, CLOSE]);
    expect(rows[0].props.detail).toBe("Saved place · 140 m away");
    expect(JSON.stringify(tree.toJSON())).not.toContain("Show all saved places");
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-more-places")).toHaveLength(0);
    // A search finds any saved place by name.
    const nearby = tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
    expect(nearby.props.savedRows("far").map((row: { title: string }) => row.title)).toEqual(["Far Gym"]);
  });

  it("leads with the place itself on a saved sheet, with no Leave as unknown (owner, 31 Oct 2026)", () => {
    const home = sheetWith({ target: { kind: "place", place: { ...place, placeId: SAVED, name: "Home", role: "home", matchKind: "saved" } as TimelinePlace, label: "Home" } });
    const row = home.root.findAll((node) => node.props.testID === `location-correction-place-${SAVED}` && typeof node.props.onPress === "function")[0];
    expect(row.props).toMatchObject({ detail: "This place", accessibilityState: { selected: true } });
    const withSave = sheetWith({ onSavePlace: vi.fn(async () => undefined), target: { kind: "place", place: { ...place, placeId: SAVED, name: "Home", role: "home", matchKind: "saved" } as TimelinePlace, label: "Home" } });
    openMore(withSave);
    expect(withSave.root.findAll((node) => node.props.testID === "location-correction-save-form")).toHaveLength(0);
    openMore(home);
    expect(home.root.findAll((node) => node.props.testID === "location-correction-place-unknown")).toHaveLength(0);
    expect(JSON.stringify(home.toJSON())).not.toContain("Leave as unknown");
  });

  it("removes the helper sentences and keeps More options closed until asked", () => {
    const tree = sheetWith({ logAs: logs, onSavePlace: vi.fn(async () => undefined) });
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-more-options")).toHaveLength(0);
    openMore(tree);
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Pick one to fill|Moving an edge|Not listed|Keeps its|Tap a leg|Where were you/);
    const tripTree = sheetWith({ target: { kind: "trip", trip, legIndex: null } });
    openMore(tripTree);
    expect(JSON.stringify(tripTree.toJSON())).not.toMatch(/Tap a leg|either side move/);
    expect(tripTree.root.findAll((node) => node.props.testID === "location-correction-times").length).toBeGreaterThan(0);
  });

  it("keeps a tapped place that failed to save: the sheet stays open and the footer's Save tries it again (Codex r2 on #641)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    for (const [trigger, placeId] of [["apple", "IPRET"], ["typed", null]] as const) {
      const onSavePlace = vi.fn<(...args: unknown[]) => Promise<void>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
      const onDismissed = vi.fn();
      const answer = vi.fn();
      // A question with a Yes: the footer must become Save, never Yes, while the place waits.
      const tree = sheetWith({ onDismissed, onSavePlace: onSavePlace as never, question: { text: "Getting there?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer: answer } });
      const nearby = tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
      act(() => { if (trigger === "apple") nearby.props.onPick("Pret", "IPRET"); else nearby.props.onSaveTyped("Pret"); });
      await settle();
      expect(onDismissed).not.toHaveBeenCalled();
      expect(tree.root.findAll((node) => node.props.testID === "location-correction-error").length).toBeGreaterThan(0);
      expect(action(tree).props.accessibilityLabel).toBe("Save");
      tap(tree, "location-correction-sheet-action");
      await settle();
      expect(onSavePlace).toHaveBeenCalledTimes(2);
      expect(onSavePlace.mock.calls[1]).toEqual(["Pret", [], undefined, placeId]);
      expect(answer).not.toHaveBeenCalled();
      expect(onDismissed).toHaveBeenCalledWith(1);
    }
  });

  it("drops a failed tap when another place is chosen instead", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const onSavePlace = vi.fn(async () => { throw new Error("offline"); });
    const onQueue = vi.fn(async () => undefined);
    const tree = sheetWith({ onQueue, onSavePlace });
    act(() => { tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0].props.onPick("Pret", "IPRET"); });
    await settle();
    tap(tree, `location-correction-place-${SAVED}`);
    await settle();
    expect(onSavePlace).toHaveBeenCalledTimes(1);
    expect(onQueue).toHaveBeenCalledOnce();
  });

  it("taps an Apple place or a typed name straight into Save this place, and Save keeps a name typed under More options", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const onSavePlace = vi.fn(async () => undefined);
    const tree = sheetWith({ onSavePlace });
    const nearby = tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
    act(() => { nearby.props.onPick("Pret", "IPRET"); });
    await settle();
    expect(onSavePlace).toHaveBeenCalledWith("Pret", [], undefined, "IPRET");
    const typed = vi.fn(async () => undefined);
    const other = sheetWith({ onSavePlace: typed });
    act(() => { other.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0].props.onSaveTyped("Corner Shop"); });
    await settle();
    expect(typed).toHaveBeenCalledWith("Corner Shop", [], undefined, null);
    const named = vi.fn(async () => undefined);
    const third = sheetWith({ onSavePlace: named });
    openMore(third);
    act(() => { third.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Bakery"); });
    tap(third, "location-correction-sheet-action");
    await settle();
    expect(named).toHaveBeenCalledWith("Bakery", [], undefined, null);
  });

  // Owner feedback, 29 Oct 2026: one layout for every sheet.
  const everyOrder = [...SHEET_SECTION_ORDER, ...SHEET_MORE_OPTIONS_ORDER];
  const order = (tree: ReturnType<typeof create>) => {
    openMore(tree);
    const ids = new Set<string>(everyOrder);
    const seen: string[] = [];
    for (const node of tree.root.findAll((each) => typeof each.props.testID === "string" && ids.has(each.props.testID))) {
      if (!seen.includes(node.props.testID)) seen.push(node.props.testID);
    }
    return seen;
  };
  const inOrder = (seen: string[]) => everyOrder.filter((id) => seen.includes(id));
  const ask = { text: "Where were you?", detail: null, yesLabel: null, noLabel: "Not now", onAnswer: vi.fn() };
  const logs = { activities: [{ id: "cat-errands", name: "Errands", color: "teal", icon: null }], onLog: vi.fn() };
  const stay = (count: number) => ({
    map: { acceptedSamples: [], centre: null, nearbySavedPlaces: [], gaps: [{ startedAt: iso(5), stoppedAt: iso(20) }] },
    segment: { kind: "stay", evidenceCount: count }, evidenceExpired: false
  }) as never;

  it("puts the sections in the same order for an unknown place, a saved place and a trip", () => {
    const unknown = order(sheetWith({ question: { ...ask, guess: { name: "Pret", street: null, applePlaceId: null } }, logAs: logs, onSavePlace: vi.fn(async () => undefined), target: { kind: "place", place, label: "Unknown place", notHere: true } }));
    const home = order(sheetWith({ logAs: logs, target: { kind: "place", place: { ...place, placeId: SAVED, name: "Home", role: "home", matchKind: "saved" } as TimelinePlace, label: "Home" } }));
    const tripSheet = order(sheetWith({ question: { ...ask, text: "Getting around?", yesLabel: "Yes" }, target: { kind: "trip", trip, legIndex: null } }));
    expect(unknown).toEqual(everyOrder.filter((id) => id !== "location-correction-legs"));
    for (const seen of [unknown, home, tripSheet]) expect(seen).toEqual(inOrder(seen));
    expect(home).toEqual(["location-correction-map", "location-correction-where", "location-correction-more", "location-correction-logs-as", "location-correction-times", "location-correction-corrections"]);
    expect(tripSheet).toEqual(["location-correction-map", "location-correction-legs", "location-correction-more", "location-correction-times", "location-correction-corrections"]);
  });

  it("never shows the gap list in its copy, and says nothing of readings for a saved place", () => {
    const unknown = sheetWith({ evidence: stay(14) });
    const map = unknown.root.findAllByType("LocationEvidenceMap" as never)[0];
    expect(map.props.caption).toBe("Based on 14 readings");
    expect(JSON.stringify(unknown.toJSON())).not.toMatch(/No readings|readings \d/);
    const home = sheetWith({ evidence: stay(14), target: { kind: "place", place: { ...place, placeId: SAVED, name: "Home", role: "home", matchKind: "saved" } as TimelinePlace, label: "Home" } });
    expect(home.root.findAllByType("LocationEvidenceMap" as never)[0].props.caption).toBeNull();
    const commute = { ...(stay(9) as object), segment: { kind: "commute", evidenceCount: 9 } } as never;
    const tripMap = sheetWith({ evidence: commute, target: { kind: "trip", trip, legIndex: null } });
    expect(tripMap.root.findAllByType("LocationEvidenceMap" as never)[0].props.caption).toBeNull();
  });

  it("uses the compact activity chips under Logs as, none selected and no filled Don't log by default", () => {
    const tree = sheetWith({ logAs: logs });
    openMore(tree);
    const chip = tree.root.findByProps({ testID: "location-correction-log-cat-errands" });
    expect(chip.props).toMatchObject({ compact: true, role: "radio", selected: false });
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-log-none")).toHaveLength(0);
    // No all-caps section titles.
    const titles = tree.root.findAll((node) => node.props.accessibilityRole === "header" && node.type === ("Text" as never));
    for (const title of titles) expect(flat(title.props.style).textTransform).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/Fix the shape|More places/);
  });

  it("asks a near guess in the title's fixed line, its row ticked and the primary reading Yes (PRD D23; owner, 31 Oct 2026)", () => {
    const onAnswer = vi.fn();
    const venue = { name: "Holland & Barrett", street: "12 High Street", applePlaceId: "I.hb" };
    const plain = sheetWith({ question: { ...ask, onAnswer } });
    const line = (tree: ReturnType<typeof create>) => tree.root.findAll((node) => node.props.testID === "location-correction-ask" && node.type === ("Text" as never))[0];
    expect(line(plain).props.children).toBe("Where were you?");
    expect(action(plain).props.accessibilityLabel).toBe("Save");
    const tree = sheetWith({ question: { ...ask, guess: venue, onAnswer } });
    expect(line(tree).props.children).toBe("Visited Holland & Barrett?");
    expect(line(tree).props.numberOfLines).toBe(1);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-question")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-question-edit")).toHaveLength(0);
    expect(action(tree).props.accessibilityLabel).toBe("Yes");
    const nearby = tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
    expect(nearby.props.guess).toEqual(venue);
    tap(tree, "location-correction-sheet-action");
    expect(onAnswer).toHaveBeenCalledWith(true, venue, null);
    // The ticked row is the same Yes.
    const again = vi.fn();
    const row = sheetWith({ question: { ...ask, guess: venue, onAnswer: again } });
    act(() => { row.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0].props.onGuessPick(); });
    expect(again).toHaveBeenCalledWith(true, venue, null);
    // A name of the person's own is a Save.
    const named = sheetWith({ onSavePlace: vi.fn(async () => undefined), question: { ...ask, guess: venue, onAnswer: vi.fn() } });
    openMore(named);
    act(() => { named.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Corner shop"); });
    expect(action(named).props.accessibilityLabel).toBe("Save");
  });

  it("offers All activities only when there are more, and clears a pick with Clear beside the footer's Don't log", () => {
    const every = [...logs.activities, { id: "cat-gym", name: "Gym", color: "teal", icon: null }];
    const tree = sheetWith({ logAs: { ...logs, allActivities: every } });
    openMore(tree);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-log-cat-gym")).toHaveLength(0);
    tap(tree, "location-correction-log-all");
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-log-cat-gym").length).toBeGreaterThan(0);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-log-all")).toHaveLength(0);
    const few = sheetWith({ logAs: { ...logs, allActivities: logs.activities } });
    openMore(few);
    expect(few.root.findAll((node) => node.props.testID === "location-correction-log-all")).toHaveLength(0);
  });

  it("closes More options at once with Reduce Motion, and after the scroll back otherwise", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    try {
      const still = sheetWith({});
      tap(still, "location-correction-more");
      tap(still, "location-correction-more");
      expect(still.root.findAll((node) => node.props.testID === "location-correction-more-options")).toHaveLength(0);
      const moving = sheetWith({ reduceMotion: false });
      tap(moving, "location-correction-more");
      tap(moving, "location-correction-more");
      expect(moving.root.findAll((node) => node.props.testID === "location-correction-more-options").length).toBeGreaterThan(0);
      act(() => { vi.advanceTimersByTime(240); });
      expect(moving.root.findAll((node) => node.props.testID === "location-correction-more-options")).toHaveLength(0);
      // A tap during the scroll back keeps it open.
      tap(moving, "location-correction-more");
      tap(moving, "location-correction-more");
      tap(moving, "location-correction-more");
      act(() => { vi.advanceTimersByTime(240); });
      expect(moving.root.findAll((node) => node.props.testID === "location-correction-more-options").length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("keeps a guessed venue when Yes follows a time change or a Logs as pick (Codex r1 on #620)", async () => {
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const venue = { name: "Holland & Barrett", street: null, applePlaceId: "IHB" };
    const queued = vi.fn(async (_corrections: unknown[], options: { beforeEnqueue?: (ids: readonly string[], generation: number) => Promise<{ start: () => void }> }) => {
      const waiting = await options.beforeEnqueue?.(["cid-1"], 1);
      waiting?.start();
    });
    const waiting = () => ({ start: vi.fn(), cancel: vi.fn(async () => undefined) });
    // (a) A time moved, then Yes: the answer waits for the change and carries the venue.
    const answerAfter = vi.fn(async () => waiting());
    const onAnswer = vi.fn();
    const timed = sheetWith({ onQueue: queued as never, question: { ...ask, guess: venue, onAnswer, answerAfter } });
    openMore(timed);
    act(() => { timed.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    tap(timed, "location-correction-sheet-action");
    await settle();
    expect(answerAfter).toHaveBeenCalledWith(true, ["cid-1"], 1, venue, null);
    expect(onAnswer).not.toHaveBeenCalled();
    // (b) Logs as picked, nothing else changed: one answer with the venue and the activity, never log_place.
    const onLog = vi.fn();
    const picked = sheetWith({ logAs: { activities: logs.activities, onLog }, question: { ...ask, guess: venue, onAnswer } });
    tap(picked, "location-correction-log-cat-errands");
    tap(picked, "location-correction-sheet-action");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(true, venue, "cat-errands");
    expect(onLog).not.toHaveBeenCalled();
    // (b) Logs as picked with a time change: the answer waits for it, venue and activity with it; no Logs as of its own.
    const answerAfterToo = vi.fn(async () => waiting());
    const onLogAfter = vi.fn();
    const both = sheetWith({ onQueue: queued as never, logAs: { activities: logs.activities, onLog, onLogAfter },
      question: { ...ask, guess: venue, onAnswer: vi.fn(), answerAfter: answerAfterToo } });
    openMore(both);
    act(() => { both.root.findByProps({ testID: "location-correction-start" }).props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }); });
    tap(both, "location-correction-log-cat-errands");
    tap(both, "location-correction-sheet-action");
    await settle();
    expect(answerAfterToo).toHaveBeenCalledWith(true, ["cid-1"], 1, venue, "cat-errands");
    expect(onLogAfter).not.toHaveBeenCalled();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("applies the sheet's own Nearby guess only to an unnamed visit, never over a name (Codex r5 on #620), and to an outing's stay only with its Place ID (#642)", async () => {
    const { nearbyProposalKey } = await import("../../lib/nearbyProposal");
    const evidence = { segment: { kind: "stay", startedAt: place.startedAt, stoppedAt: place.stoppedAt, evidenceCount: 3 }, evidenceExpired: false,
      map: { acceptedSamples: [], centre: { type: "Point", coordinates: [20, 10] }, nearbySavedPlaces: [], gaps: [] } } as never;
    const venue = { name: "Apple Bakery", street: null, applePlaceId: "IAPPLE" };
    const nearbyGuesses = (tree: ReturnType<typeof create>) => {
      const nearby = tree.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
      act(() => { nearby.props.onGuess(venue, nearbyProposalKey(nearby.props.centre, evidence)); });
    };
    const questionText = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());
    // A question already titled with a learned or saved name keeps it.
    const named = sheetWith({ evidence, onSavePlace: vi.fn(async () => undefined),
      question: { text: "Visited Bread run?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer: vi.fn(), guessable: false } });
    nearbyGuesses(named);
    expect(questionText(named)).toContain("Visited Bread run?");
    expect(questionText(named)).not.toContain("Apple Bakery");
    // An outing's stay takes it with an Apple Place ID (#642), and shows no guess without one.
    const outing = sheetWith({ evidence, onSavePlace: vi.fn(async () => undefined), question: { ...ask, guessable: true, outing: true } });
    nearbyGuesses(outing);
    expect(questionText(outing)).toContain("Visited Apple Bakery?");
    const noId = sheetWith({ evidence, onSavePlace: vi.fn(async () => undefined), question: { ...ask, guessable: true, outing: true } });
    const list = noId.root.findAll((node) => (node.type as unknown) === "SheetNearbySearch")[0];
    act(() => { list.props.onGuess({ ...venue, applePlaceId: null }, nearbyProposalKey(list.props.centre, evidence)); });
    expect(questionText(noId)).not.toContain("Visited");
    // An unnamed visit takes it.
    const unnamed = sheetWith({ evidence, onSavePlace: vi.fn(async () => undefined), question: { ...ask, guessable: true } });
    nearbyGuesses(unnamed);
    expect(questionText(unnamed)).toContain("Visited Apple Bakery?");
  });
});
