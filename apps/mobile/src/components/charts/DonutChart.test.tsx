import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The workspace currently installs the renderer's peer React at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

let fontScale = 1;

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
  withTiming: (value: unknown) => value,
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
