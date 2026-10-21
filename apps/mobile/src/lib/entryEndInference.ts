/**
 * The entry sheet's End reads against Start's time of day, as the web editors do (owner, 21 Oct
 * 2026): an End later than Start's time of day is on Start's day, at or before it the next day. So
 * moving the End wheel to 21:30 on a 21:00 → 06:04 (next day) block gives 30m, never 24h 30m. An End
 * date chosen on the date sheet wins; the sheet's 24 h limit still applies on Save.
 *
 * The day comes from wall-clock order, and an End already on the right day keeps its exact instant,
 * so the repeated hour when the clocks go back (01:30 then 01:45 GMT after 01:30 BST) stays the
 * occurrence the wheel or VoiceOver chose (Codex r1 on #506).
 */
export function inferEndOnStartDay(startMs: number, endMs: number): number {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const sameLocalDay = (date: Date, dayOffset: number) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayOffset);
    return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate();
  };
  // Already on Start's day and after Start: keep it (whichever repeated-hour occurrence it is).
  if (sameLocalDay(end, 0) && endMs > startMs) return endMs;
  const wall = (date: Date) => ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
  const dayOffset = wall(end) > wall(start) ? 0 : 1;
  if (sameLocalDay(end, dayOffset) && endMs > startMs) return endMs;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + dayOffset,
    end.getHours(),
    end.getMinutes(),
    end.getSeconds(),
    end.getMilliseconds()
  ).getTime();
}

/** A Start moved to or past End carries End with it, keeping the duration; otherwise null. */
export function endFollowingStart(previousStartMs: number, previousEndMs: number, nextStartMs: number): number | null {
  if (nextStartMs < previousEndMs) return null;
  return nextStartMs + Math.max(0, previousEndMs - previousStartMs);
}

/**
 * Where End goes when Start moves (owner, 21 Oct 2026): past End, End follows and the duration stays;
 * otherwise, unless the End date was chosen, End re-reads its day against the new Start, so a Start
 * wheeled earlier never leaves a block over 24 h (Codex r1 on #506).
 */
export function endAfterStartMove({
  endDateChosen,
  nextStartMs,
  previousEndMs,
  previousStartMs
}: {
  endDateChosen: boolean;
  nextStartMs: number;
  previousEndMs: number;
  previousStartMs: number;
}): number {
  const followed = endFollowingStart(previousStartMs, previousEndMs, nextStartMs);
  if (followed !== null) return followed;
  return endDateChosen ? previousEndMs : inferEndOnStartDay(nextStartMs, previousEndMs);
}
