import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  AccessibilityInfo: {
    isBoldTextEnabled: async () => false,
    addEventListener: () => ({ remove: vi.fn() }),
  },
  useWindowDimensions: () => ({ width: 375, fontScale: 1 }),
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: number) => value,
}));
vi.mock("@/lib/motion", () => ({
  MOBILE_MOTION: { layout: 220, control: 140 },
}));
vi.mock(
  "@/lib/reportsPresentation",
  async () => import("../../lib/reportsPresentation"),
);
vi.mock("@/lib/reportPlot", async () => import("../../lib/reportPlot"));
vi.mock(
  "@/lib/reportsTypography",
  async () => import("../../lib/reportsTypography"),
);
vi.mock("@/components/calendar/DatePickerCalendar", () => ({
  CalendarGlyph: "CalendarGlyph",
}));
import { ReportActivityChart } from "./ReportActivityChart";
const buckets = [0, 7200].map((seconds, index) => ({
  key: String(index),
  start: new Date(2026, 8, 9, index),
  end: new Date(2026, 8, 9, index + 1),
  label: String(index),
  fullLabel: `Hour ${index}`,
  seconds,
}));
describe("Activity chart", () => {
  it("shrinks its current-label gutter and keeps labels anchored to the content left", () => {
    let tree!: ReturnType<typeof create>;
    const render = (seconds: number) => (
      <ReportActivityChart
        buckets={buckets.map((b) => ({ ...b, seconds }))}
        axisLayout="custom"
        theme={{} as never}
        reduceMotion
        semanticContextKey={String(seconds)}
        outsidePressDismissal={0}
      />
    );
    act(() => {
      tree = create(render(99999999));
    });
    const probes = () =>
      tree.root.findAll(
        (n) =>
          typeof n.props.testID === "string" &&
          n.props.testID.startsWith("report-measure-"),
      );
    act(() =>
      probes().forEach((n) =>
        n.props.onTextLayout({ nativeEvent: { lines: [{ width: 100 }] } }),
      ),
    );
    expect(
      tree.root.findByProps({ testID: "report-axis" }).props.style.width,
    ).toBe(102);
    act(() => tree.update(render(60)));
    act(() =>
      probes().forEach((n) =>
        n.props.onTextLayout({ nativeEvent: { lines: [{ width: 18 }] } }),
      ),
    );
    const axis = tree.root.findByProps({ testID: "report-axis" });
    expect(axis.props.style.width).toBe(20);
    for (const label of axis.findAllByType("Text" as never))
      expect(label.props.style[0]).toMatchObject({
        left: 0,
        textAlign: "left",
      });
    act(() => tree.unmount());
  });
  function mount() {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ReportActivityChart
          buckets={buckets}
          axisLayout="custom"
          theme={{} as never}
          reduceMotion
          semanticContextKey="one"
          outsidePressDismissal={0}
        />,
      );
    });
    const plot = () => tree.root.findByProps({ testID: "report-plot" });
    const tap = (x: number) =>
      act(() =>
        plot().props.onPress({
          stopPropagation: vi.fn(),
          nativeEvent: { locationX: x },
        }),
      );
    return { tree, plot, tap };
  }
  it("fits one adjustable plot, zero-height data and bounded tooltip controls", () => {
    const { tree, plot, tap } = mount();
    const bars = tree.root.findAllByProps({ testID: "report-activity-bar" });
    expect(bars.every((bar) => bar.props.style[1].width === 20)).toBe(true);
    expect(bars[0].props.style.at(-1).height).toBe(0);
    expect(bars[1].props.style.at(-1).height).toBeGreaterThan(0);
    expect(plot().props.accessibilityRole).toBe("adjustable");
    expect(tree.root.findAllByType("ScrollView" as never)).toHaveLength(0);
    tap(180);
    const tooltip = tree.root.findByProps({ testID: "report-tooltip" });
    expect(tooltip.props.style[0].position).toBe("absolute");
    expect(tooltip.props.style[1].width).toBeLessThanOrEqual(220);
    expect(plot().props.accessibilityValue.text).toBe("Hour 1, 2 hours");
    for (const name of [
      "Previous bucket",
      "Next bucket",
      "Close bucket details",
    ])
      expect(
        tree.root.findByProps({ accessibilityLabel: name }).props.style
          .minWidth,
      ).toBe(44);
    tap(0);
    expect(plot().props.accessibilityValue.text).toBe("Hour 0, 0 seconds");
    act(() =>
      plot().props.onAccessibilityAction({
        nativeEvent: { actionName: "increment" },
      }),
    );
    expect(plot().props.accessibilityValue.now).toBe(2);
    act(() => tree.unmount());
  });
  it("centres one restrained daily bar with the actual weekday/date label", () => {
    let tree!: ReturnType<typeof create>;
    const day = {
      key: "today",
      start: new Date(2026, 8, 11),
      end: new Date(2026, 8, 12),
      label: "11",
      fullLabel: "11 Sep 2026",
      seconds: 3600,
    };
    act(() => {
      tree = create(
        <ReportActivityChart
          buckets={[day]}
          axisLayout="single-day"
          theme={{} as never}
          reduceMotion
          semanticContextKey="today"
          outsidePressDismissal={0}
        />,
      );
    });
    const bar = tree.root.findByProps({ testID: "report-activity-bar" });
    expect(bar.props.style[1].width).toBe(55);
    expect(
      tree.root
        .findAllByType("Text" as never)
        .map((node) => node.props.children)
        .filter((value) => value === "F" || value === "11/09"),
    ).toEqual(["F", "11/09"]);
    const plot = tree.root.findByProps({ testID: "report-plot" });
    act(() =>
      plot.props.onPress({
        stopPropagation: vi.fn(),
        nativeEvent: { locationX: 110 },
      }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: "Previous bucket" }).props
        .disabled,
    ).toBe(true);
    expect(
      tree.root.findByProps({ accessibilityLabel: "Next bucket" }).props
        .disabled,
    ).toBe(true);
    act(() => tree.unmount());
  });
  it("keeps chart actions, live ticks, theme updates and vertical scrolling selected", () => {
    const { tree, plot, tap } = mount();
    tap(180);
    act(() =>
      tree.update(
        <ReportActivityChart
          buckets={buckets.map((b) => ({ ...b, seconds: b.seconds + 1 }))}
          axisLayout="custom"
          theme={{} as never}
          reduceMotion
          semanticContextKey="one"
          outsidePressDismissal={0}
        />,
      ),
    );
    expect(plot().props.accessibilityValue.text).toBe(
      "Hour 1, 2 hours, 1 second",
    );
    act(() => {
      plot().props.onTouchStart({ nativeEvent: { pageY: 0 } });
      plot().props.onTouchMove({ nativeEvent: { pageY: 30 } });
    });
    tap(0);
    expect(plot().props.accessibilityValue.now).toBe(2);
    act(() =>
      tree.update(
        <ReportActivityChart
          buckets={buckets}
          axisLayout="custom"
          theme={{ accent: "updated-theme" } as never}
          reduceMotion={false}
          semanticContextKey="one"
          outsidePressDismissal={0}
        />,
      ),
    );
    expect(tree.root.findAllByProps({ testID: "report-tooltip" })).toHaveLength(
      1,
    );
    act(() =>
      tree.root
        .findByProps({ accessibilityLabel: "Previous bucket" })
        .props.onPress(),
    );
    expect(plot().props.accessibilityValue.now).toBe(1);
    act(() => tree.unmount());
  });
  it("dismisses only for an explicit outside press or semantic context change", () => {
    const { tree, tap } = mount();
    tap(180);
    act(() =>
      tree.update(
        <ReportActivityChart
          buckets={buckets}
          axisLayout="custom"
          theme={{} as never}
          reduceMotion
          semanticContextKey="one"
          outsidePressDismissal={1}
        />,
      ),
    );
    expect(tree.root.findAllByProps({ testID: "report-tooltip" })).toHaveLength(
      0,
    );
    tap(180);
    act(() =>
      tree.update(
        <ReportActivityChart
          buckets={buckets}
          axisLayout="custom"
          theme={{} as never}
          reduceMotion
          semanticContextKey="two"
          outsidePressDismissal={1}
        />,
      ),
    );
    expect(tree.root.findAllByProps({ testID: "report-tooltip" })).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });
});
