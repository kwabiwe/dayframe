/**
 * The time wheel's minute step (owner decision A11b, 12 Oct 2026): 5-minute rows by default, every
 * minute on request — and always for a time that isn't on a 5-minute step, so opening the wheel
 * never rounds a time silently.
 */
export function timeWheelMinuteInterval(valueMs: number, everyMinute: boolean): 1 | 5 {
  if (everyMinute || !Number.isFinite(valueMs)) return 1;
  return new Date(valueMs).getMinutes() % 5 === 0 ? 5 : 1;
}

const MINUTE_MS = 60_000;

/**
 * VoiceOver's adjustable time card (A11b: the wheel isn't offered to VoiceOver). One swipe up or
 * down moves the time to the next or previous 5-minute step of the clock (09:32 → 09:35 up, 09:30
 * down; seconds drop), counted in real minutes so the repeated hour at a clock change is passed
 * through rather than skipped. It never leaves the card's day (the date has its own control) or the
 * bounds; null means there is nowhere to go.
 */
export function timeWheelAccessibilityStep(
  valueMs: number,
  direction: 1 | -1,
  bounds: { maximumMs?: number | null; minimumMs?: number | null } = {}
): number | null {
  if (!Number.isFinite(valueMs)) return null;
  const value = new Date(valueMs);
  const minuteStartMs = valueMs - value.getSeconds() * 1000 - value.getMilliseconds();
  const minute = value.getMinutes();
  const offset = direction === 1 ? 5 - (minute % 5) : -(minute % 5 || 5);
  // On a 5-minute step with seconds, "down" lands on that step itself (09:30:20 → 09:30).
  const nextMs = direction === -1 && minute % 5 === 0 && minuteStartMs < valueMs
    ? minuteStartMs
    : minuteStartMs + offset * MINUTE_MS;
  const next = new Date(nextMs);
  if (next.getFullYear() !== value.getFullYear() || next.getMonth() !== value.getMonth() || next.getDate() !== value.getDate()) return null;
  if (bounds.maximumMs != null && nextMs > bounds.maximumMs) return null;
  if (bounds.minimumMs != null && nextMs < bounds.minimumMs) return null;
  return nextMs;
}
