import type { TimeEntryRow } from "@/lib/queries";

export type TimelineEntryGroup = {
  entries: TimeEntryRow[];
  key: string;
  representative: TimeEntryRow;
  totalSeconds: number;
};

export type TimelineEntryDayGroup = TimelineEntryGroup & { day: string };

export function groupTimelineEntries(entries: TimeEntryRow[]): TimelineEntryGroup[] {
  const groups = new Map<string, TimelineEntryGroup>();

  for (const entry of entries) {
    const key = timelineEntryGroupKey(entry);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.totalSeconds += entry.durationSeconds;
      continue;
    }
    groups.set(key, {
      entries: [entry],
      key,
      representative: entry,
      totalSeconds: entry.durationSeconds
    });
  }

  return [...groups.values()];
}

/** List owns day partitioning; the grouping key remains category/description/tag-only. */
export function groupTimelineEntriesByDay(
  entries: TimeEntryRow[],
  dayForEntry: (entry: TimeEntryRow) => string
): TimelineEntryDayGroup[] {
  const entriesByDay = new Map<string, TimeEntryRow[]>();
  for (const entry of entries) {
    const day = dayForEntry(entry);
    const dayEntries = entriesByDay.get(day) ?? [];
    dayEntries.push(entry);
    entriesByDay.set(day, dayEntries);
  }

  return [...entriesByDay].flatMap(([day, entriesForDay]) =>
    groupTimelineEntries(entriesForDay).map((group) => ({ ...group, day }))
  );
}

export function timelineEntryGroupKey(entry: TimeEntryRow) {
  if (entry.stoppedAt === null) return `running:${entry.id}`;
  const categoryNameKey = normalizeGroupText(entry.categoryName);
  const descriptionKey = normalizeGroupText(entry.description);
  const categoryKey = entry.categoryId
    ? `id:${entry.categoryId}`
    : `name:${categoryNameKey || "uncategorized"}`;
  const tagKey = [...new Set(entry.tagNames.map(normalizeGroupText).filter(Boolean))]
    .sort()
    .join(",");
  return `${categoryKey}|description:${descriptionKey || "no-description"}|tags:${tagKey || "no-tags"}`;
}

function normalizeGroupText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
}
