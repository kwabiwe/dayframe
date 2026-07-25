import type { TimeEntryRow } from "@/lib/queries";

export type TimelineEntryGroup = {
  entries: TimeEntryRow[];
  key: string;
  representative: TimeEntryRow;
  totalSeconds: number;
};

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

export function timelineEntryGroupKey(entry: TimeEntryRow) {
  const categoryNameKey = normalizeGroupText(entry.categoryName);
  const descriptionKey = normalizeGroupText(entry.description);
  if (!entry.categoryId && !categoryNameKey && !descriptionKey) return `entry:${entry.id}`;

  const categoryKey = entry.categoryId
    ? `id:${entry.categoryId}`
    : `name:${categoryNameKey || "uncategorized"}`;
  return `${categoryKey}|description:${descriptionKey || "no-description"}`;
}

function normalizeGroupText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
}
