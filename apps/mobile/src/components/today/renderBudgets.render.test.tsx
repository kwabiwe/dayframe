import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Render-count budgets (`.codex/reference/performance.md`, guardrail 5b). The Dashboard provider sits
 * above the three native tabs, so every provider render re-renders Today, Calendar and Reports: on
 * 13 Oct a per-second provider render cost 17–19 % of a core behind Settings and 28 % with Today in
 * front. The probe below composes the real clock hooks exactly as `DayframeDashboard` does (the
 * expressions are pinned by `idleClock.contract.test.ts`) around the real live block clock and
 * odometer. Over two minutes of fake time per scene, one timer callback per act, it counts the provider's own commits
 * and, with React's Profiler, every commit inside the live block. Scope: React commits only; the breathing
 * ring and digit springs run on the native driver, guarded by idleClock.contract.test.ts.
 */
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const appState = vi.hoisted(() => ({
  currentState: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", async () => {
  const { createFakeAnimated, fakeNativeEasing } = await import("../../test/fakeNativeAnimated");
  return {
    Animated: createFakeAnimated(),
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
    Platform: { OS: "ios", select: (choices: Record<string, unknown>) => choices.ios ?? choices.default },
    StyleSheet: { create: (styles: unknown) => styles },
    Text: "Text",
    View: "View",
    useWindowDimensions: () => ({ fontScale: 1, height: 874, scale: 3, width: 402 }),
  };
});

vi.mock("react-native-reanimated", async () => {
  const React = await import("react");
  return {
    default: { View: "ReanimatedView" },
    ReduceMotion: { Never: "never" },
    cancelAnimation: vi.fn(),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => React.useRef({ value: initial }).current,
    withSpring: (to: unknown, config: Record<string, unknown>) => ({ config, kind: "spring", to }),
  };
});

import { Profiler, useCallback, useLayoutEffect, useState } from "react";
import { useAppForeground } from "../../lib/appForeground";
import { useDashboardClockTicks, useLiveTimeInFront } from "../../lib/dashboardClock";
import { activeTimerElapsedSeconds } from "../../lib/timerPresentation";
import { LiveOdometer } from "./LiveOdometer";
import { useLiveBlockElapsed, type LiveBlockClockInput } from "./liveBlockClock";
import { formatLiveClock } from "./todayBlocksLayout";

const STARTED_AT = "2026-10-14T08:00:00.000Z";
const WINDOW_SECONDS = 120;
type Route = "today" | "calendar" | "reports" | "settings";

/** Commit times per id (fake clock), so only commits inside the window count. */
const commits = new Map<string, number[]>();
const count = (id: string) => commits.set(id, [...(commits.get(id) ?? []), Date.now()]);

function LiveBlock({ active }: { active: LiveBlockClockInput }) {
  const elapsed = useLiveBlockElapsed(active);
  return <LiveOdometer color="#000" label={elapsed.label} reduceMotion={false} seconds={elapsed.seconds} />;
}

/** `DayframeDashboard`'s clock wiring: Reports shows live seconds; the live block keeps its own clock. */
function DashboardProbe({ calendarEdit, route, running, sheetOpen }: {
  calendarEdit: "running" | "completed" | null; route: Route; running: boolean; sheetOpen: boolean;
}) {
  const foreground = useAppForeground();
  const [now, setNowState] = useState(() => Date.now());
  // Counts every clock update, not only commits: an update with the same fake timestamp makes React skip
  // the commit here, though on a real clock it would render (Codex r4 on #405).
  const setNow = useCallback((value: number) => {
    count("clockUpdate");
    setNowState(value);
  }, []);
  const liveTimeInFront = useLiveTimeInFront(route === "reports", setNow);
  // As DayframeDashboard: only a running entry's Calendar editor shows live seconds.
  const runningCalendarEdit = calendarEdit === "running";
  const needsSecondClock = running || runningCalendarEdit;
  const secondsShown = (running && liveTimeInFront) || sheetOpen || runningCalendarEdit;
  useDashboardClockTicks({ foreground, needsSecondClock, secondsShown, setNow });
  const seconds = activeTimerElapsedSeconds({ durationSeconds: 0, startedAt: STARTED_AT }, now);
  // The provider's own renders (a Profiler around it would also count the live block's own updates).
  useLayoutEffect(() => {
    count("provider");
  });
  return (
    <Profiler id="liveBlock" onRender={() => count("liveBlock")}>
      {running ? (
        <LiveBlock
          active={{
            durationSeconds: 0,
            elapsedLabel: formatLiveClock(seconds),
            elapsedSeconds: seconds,
            hasLiveActiveTimer: true,
            startedAt: STARTED_AT,
          }}
        />
      ) : null}
    </Profiler>
  );
}


async function measure(scene: {
  route: Route; running?: boolean; sheetOpen?: boolean; background?: boolean; calendarEdit?: "running" | "completed";
}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <DashboardProbe
        calendarEdit={scene.calendarEdit ?? null}
        route={scene.route}
        running={scene.running ?? true}
        sheetOpen={scene.sheetOpen ?? false}
      />
    );
  });
  if (scene.background) {
    act(() => {
      appState.currentState = "background";
      for (const listener of [...appState.listeners]) listener("background");
    });
  }
  commits.clear();
  // One timer callback per act, so no two updates can share a commit (Codex r2 on #405).
  const end = Date.now() + WINDOW_SECONDS * 1000;
  // Async acts flush promise microtasks after each callback, so updates they schedule are counted too.
  while (vi.getTimerCount() > 0 && Date.now() <= end) {
    await act(async () => {
      await vi.advanceTimersToNextTimerAsync();
    });
  }
  await act(async () => {
    await Promise.resolve();
  });
  const within = (id: string) => (commits.get(id) ?? []).filter((at) => at <= end).length;
  // The provider's budget applies to its commits and to its clock updates, whichever is higher.
  const result = { liveBlock: within("liveBlock"), provider: Math.max(within("provider"), within("clockUpdate")) };
  act(() => tree.unmount());
  return result;
}

describe("render budgets over two minutes with a block running (performance.md)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mid-minute, so the window crosses exactly two minute boundaries.
    vi.setSystemTime(new Date("2026-10-14T09:15:30.250Z"));
    appState.currentState = "active";
    appState.listeners.clear();
    commits.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["Today in front", { route: "today" as const }, 2],
    ["Calendar in front", { route: "calendar" as const }, 2],
    ["Settings covering the tabs", { route: "settings" as const }, 2],
    ["Today in front, nothing running", { route: "today" as const, running: false }, 2],
    ["Calendar editing a completed entry", { route: "calendar" as const, calendarEdit: "completed" as const }, 2],
  ])("%s: the Dashboard renders only at minute boundaries", async (_name, scene, budget) => {
    expect((await measure(scene)).provider).toBeLessThanOrEqual(budget);
  });

  it("Reports in front: the Dashboard renders once a second, never more", async () => {
    expect((await measure({ route: "reports" })).provider).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it("a running entry's sheet open: once a second, never more", async () => {
    expect((await measure({ route: "today", sheetOpen: true })).provider).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it("Calendar editing the running entry: once a second, never more", async () => {
    expect((await measure({ route: "calendar", calendarEdit: "running", running: false })).provider).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it("the probe's Calendar-edit rule is the Dashboard's", async () => {
    const { readFileSync } = await import("node:fs");
    const dashboard = readFileSync(new URL("../DayframeDashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toContain("const runningCalendarEdit = Boolean(calendarEditEntry && !calendarEditEntry.stoppedAt);");
    expect(dashboard).toContain("const needsSecondClock = Boolean(retainedActiveEntryForSheet) || runningCalendarEdit;");
  });

  it("the live block renders once a second (plus the Dashboard's minute renders), never per frame", async () => {
    const { liveBlock } = await measure({ route: "today" });
    expect(liveBlock).toBeGreaterThanOrEqual(WINDOW_SECONDS - 1);
    expect(liveBlock).toBeLessThanOrEqual(WINDOW_SECONDS + 2);
  });

  it("in the background nothing renders at all", async () => {
    expect(await measure({ route: "reports", background: true })).toEqual({ liveBlock: 0, provider: 0 });
    expect(await measure({ route: "today", background: true })).toEqual({ liveBlock: 0, provider: 0 });
  });
});
