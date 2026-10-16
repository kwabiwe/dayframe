const MINUTE_MS = 60_000;

/**
 * VoiceOver's adjustable time card (A11b: the wheel isn't offered to VoiceOver). One swipe up or
 * down moves the time one minute, like the wheel (owner, 16 Oct 2026; Codex r1 on #444: with typing
 * gone this is VoiceOver's only route to any minute). Seconds drop: down from 09:30:20 lands on
 * 09:30. Counted in real minutes, so the repeated hour at a clock change is passed through rather
 * than skipped. It never leaves the card's day (the date has its own control) or the bounds; null
 * means there is nowhere to go.
 */
export function timeWheelAccessibilityStep(
  valueMs: number,
  direction: 1 | -1,
  bounds: { maximumMs?: number | null; minimumMs?: number | null } = {}
): number | null {
  if (!Number.isFinite(valueMs)) return null;
  const value = new Date(valueMs);
  const minuteStartMs = valueMs - value.getSeconds() * 1000 - value.getMilliseconds();
  const nextMs = direction === 1
    ? minuteStartMs + MINUTE_MS
    : minuteStartMs < valueMs ? minuteStartMs : minuteStartMs - MINUTE_MS;
  const next = new Date(nextMs);
  if (next.getFullYear() !== value.getFullYear() || next.getMonth() !== value.getMonth() || next.getDate() !== value.getDate()) return null;
  if (bounds.maximumMs != null && nextMs > bounds.maximumMs) return null;
  if (bounds.minimumMs != null && nextMs < bounds.minimumMs) return null;
  return nextMs;
}
