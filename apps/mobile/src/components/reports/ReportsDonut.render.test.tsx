import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const haptic = vi.hoisted(() => vi.fn());
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: haptic }));
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { extraBold: "X" }, mobileTextProps: () => ({}) }));

import { ReportDonutCard, donutSegmentAt, donutTurn, type ReportDonutSegment } from "./ReportsDonut";

const theme = { border: "#333", mode: "dark", surface: "#151B27", surfaceInset: "#101622", surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#F7F8FB", textSecondary: "#8993A7" } as never;
const widths = { duration: 60, percent: 40, fontSize: 14, gap: 10 };
const segments: ReportDonutSegment[] = [
  { key: "work", name: "Work", seconds: 3 * 3600, color: "#3B82F6" },
  { key: "gym", name: "Gym", seconds: 3600, color: "#EF4444" },
];

function render(list = segments) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<ReportDonutCard empty={null} numberWidths={widths} periodLabel="This week" segments={list} theme={theme} totalSeconds={4 * 3600} />);
  });
  return tree;
}

const touch = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } });

describe("Reports donut", () => {
  it("maps a point on the ring to the activity under it, clockwise from 12 o'clock", () => {
    expect(donutTurn(84, 0)).toBeCloseTo(0);
    expect(donutTurn(168, 84)).toBeCloseTo(0.25);
    expect(donutTurn(0, 84)).toBeCloseTo(0.75);
    // Work is the first three quarters, Gym the last.
    expect(donutSegmentAt(segments, 0.5)).toBe("work");
    expect(donutSegmentAt(segments, 0.8)).toBe("gym");
    expect(donutSegmentAt([], 0.5)).toBeNull();
  });

  it("highlights the activity under a finger sliding round the ring, with one tick per change", () => {
    haptic.mockReset();
    const tree = render();
    const donut = tree.root.findByProps({ testID: "reports-donut" });
    expect(tree.root.findByProps({ testID: "reports-donut-value" }).props.children).toBe("4h");
    expect(tree.root.findByProps({ testID: "reports-donut-label" }).props.children).toBe("This week");
    act(() => donut.props.onResponderGrant(touch(168, 84)));
    act(() => donut.props.onResponderMove(touch(160, 100)));
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: "reports-donut-value" }).props.children).toBe("3h");
    expect(tree.root.findByProps({ testID: "reports-donut-label" }).props.children).toBe("Work · 75%");
    const circles = tree.root.findAllByType("Circle" as never).slice(1);
    expect(circles.map((circle) => [circle.props.strokeWidth, circle.props.opacity])).toEqual([[30, 1], [24, 0.35]]);
    act(() => donut.props.onResponderMove(touch(20, 40)));
    expect(haptic).toHaveBeenCalledTimes(2);
    expect(tree.root.findByProps({ testID: "reports-activity-gym" }).props.accessibilityState).toEqual({ selected: true });
    expect(donut.props.onResponderTerminationRequest()).toBe(false);
  });

  it("toggles the highlight from a row and steps through activities with VoiceOver", () => {
    const tree = render();
    const work = tree.root.findByProps({ testID: "reports-activity-work" });
    expect(work.props.accessibilityLabel).toBe("Work, 75% of selected time, 3 hours");
    expect(work.props.style[0].minHeight).toBe(44);
    act(() => work.props.onPress());
    expect(tree.root.findByProps({ testID: "reports-activity-work" }).props.accessibilityState).toEqual({ selected: true });
    act(() => tree.root.findByProps({ testID: "reports-activity-work" }).props.onPress());
    expect(tree.root.findByProps({ testID: "reports-donut-label" }).props.children).toBe("This week");
    const donut = () => tree.root.findByProps({ testID: "reports-donut" });
    expect(donut().props.accessibilityRole).toBe("adjustable");
    act(() => donut().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(donut().props.accessibilityValue.text).toBe("Work, 3 hours, 75%");
    act(() => donut().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(donut().props.accessibilityValue.text).toBe("Gym, 1 hour, 25%");
    act(() => donut().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(donut().props.accessibilityValue.text).toBe("This week, 4 hours, 2 activities");
  });

  it("turns page scrolling off for exactly the time a finger is on the ring", () => {
    const onScrubbingChange = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReportDonutCard empty={null} numberWidths={widths} onScrubbingChange={onScrubbingChange} periodLabel="This week" segments={segments} theme={theme} totalSeconds={4 * 3600} />);
    });
    const donut = () => tree.root.findByProps({ testID: "reports-donut" });
    act(() => donut().props.onResponderGrant(touch(168, 84)));
    act(() => donut().props.onResponderMove(touch(160, 120)));
    expect(onScrubbingChange.mock.calls).toEqual([[true]]);
    act(() => donut().props.onResponderRelease());
    expect(onScrubbingChange.mock.calls).toEqual([[true], [false]]);
    act(() => donut().props.onResponderGrant(touch(168, 84)));
    act(() => donut().props.onResponderTerminate());
    expect(onScrubbingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    // Unmounting mid-scrub hands scrolling back.
    act(() => donut().props.onResponderGrant(touch(168, 84)));
    act(() => tree.unmount());
    expect(onScrubbingChange.mock.calls.at(-1)).toEqual([false]);
  });

  it("keeps percentages in secondary text, not the muted token", () => {
    const tree = render();
    const work = tree.root.findByProps({ testID: "reports-activity-work" });
    const texts = work.findAllByType("Text" as never);
    expect(texts.at(-1)!.props.style[1].color).toBe("#8993A7");
  });

  it("drops a highlight whose activity leaves the range or filter", () => {
    const tree = render();
    act(() => tree.root.findByProps({ testID: "reports-activity-gym" }).props.onPress());
    act(() => {
      tree.update(<ReportDonutCard empty={null} numberWidths={widths} periodLabel="This week" segments={segments.slice(0, 1)} theme={theme} totalSeconds={3 * 3600} />);
    });
    expect(tree.root.findByProps({ testID: "reports-donut-label" }).props.children).toBe("This week");
    expect(tree.root.findByProps({ testID: "reports-activity-work" }).props.accessibilityState).toEqual({ selected: false });
  });
});
