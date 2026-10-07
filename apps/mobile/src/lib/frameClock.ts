/**
 * The dashboard ticks every second for the live elapsed time. Anything that only shows whole
 * minutes (history rows, day totals, the native Calendar model) reads this instead, so it is
 * rebuilt once a minute rather than every second (investigation 2026-10-07, dropped frames).
 *
 * The clock never falls behind the newest start or stop already shown: a timer started, or a
 * short entry stopped, earlier in the current minute would otherwise end before it begins and
 * drop out of Today and the Calendar until the next minute. It never runs ahead of real time.
 */
export function minuteClock(nowMs: number, newestShownMs = 0) {
  const floored = Math.floor(nowMs / 60_000) * 60_000;
  if (newestShownMs + 1000 <= floored) return floored;
  return Math.min(nowMs, newestShownMs + 1000);
}

type TimedEntry = { startedAt: string; stoppedAt: string | null };

/** The newest start or stop at or before now; future-dated timestamps are ignored. */
export function newestShownTimestamp(entries: readonly TimedEntry[], nowMs: number) {
  let newest = 0;
  for (const entry of entries) {
    for (const value of [entry.startedAt, entry.stoppedAt]) {
      if (!value) continue;
      const ms = Date.parse(value);
      if (Number.isFinite(ms) && ms <= nowMs && ms > newest) newest = ms;
    }
  }
  return newest;
}
