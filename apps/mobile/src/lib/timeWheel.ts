/**
 * The time wheel's minute step (owner decision A11b, 12 Oct 2026): 5-minute rows by default, every
 * minute on request — and always for a time that isn't on a 5-minute step, so opening the wheel
 * never rounds a time silently.
 */
export function timeWheelMinuteInterval(valueMs: number, everyMinute: boolean): 1 | 5 {
  if (everyMinute || !Number.isFinite(valueMs)) return 1;
  return new Date(valueMs).getMinutes() % 5 === 0 ? 5 : 1;
}
