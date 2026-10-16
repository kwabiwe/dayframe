const MINUTE_MS = 60_000;

/**
 * VoiceOver's adjustable time card (A11b: the wheel isn't offered to VoiceOver). A swipe up or down
 * moves to the next or previous 5-minute step of the clock (09:32 → 09:35 up, 09:30 down; owner, 16
 * Oct 2026, keeping 5 minutes for swipes); the card's "Plus 1 minute" / "Minus 1 minute" actions
 * step one minute (`minutes: 1`), so every minute stays reachable now that typing is gone (Codex r1
 * on #444). Seconds drop. Counted in real minutes, so the repeated hour at a clock change is passed
 * through rather than skipped. It never leaves the card's day (the date has its own control) or the
 * bounds; null means there is nowhere to go.
 */
export function timeWheelAccessibilityStep(
  valueMs: number,
  direction: 1 | -1,
  bounds: { maximumMs?: number | null; minimumMs?: number | null } = {},
  minutes: 1 | 5 = 5
): number | null {
  if (!Number.isFinite(valueMs)) return null;
  const value = new Date(valueMs);
  const minuteStartMs = valueMs - value.getSeconds() * 1000 - value.getMilliseconds();
  const minute = value.getMinutes();
  const offset = direction === 1 ? minutes - (minute % minutes) : -(minute % minutes || minutes);
  // On a step with seconds, "down" lands on that step itself (09:30:20 → 09:30).
  const nextMs = direction === -1 && minute % minutes === 0 && minuteStartMs < valueMs
    ? minuteStartMs
    : minuteStartMs + offset * MINUTE_MS;
  const next = new Date(nextMs);
  if (next.getFullYear() !== value.getFullYear() || next.getMonth() !== value.getMonth() || next.getDate() !== value.getDate()) return null;
  if (bounds.maximumMs != null && nextMs > bounds.maximumMs) return null;
  if (bounds.minimumMs != null && nextMs < bounds.minimumMs) return null;
  return nextMs;
}
