import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The workspace currently installs the renderer's peer React at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

let fontScale = 1;
const animation = vi.hoisted(() => ({
  completions: [] as Array<(finished: boolean) => void>,
  timings: [] as Array<{ value: unknown; duration: number | undefined }>,
}));

vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale, height: 844, width: 390 }),
}));

vi.mock("react-native-reanimated", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  return {
    default: { View: "View" },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    createAnimatedComponent: () => "AnimatedPath",
    useAnimatedProps: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => React.useRef({ value }).current,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    withTiming: (
      value: unknown,
      _config: unknown,
      completion?: (finished: boolean) => void,
    ) => {
      animation.timings.push({
        value,
        duration: (_config as { duration?: number } | undefined)?.duration,
      });
      if (completion) animation.completions.push(completion);
      return value;
    },
  };
});

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
  it("runs a real first-visible entrance after an eagerly settled hidden mount", () => {
    animation.timings = [];
    let tree!: ReturnType<typeof create>;
    const render = (
      animateEntrance: boolean,
      settleImmediately: boolean,
      items = segments,
      color = "blue",
    ) => (
      <DonutChart
        animateEntrance={animateEntrance}
        centerLabel="Total"
        centerValue="01:00:00"
        reduceMotion={false}
        settleImmediately={settleImmediately}
        segments={items.map((segment) => ({ ...segment, color }))}
        theme={theme}
      />
    );
    act(() => {
      tree = create(render(false, true));
    });
    expect(animation.timings.every((call) => call.duration === 0)).toBe(true);
    animation.timings = [];
    act(() => tree.update(render(true, false)));
    expect(animation.timings).toContainEqual({ value: 360, duration: 260 });
    expect(animation.timings).toContainEqual({ value: 1, duration: 140 });

    animation.timings = [];
    act(() =>
      tree.update(
        render(
          true,
          false,
          [{ ...segments[0], value: segments[0].value + 1 }],
          "updated-theme",
        ),
      ),
    );
    expect(animation.timings.some((call) => call.duration === 260)).toBe(false);
    expect(animation.timings.some((call) => call.duration === 180)).toBe(true);
    act(() => tree.unmount());
  });

  it("starts entrance when positive data arrives asynchronously without replaying it for filtering", () => {
    animation.timings = [];
    let tree!: ReturnType<typeof create>;
    const render = (
      items: typeof segments,
      animateEntrance: boolean,
      reduceMotion = false,
    ) => (
      <DonutChart
        animateEntrance={animateEntrance}
        centerLabel="Total"
        centerValue="01:00:00"
        reduceMotion={reduceMotion}
        segments={items}
        theme={theme}
      />
    );
    act(() => {
      tree = create(render([], false));
    });
    animation.timings = [];
    act(() => tree.update(render(segments, true)));
    expect(animation.timings.some((call) => call.duration === 260)).toBe(true);
    animation.timings = [];
    act(() =>
      tree.update(
        render(
          [
            ...segments,
            { id: "rest", value: 1_000, color: "red", selected: true },
          ],
          false,
        ),
      ),
    );
    expect(animation.timings.some((call) => call.duration === 260)).toBe(false);
    expect(animation.timings.some((call) => call.duration === 180)).toBe(true);
    act(() => tree.unmount());
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    "settles an entrance without sweep travel for Reduce Motion %s and background %s",
    (reduceMotion, settleImmediately) => {
      animation.timings = [];
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <DonutChart
            animateEntrance
            centerLabel="Total"
            centerValue="01:00:00"
            reduceMotion={reduceMotion}
            settleImmediately={settleImmediately}
            segments={segments}
            theme={theme}
          />,
        );
      });
      expect(animation.timings.length).toBeGreaterThan(0);
      expect(animation.timings.every((call) => call.duration === 0)).toBe(true);
      act(() => tree.unmount());
    },
  );

  it("keeps exact natural spoken seconds without opting the total into live announcements", () => {
    let tree!: ReturnType<typeof create>;
    const render = (value: string, spoken: string) => (
      <DonutChart
        animateEntrance={false}
        centerLabel="Total"
        centerValue={value}
        spokenValue={spoken}
        reduceMotion
        segments={segments}
        theme={theme}
      />
    );
    act(() => {
      tree = create(render("01:00:00", "1 hour"));
    });
    const chart = () => tree.root.findByProps({ accessibilityRole: "image" });
    expect(chart().props.accessibilityLiveRegion).toBeUndefined();
    act(() => tree.update(render("01:00:01", "1 hour, 1 second")));
    expect(chart().props.accessibilityLabel).toContain(
      "Total 1 hour, 1 second. 1 categories.",
    );
    expect(chart().props.accessibilityLiveRegion).toBeUndefined();
    act(() => tree.unmount());
  });

  it("retains inert outgoing IDs and rejects their stale completion after restore and another removal", () => {
    animation.completions = [];
    let tree!: ReturnType<typeof create>;
    const all = [
      ...segments,
      { id: "rest", value: 1000, color: "red", selected: true },
    ];
    const render = (items: typeof all) => (
      <DonutChart
        animateEntrance={false}
        centerLabel="Total"
        centerValue="01:00:01"
        reduceMotion={false}
        segments={items}
        theme={theme}
      />
    );
    act(() => {
      tree = create(render(all));
    });
    act(() => tree.update(render(all.slice(1))));
    const oldExit = [...animation.completions];
    const paths = () => tree.root.findAllByType("AnimatedPath" as never);
    expect(paths()).toHaveLength(2);
    expect(
      paths().find((p) => p.props.fill === "blue")?.props.onPress,
    ).toBeUndefined();
    act(() => tree.update(render(all)));
    act(() => oldExit.forEach((done) => done(true)));
    expect(paths()).toHaveLength(2);
    expect(
      paths().find((p) => p.props.fill === "blue")?.props.onPress,
    ).toBeUndefined();
    act(() => tree.update(render(all.slice(1))));
    act(() => oldExit.forEach((done) => done(true)));
    expect(paths()).toHaveLength(2);
    const latest = [...animation.completions];
    act(() => latest.forEach((done) => done(true)));
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
