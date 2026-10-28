import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TimelinePlace, TimelineTrip } from "@dayframe/shared";

// The place sheet's Nearby and search (native Apple Maps search) is not part of these tests.
vi.mock("./SheetNearbySearch", () => ({ SheetNearbySearch: () => null }));
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
function mount(target: LocationCorrectionTarget, onQueue = vi.fn<Queue>(async () => undefined), onSavePlace?: (name: string, rest: unknown[]) => Promise<void>,
  logAs?: { activities: Array<{ id: string; name: string }>; onLog: (categoryId: string) => void }) {
  const onDismissed = vi.fn();
  let tree!: ReturnType<typeof create>;
  const element = (next: LocationCorrectionTarget, stale = false) => (
    <LocationCorrectionSheet clockFormat="24h" evidence={null} onDismissed={onDismissed} onQueue={onQueue} onSavePlace={onSavePlace} logAs={logAs}
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
    const onSavePlace = vi.fn(async (_name: string, _rest: unknown[]) => undefined);
    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, onSavePlace);
    sheet.press("location-correction-save-place");
    expect(sheet.tree.root.findByProps({ testID: "location-correction-confirm-save-place" }).props.disabled).toBe(true);
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("  Exampleton Bakery "); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(onSavePlace).toHaveBeenCalledWith("Exampleton Bakery", []);
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

  it("logs a place as the activity picked, after its own changes are kept, and Don't log leaves it as it is (step 12 part 4c)", async () => {
    const onLog = vi.fn();
    const logAs = { activities: [{ id: "cat-errands", name: "Errands" }], onLog };
    const plain = mount({ kind: "place", place, label: "Unknown place" }, undefined, undefined, logAs);
    expect(plain.tree.root.findByProps({ testID: "location-correction-log-none" }).props.accessibilityState).toEqual({ checked: true });
    plain.press("location-correction-sheet-action");
    expect(onLog).not.toHaveBeenCalled();

    const sheet = mount({ kind: "place", place, label: "Unknown place" }, undefined, undefined, logAs);
    sheet.press(`location-correction-place-${SAVED}`);
    sheet.press("location-correction-log-cat-errands");
    sheet.press("location-correction-sheet-action");
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
    sheet.press("location-correction-save-place");
    act(() => { sheet.tree.root.findByProps({ testID: "location-correction-place-name" }).props.onChangeText("Exampleton Bakery"); });
    sheet.press("location-correction-confirm-save-place");
    await sheet.settle();
    expect(onSavePlace).toHaveBeenCalledWith("Exampleton Bakery", []);
    expect(onLog).toHaveBeenCalledWith("cat-errands");
    expect(sheet.onDismissed).toHaveBeenCalledWith(1);
  });

  it("never sends a join the List no longer allows, and holds the shape actions still while a change is kept", async () => {
    const sheet = mount({ kind: "trip", trip, legIndex: null, didntLeave: true });
    sheet.press("location-correction-didnt-leave");
    sheet.update({ kind: "trip", trip, legIndex: null, didntLeave: false });
    expect(sheet.has("location-correction-confirm-didnt-leave")).toBe(false);

    let resolve!: () => void;
    const slow = mount({ kind: "place", place, label: "Unknown place", notHere: true }, vi.fn<Queue>(() => new Promise<void>((done) => { resolve = done; })));
    slow.press(`location-correction-place-${SAVED}`);
    slow.press("location-correction-sheet-action");
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
      tree = create(<LocationCorrectionSheet clockFormat="24h" evidence={null} onDismissed={vi.fn()} onQueue={vi.fn(async () => undefined)}
        places={[{ id: SAVED, name: "Exampleton Library", role: null }]} presentationId={1} reduceMotion={false} rootHosted={false}
        target={{ kind: "place", place, label: "Unknown place" }} theme={theme} {...props} />);
    });
    return tree;
  }
  const action = (tree: ReturnType<typeof create>) => tree.root.findByProps({ testID: "location-correction-sheet-action" });

  it("asks the item's \"?\" at its top in compact pills, each a 44-point target, and an answer closes the sheet", () => {
    const onAnswer = vi.fn();
    const onDismissed = vi.fn();
    const tree = sheetWith({ onDismissed, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer } });
    const question = tree.root.findByProps({ testID: "location-correction-question" });
    expect(JSON.stringify(question.props.children)).toContain("Visited Pret?");
    for (const id of ["location-correction-question-yes", "location-correction-question-no"]) {
      const pill = tree.root.findByProps({ testID: id });
      const style = flat(pill.props.style({ pressed: false }));
      expect(style).toMatchObject({ minHeight: 32, paddingHorizontal: 16 });
      expect(flat(pill.findByType("Text" as never).props.style)).toMatchObject({ fontSize: 14, fontWeight: "700" });
      expect((style.minHeight as number) + pill.props.hitSlop.top + pill.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
    }
    act(() => { tree.root.findByProps({ testID: "location-correction-question-yes" }).props.onPress(); });
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onDismissed).toHaveBeenCalledWith(1);
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
    const ok = sheetWith({ onDismissed, onQueue: onQueue as never,
      question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer, answerAfter } });
    act(() => { ok.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.onPress(); });
    // The answers stay offered while the sheet has changes.
    expect(ok.root.findAll((node) => node.props.testID === "location-correction-question-yes").length).toBeGreaterThan(0);
    act(() => { ok.root.findByProps({ testID: "location-correction-question-yes" }).props.onPress(); });
    await settle();
    expect(onQueue).toHaveBeenCalledOnce();
    expect(onQueue.mock.calls[0][0]).toEqual([expect.objectContaining({ request: expect.objectContaining({ kind: "place", placeId: SAVED }) })]);
    expect(answerAfter).toHaveBeenCalledWith(true, ["cid-1"]);
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
    act(() => { failing.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.onPress(); });
    act(() => { failing.root.findByProps({ testID: "location-correction-question-no" }).props.onPress(); });
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
    act(() => { done.root.findByProps({ testID: "location-correction-log-cat-errands" }).props.onPress(); });
    act(() => { action(done).props.onPress(); });
    await settle();
    expect(onLog).toHaveBeenCalledWith("cat-errands");
    expect(onAnswer).not.toHaveBeenCalled();
    expect(answerAfter).not.toHaveBeenCalled();
    // Yes is the answer alone: a Logs as pick is not sent with it.
    onLog.mockClear();
    const yes = sheetWith({ logAs, question });
    act(() => { yes.root.findByProps({ testID: "location-correction-log-cat-errands" }).props.onPress(); });
    act(() => { yes.root.findByProps({ testID: "location-correction-question-yes" }).props.onPress(); });
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onLog).not.toHaveBeenCalled();
  });

  it("answers at once when the sheet has nothing of its own to keep", () => {
    const onAnswer = vi.fn();
    const onQueue = vi.fn(async () => undefined);
    const tree = sheetWith({ onQueue, question: { text: "Visited Pret?", detail: null, yesLabel: "Yes", noLabel: "Not now", onAnswer } });
    act(() => { tree.root.findByProps({ testID: "location-correction-question-no" }).props.onPress(); });
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onQueue).not.toHaveBeenCalled();
  });

  it("keeps Done quiet until something changes (owner item O)", () => {
    const tree = sheetWith({});
    expect(flat(action(tree).props.style).backgroundColor).toBe("surfaceMuted");
    act(() => { tree.root.findByProps({ testID: `location-correction-place-${SAVED}` }).props.onPress(); });
    expect(flat(action(tree).props.style).backgroundColor).toBe("textPrimary");
  });

  it("shows the visit's own map, saved places nearest first with how far, and the rest behind More places (owner items L, N)", () => {
    const tree = sheetWith({
      evidence: nearMap({ [NEAR]: 140, [SAVED]: 1_400, [FAR]: 8_000 }),
      places: [{ id: FAR, name: "Far Gym", role: null }, { id: SAVED, name: "Exampleton Library", role: null }, { id: NEAR, name: "Near Café", role: null }]
    });
    expect(tree.root.findAllByType("LocationEvidenceMap" as never)[0].props.visitOnly).toBe(true);
    const shown = () => tree.root.findAll((node) => typeof node.props.testID === "string" && /^location-correction-place-6f/.test(node.props.testID)
      && typeof node.props.onPress === "function").map((node) => node.props.testID.replace("location-correction-place-", ""));
    expect(shown()).toEqual([NEAR, SAVED]);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Saved place · 140 m away");
    expect(text).toContain("Saved place · 1.4 km away");
    const more = tree.root.findByProps({ testID: "location-correction-more-places" });
    expect(JSON.stringify(more.props.children)).toContain("More places (");
    act(() => { more.props.onPress(); });
    expect(shown()).toEqual([NEAR, SAVED, FAR]);
    expect(tree.root.findAll((node) => node.props.testID === "location-correction-more-places")).toHaveLength(0);
  });
});
