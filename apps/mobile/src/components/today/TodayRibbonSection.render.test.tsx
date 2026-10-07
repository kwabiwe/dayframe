import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ pan: null as any, tap: null as any, haptic: vi.fn(), push: vi.fn(), context: null as unknown }));
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
vi.mock("./TodayReviewPresentationContext", () => ({ useTodayReviewPresentationContext: () => mocks.context }));

import { TodayRibbonSection } from "./TodayRibbon";

const theme = {
  accent: "#FF6248", background: "#050914", border: "#2A3345", borderStrong: "#3B465B", mode: "dark", surface: "#151B26",
  surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#FFFFFF", textSecondary: "#8993A7",
} as never;
const nowMs = new Date(2026, 9, 7, 18).getTime();
const at = (h: number) => new Date(2026, 9, 7, h).getTime();
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

function activity(key: string, from: number, to: number, extra: Record<string, unknown>) {
  return {
    presentationKey: key, awaitingDecision: true, title: key, state: "needs_review", resolution: "none",
    category: { id: "c", name: "Walk", color: "lime" }, interval: { startMs: from, endMs: to }, clippedInterval: { startMs: from, endMs: to },
    ...extra,
  };
}

describe("TodayRibbonSection", () => {
  it("hatches only Review time still awaiting a decision and opens its exact Review route", () => {
    mocks.context = {
      isSummaryAvailable: true,
      presentation: {
        daySections: [{
          activities: [
            activity("generic", at(9), at(10), { source: { kind: "review", reviewItemId: REVIEW_ID }, reviewSourceKind: "generic" }),
            activity("location", at(12), at(13), { source: { kind: "review", reviewItemId: LOCATION_ID }, reviewSourceKind: "location_v2" }),
            activity("decided", at(14), at(15), { awaitingDecision: false, source: { kind: "review", reviewItemId: REVIEW_ID }, reviewSourceKind: "generic" }),
          ],
        }],
      },
    };
    const onOpenEntry = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayRibbonSection entries={[]} nowMs={nowMs} onOpenEntry={onOpenEntry} theme={theme} />);
    });
    act(() => tree.root.findByProps({ testID: "today-ribbon-track" }).props.onLayout({ nativeEvent: { layout: { width: 240, height: 62, x: 0, y: 0 } } }));
    expect(tree.root.findAllByType("Pattern" as never)).toHaveLength(2);
    act(() => mocks.tap.handlers.onEnd({ x: 95 }, true));
    expect(mocks.push).toHaveBeenLastCalledWith({ pathname: "/review", params: { focusReviewId: REVIEW_ID } });
    act(() => mocks.tap.handlers.onEnd({ x: 125 }, true));
    expect(mocks.push).toHaveBeenLastCalledWith({ pathname: "/review/[id]", params: { id: LOCATION_ID } });
    act(() => mocks.tap.handlers.onEnd({ x: 145 }, true));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(onOpenEntry).not.toHaveBeenCalled();
  });

  it("draws no hatched time without a usable presentation", () => {
    mocks.context = { isSummaryAvailable: false, presentation: null };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TodayRibbonSection entries={[]} nowMs={nowMs} onOpenEntry={vi.fn()} theme={theme} />);
    });
    act(() => tree.root.findByProps({ testID: "today-ribbon-track" }).props.onLayout({ nativeEvent: { layout: { width: 240, height: 62, x: 0, y: 0 } } }));
    expect(tree.root.findAllByType("Pattern" as never)).toHaveLength(0);
  });
});
