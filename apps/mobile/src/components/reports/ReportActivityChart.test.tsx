import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
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
  function mount() {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ReportActivityChart
          buckets={buckets}
          theme={{} as never}
          reduceMotion
          contextKey="one"
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
  it("keeps live ticks selected, ignores vertical scrolling, and dismisses on context change", () => {
    const { tree, plot, tap } = mount();
    tap(180);
    act(() =>
      tree.update(
        <ReportActivityChart
          buckets={buckets.map((b) => ({ ...b, seconds: b.seconds + 1 }))}
          theme={{} as never}
          reduceMotion
          contextKey="one"
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
          theme={{} as never}
          reduceMotion
          contextKey="two"
        />,
      ),
    );
    expect(tree.root.findAllByProps({ testID: "report-tooltip" })).toHaveLength(
      0,
    );
    act(() => tree.unmount());
  });
});
