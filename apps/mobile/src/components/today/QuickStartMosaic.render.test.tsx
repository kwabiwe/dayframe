import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { StrictMode, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const appState = vi.hoisted(() => ({ currentState: "active", listeners: new Set<(state: string) => void>() }));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  // 375 − 2 × 16 = 343, the width the mosaic's onLayout reports below.
  useWindowDimensions: () => ({ fontScale: 1, height: 812, scale: 3, width: 375 }),
}));
vi.mock("react-native-svg", () => ({ Circle: "Circle", Path: "Path", Rect: "Rect", default: "Svg" }));
vi.mock("../icons/DayframeIcon", () => ({ ActivityIcon: "ActivityIcon" }));
vi.mock("../../lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 220 },
  localLayoutTransition: () => "layout",
  localPresenceExiting: () => "exiting",
}));
// Shared values that keep their value across renders, and animations whose frames never run (the
// Trello 210 failure): assigning an animation leaves the value where it was. Styles read the
// values when the test reads them, as Reanimated's do on the UI thread.
vi.mock("react-native-reanimated", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  const React = (await import("../../../../../node_modules/react/index.js")) as typeof import("react");
  const animation = (target: unknown) => ({ animation: target });
  return {
    default: { View: "ReanimatedView" },
    Easing: { in: () => undefined, inOut: () => undefined, quad: undefined, sin: undefined },
    ReduceMotion: { Always: "always", Never: "never", System: "system" },
    cancelAnimation: () => undefined,
    useAnimatedStyle: (factory: () => Record<string, unknown>) => {
      const style = {};
      for (const key of Object.keys(factory())) Object.defineProperty(style, key, { enumerable: true, get: () => factory()[key] });
      return style;
    },
    useSharedValue: (initial: unknown) =>
      React.useRef(
        (() => {
          let current = initial;
          return {
            get value() {
              return current;
            },
            set value(next: unknown) {
              if (!(next && typeof next === "object" && "animation" in next)) current = next;
            },
          };
        })()
      ).current,
    withDelay: (_delay: number, next: unknown) => next,
    withRepeat: (next: unknown) => next,
    withSequence: (...next: unknown[]) => next[0],
    withSpring: animation,
    withTiming: animation,
  };
});

import { QuickStartMosaic, resetMosaicDropInForTests } from "./QuickStartMosaic";
import { layoutQuickStartMosaic } from "../../lib/quickStartMosaic";
import {
  quickStartDiagnosticsSummary,
  readQuickStartDiagnostics,
  recordQuickStartLayout,
  recordQuickStartTileFoundHidden,
  resetQuickStartDiagnosticsForTests,
} from "../../lib/quickStartDiagnostics";

const theme = { ...DAYFRAME_THEME.dark, mode: "dark", pressed: "pressed" } as never;
const twoTiles = layoutQuickStartMosaic([
  { color: "moss", icon: "work", id: "work", name: "Work", weekSeconds: 7200 },
  { color: "blue", icon: null, id: "gym", name: "Gym", weekSeconds: 1800 },
]);
const threeTiles = layoutQuickStartMosaic([
  { color: "moss", icon: "work", id: "work", name: "Work", weekSeconds: 7200 },
  { color: "blue", icon: null, id: "gym", name: "Gym", weekSeconds: 1800 },
  { color: "rose", icon: null, id: "read", name: "Read", weekSeconds: 900 },
]);

function props(overrides: Partial<ComponentProps<typeof QuickStartMosaic>> = {}): ComponentProps<typeof QuickStartMosaic> {
  return {
    columns: twoTiles,
    onOpenRunning: vi.fn(),
    onStartActivity: vi.fn(),
    reduceMotion: false,
    runningActivityId: null,
    theme,
    timerRunning: false,
    ...overrides,
  };
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  return (style && typeof style === "object" ? { ...style } : {}) as Record<string, unknown>;
}

function layers(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAllByType("ReanimatedView" as never)
    .filter((node) => node.props.testID === testID)
    .map((node) => flatStyle(node.props.style));
}

/** Each tile's visible state: drop-in opacity, fade opacity and the drop-in's transform. */
function tiles(tree: ReactTestRenderer) {
  const fades = layers(tree, "quick-start-tile-fade");
  return layers(tree, "quick-start-tile-drop").map((drop, index) => ({
    opacity: (drop.opacity as number) * (fades[index]?.opacity as number),
    transform: drop.transform,
  }));
}

const atRest = { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };

function render(input: ComponentProps<typeof QuickStartMosaic>, options?: Parameters<typeof create>[1]) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<QuickStartMosaic {...input} />, options);
  });
  return tree;
}

function layOut(tree: ReactTestRenderer, width = 343) {
  const mosaic = tree.root.findByProps({ testID: "today-quick-start-mosaic" });
  act(() => mosaic.props.onLayout({ nativeEvent: { layout: { height: 232, width, x: 0, y: 0 } } }));
}

function appStateChange(state: string) {
  appState.currentState = state;
  act(() => {
    for (const listener of [...appState.listeners]) listener(state);
  });
}

describe("QuickStartMosaic: tiles never depend on an animation surviving (Trello 210)", () => {
  beforeEach(() => {
    // Timers never fire on their own here: the 900 ms safety net is not what shows the tiles.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-20T19:00:00Z"));
    appState.currentState = "active";
    resetMosaicDropInForTests();
    resetQuickStartDiagnosticsForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles a drop-in whose frames never ran when the app returns to the foreground", () => {
    const tree = render(props());
    layOut(tree);
    // First paint: the drop-in starts below and hidden, and its frames never run.
    expect(tiles(tree)).toEqual([
      { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.92 }] },
      { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.92 }] },
    ]);
    // Days later, with the timer lost as well.
    vi.setSystemTime(new Date("2026-10-20T20:01:00Z"));
    appStateChange("background");
    expect(tiles(tree)[0].opacity).toBe(0);
    appStateChange("active");
    expect(tiles(tree)).toEqual([atRest, atRest]);
    // Found hidden after the safety net should have run: counted once per tile.
    expect(readQuickStartDiagnostics()).toMatchObject({ hiddenCount: 2, lastHiddenAt: Date.parse("2026-10-20T20:01:00Z"), tileCount: 2, width: 343 });
    act(() => tree.unmount());
  });

  it("settles hidden tiles when Today regains focus", () => {
    const tree = render(props({ focused: true }));
    layOut(tree);
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    act(() => tree.update(<QuickStartMosaic {...props({ focused: false })} />));
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    act(() => tree.update(<QuickStartMosaic {...props({ focused: true })} />));
    expect(tiles(tree)).toEqual([atRest, atRest]);
    act(() => tree.unmount());
  });

  it("settles on a new width after first paint, but an early settle is an interruption, not a hidden tile", () => {
    const tree = render(props());
    layOut(tree);
    expect(tiles(tree)[0].opacity).toBe(0);
    // Within the drop-in's own time: settled, not reported.
    layOut(tree, 320);
    expect(tiles(tree)).toEqual([atRest, atRest]);
    expect(readQuickStartDiagnostics()).toMatchObject({ hiddenCount: 0, width: 320, widthSource: "layout" });
    act(() => tree.unmount());
  });

  it("keeps the first-paint drop-in when the measured and laid-out widths agree", () => {
    const tree = render(props());
    // No onLayout yet: the screen-width fallback (343) already draws the tiles, dropping in.
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    layOut(tree, 343);
    // The same width from onLayout is not a re-layout, so the drop-in is not cut short.
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    act(() => tree.unmount());
  });

  it("never leaves the mosaic empty when onLayout reports no width but there are columns", () => {
    const tree = render(props());
    layOut(tree, 0);
    const slots = tree.root.findAllByType("ReanimatedView" as never).filter((node) => node.props.layout === "layout");
    expect(slots).toHaveLength(2);
    const slotWidths = slots.map((slot) => flatStyle(slot.props.style).width as number);
    expect(slotWidths.every((value) => value > 0)).toBe(true);
    expect(readQuickStartDiagnostics()).toMatchObject({ tileCount: 2, width: 343, widthSource: "window" });
    act(() => tree.unmount());
  });

  it("prefers the mosaic's own committed layout over the screen width when onLayout is missing", () => {
    const tree = render(props(), { createNodeMock: () => ({ measure: (callback: (...values: number[]) => void) => callback(0, 0, 330, 232) }) });
    expect(tree.root.findAllByType("ReanimatedView" as never).filter((node) => node.props.layout === "layout")).toHaveLength(2);
    expect(readQuickStartDiagnostics()).toMatchObject({ tileCount: 2, width: 330, widthSource: "measure" });
    act(() => tree.unmount());
  });

  it("keeps a later-pinned tile's fade while the tiles already shown settle at rest", () => {
    const tree = render(props());
    layOut(tree);
    appStateChange("background");
    appStateChange("active");
    expect(tiles(tree)).toEqual([atRest, atRest]);
    act(() => tree.update(<QuickStartMosaic {...props({ columns: threeTiles })} />));
    const fades = Object.fromEntries(
      tree.root.findAllByType("ReanimatedView" as never)
        .filter((node) => node.props.layout === "layout")
        .map((slot) => [String(slot.findByType("Pressable" as never).props.testID).replace("quick-start-", ""), flatStyle(slot.findByProps({ testID: "quick-start-tile-fade" }).props.style).opacity])
    );
    expect(fades).toEqual({ gym: 1, read: 0, work: 1 });
    // The next foreground return shows it too.
    appStateChange("background");
    appStateChange("active");
    expect(tiles(tree)).toEqual([atRest, atRest, atRest]);
    act(() => tree.unmount());
  });

  it("keeps the drop-in through an ordinary re-render during the entrance (no settle)", () => {
    const tree = render(props());
    layOut(tree);
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    // The timer starting, a new handler and the running tile: same width, same tiles, same focus.
    act(() => tree.update(<QuickStartMosaic {...props({ onStartActivity: vi.fn(), runningActivityId: "work", timerRunning: true })} />));
    act(() => tree.update(<QuickStartMosaic {...props({ onStartActivity: vi.fn(), runningActivityId: "work", timerRunning: true })} />));
    expect(tiles(tree)).toEqual([
      { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.92 }] },
      { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.92 }] },
    ]);
    expect(readQuickStartDiagnostics().hiddenCount).toBe(0);
    act(() => tree.unmount());
  });

  it("settles after a StrictMode effect replay, with one AppState listener", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <StrictMode>
          <QuickStartMosaic {...props()} />
        </StrictMode>
      );
    });
    layOut(tree);
    // The replayed effects subscribe once, not twice.
    expect(appState.listeners.size).toBe(1);
    vi.setSystemTime(new Date("2026-10-20T20:01:00Z"));
    appStateChange("background");
    appStateChange("active");
    expect(tiles(tree)).toEqual([atRest, atRest]);
    // Never more than once per tile for one settle.
    expect(readQuickStartDiagnostics().hiddenCount).toBeLessThanOrEqual(2);
    act(() => tree.unmount());
    expect(appState.listeners.size).toBe(0);
  });

  it("leaves no AppState listener or safety timer behind on unmount", () => {
    const tree = render(props());
    layOut(tree);
    expect(appState.listeners.size).toBe(1);
    // Each tile's drop-in safety net is pending (frames never ran).
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => tree.unmount());
    expect(appState.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes a different real width after the screen-width fallback, then settles on foreground and focus returns", () => {
    const tree = render(props({ focused: true }));
    // No onLayout yet: drawn at the screen-width fallback, dropping in.
    expect(readQuickStartDiagnostics()).toMatchObject({ width: 343, widthSource: "window" });
    expect(tiles(tree).map((tile) => tile.opacity)).toEqual([0, 0]);
    const slotWidths = () =>
      tree.root.findAllByType("ReanimatedView" as never)
        .filter((node) => node.props.layout === "layout")
        .reduce((total, slot) => Math.max(total, (flatStyle(slot.props.style).left as number) + (flatStyle(slot.props.style).width as number)), 0);
    expect(slotWidths()).toBeLessThanOrEqual(343);
    // The real width differs: it wins, the tiles re-lay out to it and settle (an interruption, not hidden).
    layOut(tree, 320);
    expect(readQuickStartDiagnostics()).toMatchObject({ hiddenCount: 0, width: 320, widthSource: "layout" });
    expect(slotWidths()).toBeLessThanOrEqual(320);
    expect(tiles(tree)).toEqual([atRest, atRest]);
    vi.setSystemTime(new Date("2026-10-20T20:01:00Z"));
    appStateChange("background");
    appStateChange("active");
    expect(tiles(tree)).toEqual([atRest, atRest]);
    act(() => tree.update(<QuickStartMosaic {...props({ focused: false })} />));
    act(() => tree.update(<QuickStartMosaic {...props({ focused: true })} />));
    expect(tiles(tree)).toEqual([atRest, atRest]);
    // The width stays the real one through the returns, and nothing was found hidden.
    expect(readQuickStartDiagnostics()).toMatchObject({ hiddenCount: 0, width: 320, widthSource: "layout" });
    act(() => tree.unmount());
  });

  it("shows tiles at rest under Reduce Motion, and a settle finds nothing hidden", () => {
    const tree = render(props({ reduceMotion: true }));
    layOut(tree);
    expect(tiles(tree)).toEqual([atRest, atRest]);
    appStateChange("background");
    appStateChange("active");
    expect(readQuickStartDiagnostics().hiddenCount).toBe(0);
    act(() => tree.unmount());
  });
});

describe("quick-start diagnostics", () => {
  beforeEach(() => resetQuickStartDiagnosticsForTests());

  it("records the last width, tile count and hidden tiles, in plain words", () => {
    const formatTime = (at: number) => new Date(at).toISOString().slice(11, 16);
    expect(quickStartDiagnosticsSummary(readQuickStartDiagnostics(), formatTime)).toBe("No layout yet in this session");
    recordQuickStartLayout(343, "layout", 4);
    expect(quickStartDiagnosticsSummary(readQuickStartDiagnostics(), formatTime)).toBe("Last layout: 4 tiles at 343 pt wide. No hidden tiles found.");
    recordQuickStartLayout(343, "window", 1);
    recordQuickStartTileFoundHidden(Date.parse("2026-10-20T20:01:00Z"));
    expect(quickStartDiagnosticsSummary(readQuickStartDiagnostics(), formatTime)).toBe(
      "Last layout: 1 tile at 343 pt wide (from screen width). Set 1 hidden tile to rest, last 20:01."
    );
    recordQuickStartTileFoundHidden(Date.parse("2026-10-20T20:05:00Z"));
    expect(quickStartDiagnosticsSummary(readQuickStartDiagnostics(), formatTime)).toBe(
      "Last layout: 1 tile at 343 pt wide (from screen width). Set 2 hidden tiles to rest, last 20:05."
    );
    expect(readQuickStartDiagnostics()).toEqual({ hiddenCount: 2, lastHiddenAt: Date.parse("2026-10-20T20:05:00Z"), tileCount: 1, width: 343, widthSource: "window" });
  });
});
