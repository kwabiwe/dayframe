import { useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

let fontScale = 1;
const appState = vi.hoisted(() => ({
  currentState: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", async () => {
  const { createFakeAnimated, fakeNativeEasing } = await import("../../test/fakeNativeAnimated");
  return {
  // The digits' strips are React Native Animated values on the native driver (13 Oct).
  Animated: createFakeAnimated((value) => shared.push(value)),
  Easing: fakeNativeEasing,
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale, height: 874, scale: 3, width: 402 }),
  };
});

function setAppState(state: string) {
  appState.currentState = state;
  for (const listener of [...appState.listeners]) listener(state);
}

type Shared = { value: unknown; stops: number };
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
      ref.current = { stops: 0, value: initial };
      shared.push(ref.current);
    }
    return ref.current;
  },
  withSpring: (to: unknown, config: Record<string, unknown>) => ({ config, kind: "spring", to }),
  };
});

import { LiveOdometer, ODOMETER_EM, odometerCells, odometerFontSize, odometerTickRolls } from "./LiveOdometer";
import { useAppForegroundState } from "../../lib/appForeground";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";

function mount(label: string, reduceMotion = false, seconds?: number) {
  shared.length = 0;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<LiveOdometer color="#fff" label={label} reduceMotion={reduceMotion} seconds={seconds} />);
  });
  return tree;
}

const CELL = Math.round(58 * ODOMETER_EM.height * 10) / 10;
const spring = (to: number) => ({ config: { ...BLOCKS_SPRING.roll, toValue: to, useNativeDriver: true }, kind: "spring", to });

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
    expect(strips[3].value).toEqual(spring(-cell));
    expect(strips[4].value).toEqual(spring(0));
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

  it("settles a roll still running when Today is covered, and leaves it at rest when Today is back (Codex r1 on #380)", () => {
    const tree = mount("0:00:09", false, 9);
    const strips = [...shared];
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion={false} seconds={10} />));
    expect(strips[3].value).toEqual(spring(-CELL));
    expect(strips[4].value).toEqual(spring(0));
    const stopsBefore = strips.map((strip) => strip.stops);
    // Covered in the same second: the digits did not change, but the two rolls stop where they land.
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion seconds={10} />));
    expect(strips.map((strip) => strip.value)).toEqual([0, 0, 0, -CELL, 0]);
    expect(strips.map((strip, index) => strip.stops - stopsBefore[index])).toEqual([1, 1, 1, 1, 1]);
    // Back on Today: nothing rolls until a digit changes, and the next tick rolls again.
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion={false} seconds={10} />));
    expect(strips.map((strip) => strip.value)).toEqual([0, 0, 0, -CELL, 0]);
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:11" reduceMotion={false} seconds={11} />));
    expect(strips[4].value).toEqual(spring(-CELL));
    expect(strips[3].value).toBe(-CELL);
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

describe("odometer ticks and jumps (investigation 2026-10-13, TestFlight 117)", () => {
  it("rolls only for an ordinary tick of one or two seconds", () => {
    expect(odometerTickRolls(undefined, 10)).toBe(true);
    expect(odometerTickRolls(9, 10)).toBe(true);
    expect(odometerTickRolls(9, 11)).toBe(true);
    expect(odometerTickRolls(9, 9)).toBe(false);
    expect(odometerTickRolls(28, 818)).toBe(false);
    expect(odometerTickRolls(818, 28)).toBe(false);
  });

  it("remounts every digit at rest on a jump, then rolls the next ordinary tick", () => {
    const tree = mount("0:00:28", false, 28);
    const before = [...shared];
    shared.length = 0;
    act(() => tree.update(<LiveOdometer color="#fff" label="0:13:38" reduceMotion={false} seconds={818} />));
    const after = [...shared];
    // Fresh strips at rest for 0:13:38; nothing rolled through the 13 minutes.
    expect(after.map((strip) => strip.value)).toEqual([0, -1 * CELL, -3 * CELL, -3 * CELL, -8 * CELL]);
    expect(before.map((strip) => strip.value)).toEqual([0, 0, 0, -2 * CELL, -8 * CELL]);
    act(() => tree.update(<LiveOdometer color="#fff" label="0:13:39" reduceMotion={false} seconds={819} />));
    expect(after[4].value).toEqual(spring(-9 * CELL));
    expect(after[2].value).toBe(-3 * CELL);
    act(() => tree.unmount());
  });

  it("a jump right after an ordinary roll leaves no roll running (Codex r1 on #377)", () => {
    const tree = mount("0:00:09", false, 9);
    const first = [...shared];
    act(() => tree.update(<LiveOdometer color="#fff" label="0:00:10" reduceMotion={false} seconds={10} />));
    expect(first[3].value).toEqual(spring(-CELL));
    expect(first[4].value).toEqual(spring(0));
    shared.length = 0;
    act(() => tree.update(<LiveOdometer color="#fff" label="0:01:10" reduceMotion={false} seconds={70} />));
    // Every strip is new and at rest: the seconds strips that were rolling are gone with their springs.
    expect(shared).toHaveLength(5);
    expect(shared.map((strip) => strip.value)).toEqual([0, 0, -1 * CELL, -1 * CELL, 0]);
    act(() => tree.unmount());
  });

  it("remounts the digits at rest in the same commit as the return to the app", () => {
    setAppState("active");
    const commits: number[] = [];
    function Probe() {
      // Renders in the same batch as the odometer (it listens to the same AppState event) and runs
      // after that commit, before passive effects: what the first frame back would show.
      useAppForegroundState();
      useLayoutEffect(() => {
        commits.push(shared.length);
      });
      return null;
    }
    shared.length = 0;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <>
          <LiveOdometer color="#fff" label="0:00:28" reduceMotion={false} seconds={28} />
          <Probe />
        </>
      );
    });
    const before = [...shared];
    act(() => setAppState("background"));
    const commitsBeforeReturn = commits.length;
    act(() => setAppState("active"));
    // The commit caused by the return already holds fresh strips (no frame with the old ones).
    expect(commits[commitsBeforeReturn]).toBe(10);
    expect(shared.slice(5).every((strip) => !before.includes(strip))).toBe(true);
    expect(shared.slice(5).map((strip) => strip.value)).toEqual([0, 0, 0, -2 * CELL, -8 * CELL]);
    act(() => tree.unmount());
  });
});
