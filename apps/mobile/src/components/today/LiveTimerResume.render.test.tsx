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
import { useDashboardClockTicks, useLiveTimeInFront } from "../../lib/dashboardClock";
import { activeTimerElapsedSeconds } from "../../lib/timerPresentation";
import { LiveOdometer, ODOMETER_EM } from "./LiveOdometer";
import { useLiveBlockElapsed, type LiveBlockClockInput } from "./liveBlockClock";
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

/** The Dashboard's live path with the route: Today in front, or covered by a pushed page such as Settings. */
function RoutedLiveTimer({ inFront }: { inFront: boolean }) {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  const liveTimeInFront = useLiveTimeInFront(inFront, setNow);
  useDashboardClockTicks({ foreground, needsSecondClock: true, secondsShown: liveTimeInFront, setNow });
  const seconds = activeTimerElapsedSeconds({ durationSeconds: 0, startedAt: STARTED_AT }, now);
  useLayoutEffect(() => {
    commits.push(shownDigits(shared.slice(-5)));
  });
  return (
    <LiveOdometer color="#000" label={formatLiveClock(seconds)} reduceMotion={!liveTimeInFront} seconds={seconds} />
  );
}

describe("live timer behind Settings (iPhone 17, 13 Oct)", () => {
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

  it("re-renders only for a new minute while Today is covered, and shows the true time in the first frame back", () => {
    // 28 s into the block, Today in front: the clock ticks every second.
    vi.setSystemTime(new Date("2026-10-13T13:48:38.800Z"));
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RoutedLiveTimer inFront />);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(shownDigits(shared.slice(-5))).toEqual([0, 0, 0, 3, 0]);

    // Settings pushed over Today at 13:48:40.8. Each second used to re-render the whole Dashboard;
    // now only the two minute boundaries (13:49 and 13:50) do, over 85 s.
    act(() => tree.update(<RoutedLiveTimer inFront={false} />));
    const covered = commits.length;
    // One act per second, so every re-render commits on its own.
    for (let second = 0; second < 85; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(commits.length - covered).toBe(2);

    // Back on Today at 13:50:05.8, 1 min 55 s in: the first commit already shows it, at rest.
    shared.length = 0;
    const back = commits.length;
    act(() => tree.update(<RoutedLiveTimer inFront />));
    expect(commits[back]).toEqual([0, 0, 1, 5, 5]);
    expect(shared.every((strip) => typeof strip.value === "number")).toBe(true);

    // And it ticks every second again: the seconds roll to 0:01:56.
    const strips = [...shared];
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(strips[4].value).toEqual({ config: { ...BLOCKS_SPRING.roll, reduceMotion: "never" }, kind: "spring", to: -6 * CELL });
    act(() => tree.unmount());
  });
});

let providerCommits = 0;
/** The live block with its own clock (useLiveBlockElapsed), as TodayLiveBlock renders it. */
function LiveBlockTime({ active, reduceMotion }: { active: LiveBlockClockInput; reduceMotion: boolean }) {
  const elapsed = useLiveBlockElapsed(active);
  useLayoutEffect(() => {
    commits.push(shownDigits(shared.slice(-5)));
  });
  return <LiveOdometer color="#000" label={elapsed.label} reduceMotion={reduceMotion} seconds={elapsed.seconds} />;
}
/** The Dashboard's side: behind Settings it moves on the minute; the route has not changed yet. */
function CoveredDashboard({ inFront }: { inFront: boolean }) {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  const liveTimeInFront = useLiveTimeInFront(inFront, setNow);
  useDashboardClockTicks({ foreground, needsSecondClock: true, secondsShown: liveTimeInFront, setNow });
  const seconds = activeTimerElapsedSeconds({ durationSeconds: 0, startedAt: STARTED_AT }, now);
  useLayoutEffect(() => {
    providerCommits += 1;
  });
  return (
    <LiveBlockTime
      active={{
        durationSeconds: 0,
        elapsedLabel: formatLiveClock(seconds),
        elapsedSeconds: seconds,
        hasLiveActiveTimer: true,
        startedAt: STARTED_AT,
      }}
      reduceMotion={!liveTimeInFront}
    />
  );
}

describe("the live block keeps its own time while Today is covered (Codex r1 on #384)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appState.currentState = "active";
    appState.listeners.clear();
    appState.changeWhileSubscribing = null;
    shared.length = 0;
    commits.length = 0;
    providerCommits = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the true time every second behind Settings, so a swipe back reveals it before the route changes", () => {
    vi.setSystemTime(new Date("2026-10-13T13:48:38.800Z"));
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CoveredDashboard inFront={false} />);
    });
    const providerAtStart = providerCommits;
    // 85 s behind Settings, one act per second: the block's digits follow real time each second...
    for (let second = 0; second < 85; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    // ...0:01:53 at 13:50:03.8, while the Dashboard re-rendered only at the two minute boundaries.
    expect(shownDigits(shared.slice(-5))).toEqual([0, 0, 1, 5, 3]);
    expect(providerCommits - providerAtStart).toBe(2);
    // The route flips to Today when the swipe completes: the time shown stays right (no jump back).
    act(() => tree.update(<CoveredDashboard inFront />));
    expect(shownDigits(shared.slice(-5))).toEqual([0, 0, 1, 5, 3]);
    act(() => tree.unmount());
  });
});
