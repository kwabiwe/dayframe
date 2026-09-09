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
  it("retains zero-height data, 44pt targets, concurrency and a bounded non-reflow tooltip", () => {
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
    const bars = tree.root.findAllByProps({ testID: "report-activity-bar" });
    expect(bars[0].props.style.at(-1).height).toBe(0);
    expect(bars[1].props.style.at(-1).height).toBeGreaterThan(0);
    const target = tree.root.findByProps({ accessibilityLabel: "Hour 1, 2h" });
    expect(target.props.style.minWidth).toBe(44);
    act(() => target.props.onPress({ stopPropagation: vi.fn() }));
    const tooltip = tree.root
      .findAllByType("AnimatedView" as never)
      .find(
        (node) =>
          Array.isArray(node.props.style) &&
          node.props.style[0]?.position === "absolute",
      );
    expect(tooltip).toBeDefined();
    expect(tooltip!.props.style[1].width).toBeLessThanOrEqual(240);
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
    expect(
      tree.root.findAllByProps({ accessibilityLiveRegion: "polite" }),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });
  it("outside press and zero buckets dismiss the latest tooltip", () => {
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
    const tap = (label: string) =>
      act(() =>
        tree.root
          .findByProps({ accessibilityLabel: label })
          .props.onPress({ stopPropagation: vi.fn() }),
      );
    tap("Hour 1, 2h");
    tap("Hour 0, 0m");
    expect(
      tree.root.findAllByProps({ accessibilityLiveRegion: "polite" }),
    ).toHaveLength(0);
    tap("Hour 1, 2h");
    act(() => tree.root.findByProps({ accessible: false }).props.onPress());
    expect(
      tree.root.findAllByProps({ accessibilityLiveRegion: "polite" }),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });
});
