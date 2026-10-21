/**
 * The entry sheet's End reads against Start's time of day, as the web editors do (owner, 21 Oct
 * 2026): an End later than Start's time of day is on Start's day, at or before it the next day. So
 * moving the End wheel to 21:30 on a 21:00 → 06:04 (next day) block gives 30m, never 24h 30m. An End
 * date chosen on the date sheet wins; the sheet's 24 h limit still applies on Save.
 */
export function inferEndOnStartDay(startMs: number, endMs: number): number {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const onDay = (dayOffset: number) => new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + dayOffset,
    end.getHours(),
    end.getMinutes(),
    end.getSeconds(),
    end.getMilliseconds()
  ).getTime();
  const sameDay = onDay(0);
  return sameDay > startMs ? sameDay : onDay(1);
}

/** A Start moved to or past End carries End with it, keeping the duration; otherwise null. */
export function endFollowingStart(previousStartMs: number, previousEndMs: number, nextStartMs: number): number | null {
  if (nextStartMs < previousEndMs) return null;
  return nextStartMs + Math.max(0, previousEndMs - previousStartMs);
}
