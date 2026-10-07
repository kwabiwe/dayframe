import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ pan: null as any, tap: null as any, haptic: vi.fn(), push: vi.fn() }));
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("expo-router", () => ({ router: { push: mocks.push } }));
vi.mock("react-native-gesture-handler", () => {
  function builder(store: "pan" | "tap") {
    const gesture: any = { handlers: {} };
    for (const method of ["activeOffsetX", "failOffsetY", "maxDistance"]) gesture[method] = () => gesture;
    for (const name of ["onStart", "onUpdate", "onEnd", "onFinalize"]) gesture[name] = (fn: unknown) => { gesture.handlers[name] = fn; return gesture; };
    mocks[store] = gesture;
    return gesture;
  }
  return {
    Gesture: { Pan: () => builder("pan"), Tap: () => builder("tap"), Race: (...gestures: unknown[]) => ({ gestures }) },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});
vi.mock("react-native-reanimated", () => ({ runOnJS: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Defs: "Defs", Line: "Line", Path: "Path", Pattern: "Pattern", Rect: "Rect" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: mocks.haptic }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("./TodayReviewPresentationContext", () => ({ useTodayReviewPresentationContext: () => null }));

import { buildTodayRibbon } from "../../lib/todayRibbon";
import { TodayRibbon } from "./TodayRibbon";

const theme = {
  accent: "#FF6248", background: "#050914", border: "#2A3345", borderStrong: "#3B465B", mode: "dark", surface: "#151B26",
  surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#FFFFFF", textSecondary: "#8993A7",
} as never;
const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => day + (h * 60 + m) * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (id: string, from: number, to: number | null, description = "Deep work") =>
  ({ id, startedAt: iso(from), stoppedAt: to === null ? null : iso(to), description, categoryId: "focus", categoryName: "Focus", categoryColor: "blue" }) as never;
const waiting = { presentationKey: "p1", awaitingDecision: true, title: "Walk", category: { id: "w", name: "Walk", color: "lime" }, interval: { startMs: at(12), endMs: at(13) }, clippedInterval: { startMs: at(12), endMs: at(13) } } as never;

const WIDTH = 240; // 10 points per hour

function render() {
  const model = buildTodayRibbon({ entries: [entry("a", at(6), at(9)), entry("b", at(10), at(11), "Call")], pending: [waiting], nowMs: at(18) });
  const onOpenBlock = vi.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayRibbon model={model} onOpenBlock={onOpenBlock} theme={theme} />);
  });
  act(() => tree.root.findByProps({ testID: "today-ribbon-track" }).props.onLayout({ nativeEvent: { layout: { width: WIDTH, height: 58, x: 0, y: 0 } } }));
  return { tree, model, onOpenBlock };
}

beforeEach(() => {
  mocks.haptic.mockReset();
  mocks.push.mockReset();
});

describe("TodayRibbon", () => {
  it("draws logged blocks solid, waiting time hatched, ticks and the now line", () => {
    const { tree } = render();
    const rects = tree.root.findAllByType("Rect" as never);
    expect(rects.filter((rect) => rect.props.fill === "url(#hatch-pendingp1)")).toHaveLength(1);
    expect(tree.root.findAllByType("Pattern" as never)).toHaveLength(1);
    expect(tree.root.findAllByType("Line" as never)).toHaveLength(7);
    expect(tree.root.findByType("Circle" as never).props.cx).toBe(180);
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.props.children);
    expect(texts).toEqual(["Today", "Drag to scrub", "00:00", "06:00", "12:00", "18:00", "24:00"]);
  });

  it("scrubs with a tooltip and one selection haptic per block entered", () => {
    const { tree } = render();
    act(() => mocks.pan.handlers.onStart({ x: 70 }));
    expect(tree.root.findByProps({ testID: "today-ribbon-tip" }).findAllByType("Text" as never).map((node) => node.props.children)).toEqual(["Deep work", "06:00–09:00 · 3h"]);
    act(() => mocks.pan.handlers.onUpdate({ x: 80 }));
    act(() => mocks.pan.handlers.onUpdate({ x: 95 }));
    expect(tree.root.findByProps({ testID: "today-ribbon-tip" }).findAllByType("Text" as never).map((node) => node.props.children)).toEqual(["09:30", "Untracked"]);
    act(() => mocks.pan.handlers.onUpdate({ x: 125 }));
    expect(tree.root.findByProps({ testID: "today-ribbon-tip" }).findAllByType("Text" as never).map((node) => node.props.children)).toEqual(["Walk", "12:00–13:00 · 1h · needs review"]);
    expect(mocks.haptic.mock.calls).toEqual([["tick"], ["tick"]]);
    act(() => mocks.pan.handlers.onFinalize({}));
    expect(tree.root.findAllByProps({ testID: "today-ribbon-tip" })).toHaveLength(0);
  });

  it("shows the tooltip only once it is measured for its current text", () => {
    const { tree } = render();
    const tipStyle = () => Object.assign({}, ...[tree.root.findByProps({ testID: "today-ribbon-tip" }).props.style].flat());
    const measure = (width: number) =>
      act(() => tree.root.findByProps({ testID: "today-ribbon-tip" }).props.onLayout({ nativeEvent: { layout: { height: 40, width, x: 0, y: 0 } } }));
    act(() => mocks.pan.handlers.onStart({ x: 70 }));
    expect(tipStyle().opacity).toBe(0);
    measure(120);
    expect(tipStyle()).toMatchObject({ opacity: 1 });
    // A new block's text hides the tooltip until it is measured again: no frame at the old width.
    act(() => mocks.pan.handlers.onUpdate({ x: 125 }));
    expect(tipStyle().opacity).toBe(0);
    measure(200);
    expect(tipStyle().opacity).toBe(1);
    act(() => mocks.pan.handlers.onFinalize({}));
  });

  it("opens the block under a tap and ignores gaps and failed taps", () => {
    const { onOpenBlock } = render();
    act(() => mocks.tap.handlers.onEnd({ x: 105 }, true));
    expect(onOpenBlock).toHaveBeenCalledWith(expect.objectContaining({ key: "entry:b" }));
    act(() => mocks.tap.handlers.onEnd({ x: 200 }, true));
    act(() => mocks.tap.handlers.onEnd({ x: 70 }, false));
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
  });

  it("lets VoiceOver step through blocks in time order and open one", () => {
    const { tree, onOpenBlock } = render();
    const track = () => tree.root.findByProps({ testID: "today-ribbon-track" });
    expect(track().props.accessibilityRole).toBe("adjustable");
    expect(track().props.accessibilityValue.text).toBe("2 blocks, 1 waiting for review. Swipe up or down to step through them.");
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(track().props.accessibilityValue.text).toBe("Deep work, 06:00 to 09:00, 3 hours");
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(track().props.accessibilityValue.text).toBe("Walk, 12:00 to 13:00, 1 hour, needs review");
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));
    expect(track().props.accessibilityValue.text).toBe("Call, 10:00 to 11:00, 1 hour");
    act(() => track().props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }));
    expect(onOpenBlock).toHaveBeenCalledWith(expect.objectContaining({ key: "entry:b" }));
  });
});
