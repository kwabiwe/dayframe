import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const appState = vi.hoisted(() => ({
  currentState: "active",
  listeners: new Set<(state: string) => void>(),
  /** Simulates a change that lands before the listener is attached: no event is ever delivered. */
  changeWhileSubscribing: null as string | null,
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      if (appState.changeWhileSubscribing) {
        appState.currentState = appState.changeWhileSubscribing;
        appState.changeWhileSubscribing = null;
      }
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1, height: 874, scale: 3, width: 402 }),
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

import { useLayoutEffect, useState } from "react";
import { useAppForeground } from "../../lib/appForeground";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import { useDashboardClockTicks } from "../../lib/dashboardClock";
import { activeTimerElapsedSeconds } from "../../lib/timerPresentation";
import { LiveOdometer, ODOMETER_EM } from "./LiveOdometer";
import { formatLiveClock } from "./todayBlocksLayout";

const CELL = Math.round(58 * ODOMETER_EM.height * 10) / 10;
const STARTED_AT = "2026-10-13T13:48:10.785Z";

function setAppState(state: string) {
  appState.currentState = state;
  for (const listener of [...appState.listeners]) listener(state);
}

/** What each commit would draw: the digits of the strips mounted at that commit, before passive effects. */
const commits: number[][] = [];

/** The Dashboard's live path: foreground → clock → elapsed seconds → the live block's odometer. */
function LiveTimer() {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  useDashboardClockTicks({ foreground, needsSecondClock: true, setNow });
  const seconds = activeTimerElapsedSeconds({ durationSeconds: 0, startedAt: STARTED_AT }, now);
  useLayoutEffect(() => {
    commits.push(shownDigits(shared.slice(-5)));
  });
  return <LiveOdometer color="#000" label={formatLiveClock(seconds)} reduceMotion={false} seconds={seconds} />;
}

/** The digit each strip rests on (a strip offset of -n cells shows n). */
function shownDigits(strips: Shared[]) {
  return strips.map((strip) => {
    const value = typeof strip.value === "number" ? strip.value : (strip.value as { to: number }).to;
    return Math.round(-value / CELL) + 0;
  });
}

describe("live timer: background → foreground with a running block (TestFlight 117, 13 Oct)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appState.currentState = "active";
    appState.listeners.clear();
    appState.changeWhileSubscribing = null;
    shared.length = 0;
    commits.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the right elapsed time at once on return and ticks every second again", () => {
    // Lunch started at 14:48:10.8 BST; the app was left 28 s later.
    vi.setSystemTime(new Date("2026-10-13T13:48:38.800Z"));
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<LiveTimer />);
    });
    expect(shownDigits(shared)).toEqual([0, 0, 0, 2, 8]);

    act(() => setAppState("inactive"));
    act(() => setAppState("background"));
    // Away for twelve and a half minutes (fake timers move the clock too): nothing ticks meanwhile.
    vi.setSystemTime(new Date("2026-10-13T14:00:12.800Z"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(shownDigits(shared.slice(0, 5))).toEqual([0, 0, 0, 2, 8]);

    // Back in the app at 15:01:12.8: 13 min 2 s, shown at rest straight away, with no roll — already
    // in the first commit after the return (Codex r1 on #377), not one commit later.
    shared.length = 0;
    const commitsBeforeReturn = commits.length;
    act(() => setAppState("active"));
    expect(commits[commitsBeforeReturn]).toEqual([0, 1, 3, 0, 2]);
    const back = [...shared];
    expect(back).toHaveLength(5);
    expect(back.every((strip) => typeof strip.value === "number")).toBe(true);
    expect(shownDigits(back)).toEqual([0, 1, 3, 0, 2]);

    // And the clock ticks once a second again: the seconds roll to 0:13:03, then 0:13:04.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(back[4].value).toEqual({ config: { ...BLOCKS_SPRING.roll, reduceMotion: "never" }, kind: "spring", to: -3 * CELL });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shownDigits(back)).toEqual([0, 1, 3, 0, 4]);
    // The minutes digits were set on return and stay right; nothing rolled through the time away.
    expect(back[1].value).toBe(-1 * CELL);
    expect(back[2].value).toBe(-3 * CELL);
    act(() => tree.unmount());
  });

  it("catches a return the first render missed (the state changed before the listener subscribed)", () => {
    vi.setSystemTime(new Date("2026-10-13T13:48:38.800Z"));
    appState.currentState = "background";
    // The app becomes active after the first render read the state but before the effect subscribes.
    appState.changeWhileSubscribing = "active";
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<LiveTimer />);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // The clock runs: 28 s + 2 s.
    expect(shownDigits(shared.slice(-5))).toEqual([0, 0, 0, 3, 0]);
    act(() => tree.unmount());
  });
});
