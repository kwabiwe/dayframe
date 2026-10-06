const leadBeforeNowHours = 1.5;
const leadBeforeFirstEntryHours = 0.5;
const emptyRangeHour = 7;

type ScrollEntry = { startedAt: string; stoppedAt: string | null };

/**
 * The hour the calendar shows at the top when it first opens, in local time.
 * Today in view: shortly before now. Otherwise: just before the earliest entry
 * that starts in view, or the morning when nothing does.
 */
export function calendarInitialScrollHour({
  entries,
  now,
  visibleDays
}: {
  entries: readonly ScrollEntry[];
  now: Date;
  visibleDays: readonly Date[];
}): number {
  if (visibleDays.some((day) => sameLocalDay(day, now))) {
    return Math.max(0, localHour(now) - leadBeforeNowHours);
  }

  const dayKeys = new Set(visibleDays.map(localDayKey));
  const firstStartHour = entries
    .map((entry) => new Date(entry.startedAt))
    .filter((startedAt) => dayKeys.has(localDayKey(startedAt)))
    .reduce<number | null>((earliest, startedAt) => {
      const hour = localHour(startedAt);
      return earliest === null || hour < earliest ? hour : earliest;
    }, null);

  if (firstStartHour === null) return emptyRangeHour;
  return Math.max(0, firstStartHour - leadBeforeFirstEntryHours);
}

function localHour(date: Date) {
  return date.getHours() + date.getMinutes() / 60;
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function sameLocalDay(a: Date, b: Date) {
  return localDayKey(a) === localDayKey(b);
}
