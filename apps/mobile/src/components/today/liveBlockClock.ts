import { useEffect, useState } from "react";
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
 * while the block is live; when it stops, the clock reads the time once more, so a leaving block shows
 * the time it stopped at. The Dashboard's value and this one come from the same entry; the block shows
 * the fresher of the two.
 */
export function useLiveBlockElapsed(active: LiveBlockClockInput) {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  const { durationSeconds, startedAt } = active;
  const clocked = startedAt !== undefined && durationSeconds !== undefined;
  const live = clocked && active.hasLiveActiveTimer;
  useDashboardClockTicks({ foreground: foreground && live, needsSecondClock: true, setNow });
  // A stopping block reads the time once more, then holds it while it leaves (Codex r2 on #390: a
  // minute tick could otherwise move it on during the exit).
  useEffect(() => {
    if (clocked && !live) setNow(Date.now());
  }, [clocked, live]);
  if (!clocked) return { label: active.elapsedLabel, seconds: active.elapsedSeconds };
  const seconds = Math.max(active.elapsedSeconds, activeTimerElapsedSeconds({ durationSeconds, startedAt }, now));
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
