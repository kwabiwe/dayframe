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
 * The live block's own second clock. While Today is covered (Settings, Review, another tab) the
 * Dashboard moves on the minute; this clock re-renders the live block alone, so its time is right
 * whenever the block can be seen, also while a swipe back from Settings reveals it before the route
 * changes (Codex r1 on #384), and a return to the app reads the time in the same render (#377). The
 * Dashboard's value and this one come from the same entry; the block shows the fresher of the two.
 */
export function useLiveBlockElapsed(active: LiveBlockClockInput) {
  const foreground = useAppForeground();
  const [now, setNow] = useState(() => Date.now());
  const { durationSeconds, startedAt } = active;
  const live = active.hasLiveActiveTimer && startedAt !== undefined && durationSeconds !== undefined;
  useDashboardClockTicks({ foreground, needsSecondClock: live, setNow });
  if (!live) return { label: active.elapsedLabel, seconds: active.elapsedSeconds };
  const seconds = Math.max(active.elapsedSeconds, activeTimerElapsedSeconds({ durationSeconds, startedAt }, now));
  return { label: seconds === active.elapsedSeconds ? active.elapsedLabel : formatLiveClock(seconds), seconds };
}
