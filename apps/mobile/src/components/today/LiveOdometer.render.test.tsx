import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

let fontScale = 1;
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale, height: 874, scale: 3, width: 402 }),
}));

type Shared = { value: unknown };
const shared: Shared[] = [];
vi.mock("react-native-reanimated", async () => {
  const React = await import("react");
  return {
  default: { View: "ReanimatedView" },
  ReduceMotion: { Never: "never" },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  // Stable across renders, like the real hook.
  useSharedValue: (initial: unknown) => {
    const ref = React.useRef<Shared | null>(null);
    if (!ref.current) {
      ref.current = { value: initial };
      shared.push(ref.current);
    }
    return ref.current;
  },
  withSpring: (to: unknown, config: Record<string, unknown>) => ({ config, kind: "spring", to }),
  };
});

import { LiveOdometer, ODOMETER_EM, odometerCells, odometerFontSize } from "./LiveOdometer";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";

function mount(label: string, reduceMotion = false) {
  shared.length = 0;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<LiveOdometer color="#fff" label={label} reduceMotion={reduceMotion} />);
  });
  return tree;
}

describe("odometer cells", () => {
  it("keys cells from the right so seconds stay seconds when the hours gain a digit", () => {
    const before = odometerCells("9:59:59");
    const after = odometerCells("10:00:00");
    expect(before.at(-1)).toEqual({ key: "cell-0", kind: "digit", value: "9" });
    expect(after.at(-1)).toEqual({ key: "cell-0", kind: "digit", value: "0" });
    expect(after.map((cell) => cell.key)).toEqual(["cell-7", ...before.map((cell) => cell.key)]);
    expect(after.filter((cell) => cell.kind === "separator")).toHaveLength(2);
  });

  it("scales with Dynamic Type up to the numeric cap and shrinks only to fit the card", () => {
    expect(odometerFontSize({ baseSize: 58, fontScale: 1, label: "1:02:03", width: null })).toBe(58);
    expect(odometerFontSize({ baseSize: 58, fontScale: 3, label: "1:02:03", width: null })).toBeCloseTo(69.6);
    expect(odometerFontSize({ baseSize: 58, fontScale: 0.8, label: "1:02:03", width: 400 })).toBe(58);
    // 123:45:06 needs 7 digits and 2 separators: 4.94 em, so a 260-point card fits about 52.6 points.
    const fitted = odometerFontSize({ baseSize: 58, fontScale: 1, label: "123:45:06", width: 260 });
    expect(fitted).toBeLessThan(58);
    expect(fitted * (7 * ODOMETER_EM.digitWidth + 2 * ODOMETER_EM.separatorWidth)).toBeLessThanOrEqual(260);
  });
});

describe("LiveOdometer", () => {
  it("rolls only the digits that changed, with the roll spring", () => {
    const tree = mount("0:00:09");
    const strips = [...shared];
    const cell = Math.round(58 * ODOMETER_EM.height * 10) / 10;
    expect(strips.map((value) => value.value)).toEqual([0, 0, 0, 0, -9 * cell]);
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion={false} />));
    expect(strips[3].value).toEqual({ config: { ...BLOCKS_SPRING.roll, reduceMotion: "never" }, kind: "spring", to: -cell });
    expect(strips[4].value).toEqual({ config: { ...BLOCKS_SPRING.roll, reduceMotion: "never" }, kind: "spring", to: 0 });
    expect(strips[0].value).toBe(0);
    act(() => tree.unmount());
  });

  it("sets digits in place under Reduce Motion", () => {
    const tree = mount("0:00:09", true);
    const strips = [...shared];
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion />));
    const cell = Math.round(58 * ODOMETER_EM.height * 10) / 10;
    expect(strips[3].value).toBe(-cell);
    expect(strips[4].value).toBe(0);
    act(() => tree.unmount());
  });

  it("re-places the strips without rolling when the cell size changes", () => {
    const tree = mount("0:00:09");
    const strips = [...shared];
    const track = tree.root.findByProps({ testID: "today-live-odometer" });
    act(() => track.props.onLayout({ nativeEvent: { layout: { height: 60, width: 150, x: 0, y: 0 } } }));
    const size = odometerFontSize({ baseSize: 58, fontScale: 1, label: "0:00:09", width: 150 });
    const cell = Math.round(size * ODOMETER_EM.height * 10) / 10;
    expect(size).toBeLessThan(58);
    expect(strips[4].value).toBe(-9 * cell);
    act(() => tree.unmount());
  });
});
