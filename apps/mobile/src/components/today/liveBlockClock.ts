import { useState } from "react";
import { useAppForeground } from "../../lib/appForeground";
import { useDashboardClockTicks } from "../../lib/dashboardClock";
import { activeTimerElapsedSeconds } from "../../lib/timerPresentation";
import { formatLiveClock } from "./todayBlocksLayout";

export type LiveBlockClockInput = {
  elapsedLabel: string;
  elapsedSeconds: number;
  hasLiveActiveTimer: boolean;
  startedAt?: string;
  /** The running entry's stored duration, the floor for its elapsed time. */
  durationSeconds?: number;
};

/**
 * The live block's own second clock. The Dashboard moves on the minute, also with Today in front
 * (each of its ticks re-rendered all three tabs: about 28 % of a core on the iPhone 17 with a block
 * running, 13 Oct); this clock re-renders the live block alone, so its time is right whenever the
 * block can be seen, also while a swipe back from Settings reveals it before the route changes (Codex
 * r1 on #384), and a return to the app reads the time in the same render (#377). Seconds tick only
 * while the block is live and it shows the fresher of its own value and the Dashboard's (both from the
 * same entry). When it stops, it reads the time once, in that render, and holds it while it leaves: no
 * later tick, return to the app or Dashboard value (which keeps counting a stopped entry it retains for
 * the exit) moves it on (Codex r2 on #390, r1 on #392).
 */
export function useLiveBlockElapsed(active: LiveBlockClockInput) {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  const { durationSeconds, startedAt } = active;
  const clocked = startedAt !== undefined && durationSeconds !== undefined;
  const live = clocked && active.hasLiveActiveTimer;
  useDashboardClockTicks({ foreground: foreground && live, needsSecondClock: true, setNow });
  // The time held since the block stopped (React's "information from previous renders" pattern).
  const [held, setHeld] = useState<{ seconds: number; startedAt: string } | null>(null);
  if (!clocked) return { label: active.elapsedLabel, seconds: active.elapsedSeconds };
  const elapsedAt = (nowMs: number) =>
    Math.max(active.elapsedSeconds, activeTimerElapsedSeconds({ durationSeconds, startedAt }, nowMs));
  let seconds: number;
  if (live) {
    if (held !== null) setHeld(null);
    seconds = elapsedAt(now);
  } else if (held !== null && held.startedAt === startedAt) {
    seconds = held.seconds;
  } else {
    seconds = elapsedAt(Date.now());
    setHeld({ seconds, startedAt });
  }
  return { label: seconds === active.elapsedSeconds ? active.elapsedLabel : formatLiveClock(seconds), seconds };
}

/**
 * The live presentation as of `nowMs`. The Stop flight's ghost takes the block's place showing the
 * time it stopped at, not the Dashboard's last minute tick.
 */
export function livePresentationAt<T extends LiveBlockClockInput>(presentation: T, nowMs: number): T {
  const { durationSeconds, startedAt } = presentation;
  if (startedAt === undefined || durationSeconds === undefined) return presentation;
  const seconds = Math.max(presentation.elapsedSeconds, activeTimerElapsedSeconds({ durationSeconds, startedAt }, nowMs));
  if (seconds === presentation.elapsedSeconds) return presentation;
  return { ...presentation, elapsedLabel: formatLiveClock(seconds), elapsedSeconds: seconds };
}
