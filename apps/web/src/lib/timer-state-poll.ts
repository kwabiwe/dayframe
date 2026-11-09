// The web's `/api/timer-state` cadence (30 Oct 2026; `.codex/reference/performance.md`). The old 3 s poll
// while visible was about 1,200 requests an hour per tab, the largest share of staging traffic. Now: 10 s
// while the tab is visible and focused, 60 s while visible but not focused, nothing while hidden, with one
// immediate check on focus, on a return to visibility and after the user's own timer actions. The iPhone
// keeps its own cadence (`timerStatePollDelay` in `@dayframe/shared`).

export const WEB_TIMER_STATE_FOCUSED_INTERVAL_MS = 10_000;
export const WEB_TIMER_STATE_UNFOCUSED_INTERVAL_MS = 60_000;
export const WEB_TIMER_STATE_MAX_BACKOFF_MS = 120_000;

/**
 * The wait before the next poll. Failures back off from the focused interval, doubling (20, 40, 80 s) up to
 * 120 s, never sooner than the tab's ordinary interval; a success resets the count.
 */
export function webTimerStatePollDelay({ focused, consecutiveFailures }: { focused: boolean; consecutiveFailures: number }) {
  const interval = focused ? WEB_TIMER_STATE_FOCUSED_INTERVAL_MS : WEB_TIMER_STATE_UNFOCUSED_INTERVAL_MS;
  if (consecutiveFailures <= 0) return interval;
  const backoff = Math.min(
    WEB_TIMER_STATE_FOCUSED_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 8),
    WEB_TIMER_STATE_MAX_BACKOFF_MS
  );
  return Math.max(interval, backoff);
}
