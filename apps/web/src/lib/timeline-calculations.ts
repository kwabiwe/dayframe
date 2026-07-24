import type { TimeEntryRow } from "@/lib/queries";
import { entryOverlapSeconds, entryOverlapsRange, type DateRange } from "@/lib/time-entry-overlap";

export type TimelineTimesheetRow = {
  id: string;
  categoryName: string | null;
  categoryColor: string | null;
  days: number[];
  total: number;
};

export function mergeTimelineEntries(
  ...collections: ReadonlyArray<ReadonlyArray<TimeEntryRow>>
) {
  const entries = new Map<string, TimeEntryRow>();
  for (const collection of collections) {
    for (const entry of collection) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}

export function clipTimelineEntries(
  entries: ReadonlyArray<TimeEntryRow>,
  range: DateRange,
  capturedNow: Date
) {
  return entries
    .filter((entry) => entryOverlapsRange(entry, range, capturedNow))
    .map((entry) => ({
      ...entry,
      durationSeconds: entryOverlapSeconds(entry, range, capturedNow)
    }))
    .filter((entry) => entry.durationSeconds > 0)
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

export function timelineEntryDisplayInterval(
  entry: Pick<TimeEntryRow, "startedAt" | "stoppedAt">,
  displayRange: DateRange | undefined,
  capturedNow: Date
) {
  if (!displayRange) {
    return {
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    };
  }

  const entryStart = new Date(entry.startedAt);
  const entryEnd = entry.stoppedAt ? new Date(entry.stoppedAt) : capturedNow;
  const displayStart = new Date(Math.max(entryStart.getTime(), displayRange.start.getTime()));
  const displayEnd = new Date(Math.min(entryEnd.getTime(), displayRange.end.getTime()));
  const reachesCapturedNow = !entry.stoppedAt && displayEnd.getTime() >= capturedNow.getTime();

  return {
    startedAt: displayStart.toISOString(),
    stoppedAt: reachesCapturedNow ? null : displayEnd.toISOString()
  };
}

export function buildTimelineTimesheetRows(
  entries: ReadonlyArray<TimeEntryRow>,
  weekDays: ReadonlyArray<Date>,
  capturedNow: Date
) {
  const rows = new Map<string, TimelineTimesheetRow>();

  for (const entry of entries) {
    const key = entry.categoryId ?? `uncategorized:${entry.categoryName ?? "time"}`;
    const row = rows.get(key) ?? {
      id: key,
      categoryName: entry.categoryName,
      categoryColor: entry.categoryColor,
      days: Array(weekDays.length).fill(0) as number[],
      total: 0
    };

    weekDays.forEach((day, index) => {
      const seconds = entryOverlapSeconds(entry, {
        start: day,
        end: addCalendarDays(day, 1)
      }, capturedNow);
      row.days[index] += seconds;
      row.total += seconds;
    });
    rows.set(key, row);
  }

  return [...rows.values()]
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.id.localeCompare(right.id));
}

export function timelineDailyTotals(rows: ReadonlyArray<TimelineTimesheetRow>, dayCount: number) {
  return Array.from({ length: dayCount }, (_, dayIndex) =>
    rows.reduce((sum, row) => sum + (row.days[dayIndex] ?? 0), 0)
  );
}

function addCalendarDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
