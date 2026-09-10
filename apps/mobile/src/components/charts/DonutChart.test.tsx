import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The workspace currently installs the renderer's peer React at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

let fontScale = 1;
const animation = vi.hoisted(() => ({ completions: [] as Array<(finished: boolean) => void> }));

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale, height: 844, width: 390 }),
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: "View" },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  createAnimatedComponent: () => "AnimatedPath",
  useAnimatedProps: (factory: () => unknown) => factory(),
  useSharedValue: (value: unknown) => ({ value }),
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  withTiming: (value: unknown, _config: unknown, completion?: (finished: boolean) => void) => {
    if (completion) animation.completions.push(completion);
    return value;
  },
}));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Circle: "Circle",
  Defs: "Defs",
  Path: "Path",
  Pattern: "Pattern",
  Rect: "Rect",
}));

vi.mock("@/lib/donutGeometry", async () => import("../../lib/donutGeometry"));
vi.mock("@/lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 180 },
}));

import { DonutChart } from "./DonutChart";

const theme = {
  chartTrack: "track",
  mode: "dark",
  surfaceRaised: "raised",
  textPrimary: "primary",
  textSecondary: "secondary",
} as never;
const segments = [
  { id: "work", value: 3_600_000, color: "blue", selected: true },
];

describe("DonutChart", () => {
  it("keeps exact natural spoken seconds without opting the total into live announcements", () => {
    let tree!: ReturnType<typeof create>;
    const render = (value: string, spoken: string) => <DonutChart animateEntrance={false} centerLabel="Total" centerValue={value} spokenValue={spoken} reduceMotion segments={segments} theme={theme} />;
    act(() => { tree = create(render("01:00:00", "1 hour")); });
    const chart = () => tree.root.findByProps({ accessibilityRole: "image" });
    expect(chart().props.accessibilityLiveRegion).toBe("none");
    act(() => tree.update(render("01:00:01", "1 hour, 1 second")));
    expect(chart().props.accessibilityLabel).toContain("Total 1 hour, 1 second. 1 categories.");
    expect(chart().props.accessibilityLiveRegion).toBe("none");
    act(() => tree.unmount());
  });

  it("retains inert outgoing IDs and rejects their stale completion after restore and another removal", () => {
    animation.completions = [];
    let tree!: ReturnType<typeof create>;
    const all = [...segments, { id: "rest", value: 1000, color: "red", selected: true }];
    const render = (items: typeof all) => <DonutChart animateEntrance={false} centerLabel="Total" centerValue="01:00:01" reduceMotion={false} segments={items} theme={theme} onSegmentPress={vi.fn()} />;
    act(() => { tree = create(render(all)); });
    act(() => tree.update(render(all.slice(1))));
    const oldExit = [...animation.completions];
    const paths = () => tree.root.findAllByType("AnimatedPath" as never);
    expect(paths()).toHaveLength(2);
    expect(paths().find(p => p.props.fill === "blue")?.props.onPress).toBeUndefined();
    act(() => tree.update(render(all)));
    act(() => oldExit.forEach(done => done(true)));
    expect(paths()).toHaveLength(2);
    expect(paths().find(p => p.props.fill === "blue")?.props.onPress).toBeTypeOf("function");
    act(() => tree.update(render(all.slice(1))));
    act(() => oldExit.forEach(done => done(true)));
    expect(paths()).toHaveLength(2);
    const latest = [...animation.completions];
    act(() => latest.forEach(done => done(true)));
    expect(paths()).toHaveLength(1);
    expect(paths()[0].props.fill).toBe("red");
    act(() => tree.unmount());
  });
  it.each([
    [1.25, 184, 104],
    [1.5, 184, 104],
    [3.2, 184, 104],
  ])(
    "keeps geometry constant at font scale %s",
    (nextFontScale, expectedSize, expectedCenterWidth) => {
      fontScale = nextFontScale;
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <DonutChart
            animateEntrance={false}
            centerLabel="Total logged"
            centerValue="12h 34m"
            reduceMotion
            segments={segments}
            theme={theme}
          />,
        );
      });
      const chart = tree.root.findByProps({ accessibilityRole: "image" });
      act(() =>
        chart.props.onLayout({ nativeEvent: { layout: { width: 320 } } }),
      );

      expect(tree.root.findByType("Svg" as never).props).toMatchObject({
        width: expectedSize,
        height: expectedSize,
      });
      const center = tree.root
        .findAllByType("View" as never)
        .find(
          (node) =>
            Array.isArray(node.props.style) &&
            node.props.style[1]?.width === expectedCenterWidth,
        );
      expect(center).toBeDefined();
    },
  );

  it("isolates hatch pattern IDs across multiple charts", () => {
    fontScale = 1;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <>
          <DonutChart
            animateEntrance={false}
            centerLabel="One"
            centerValue="1h"
            reduceMotion
            segments={segments}
            theme={theme}
          />
          <DonutChart
            animateEntrance={false}
            centerLabel="Two"
            centerValue="2h"
            reduceMotion
            segments={segments}
            theme={theme}
          />
        </>,
      );
    });
    const patternIds = tree.root
      .findAllByType("Pattern" as never)
      .map((node) => node.props.id);
    expect(new Set(patternIds).size).toBe(2);
  });
});
