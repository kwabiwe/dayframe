/**
 * The dashboard ticks every second for the live elapsed time. Anything that only shows whole
 * minutes (history rows, day totals, the native Calendar model) reads this instead, so it is
 * rebuilt once a minute rather than every second (investigation 2026-10-07, dropped frames).
 */
export function minuteClock(nowMs: number) {
  return Math.floor(nowMs / 60_000) * 60_000;
}
