import type { MobileTimeEntry } from "./api";

export type HistoryDayEntry = {
  entry: MobileTimeEntry;
  overlapSeconds: number;
};

export type HistoryDaySection = {
  date: Date;
  entries: HistoryDayEntry[];
  isToday: boolean;
  key: string;
  totalSeconds: number;
};

export type HistoryEntryGroup = {
  entries: HistoryDayEntry[];
  key: string;
  representative: HistoryDayEntry;
  totalSeconds: number;
};

export function buildHistoryDaySections({
  days = 60,
  entries,
  nowMs
}: {
  days?: number;
  entries: MobileTimeEntry[];
  nowMs: number;
}): HistoryDaySection[] {
  const safeDayCount = Math.max(1, Math.floor(days));
  const today = startOfLocalDay(new Date(nowMs));
  const tomorrow = addLocalDays(today, 1);
  const rangeStart = addLocalDays(today, -(safeDayCount - 1));
  const sections = new Map<string, HistoryDaySection>();
  const uniqueEntries = new Map(entries.map((entry) => [entry.id, entry]));

  for (const entry of uniqueEntries.values()) {
    const startedAtMs = Date.parse(entry.startedAt);
    const stoppedAtMs = entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs;
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(stoppedAtMs) || stoppedAtMs <= startedAtMs) continue;
    if (stoppedAtMs <= rangeStart.getTime() || startedAtMs >= tomorrow.getTime()) continue;

    let day = startOfLocalDay(new Date(Math.max(startedAtMs, rangeStart.getTime())));
    while (day.getTime() < tomorrow.getTime() && day.getTime() < stoppedAtMs) {
      const dayEnd = addLocalDays(day, 1);
      const overlapSeconds = Math.max(
        0,
        Math.floor((Math.min(stoppedAtMs, dayEnd.getTime(), nowMs) - Math.max(startedAtMs, day.getTime())) / 1000)
      );
      if (overlapSeconds > 0) {
        const key = formatLocalDayKey(day);
        const section = sections.get(key) ?? {
          date: new Date(day),
          entries: [],
          isToday: key === formatLocalDayKey(today),
          key,
          totalSeconds: 0
        };
        section.entries.push({ entry, overlapSeconds });
        section.totalSeconds += overlapSeconds;
        sections.set(key, section);
      }
      day = dayEnd;
    }
  }

  const todayKey = formatLocalDayKey(today);
  if (!sections.has(todayKey)) {
    sections.set(todayKey, {
      date: today,
      entries: [],
      isToday: true,
      key: todayKey,
      totalSeconds: 0
    });
  }

  return [...sections.values()]
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .map((section) => ({
      ...section,
      entries: section.entries.sort(
        (left, right) => Date.parse(right.entry.startedAt) - Date.parse(left.entry.startedAt)
      )
    }));
}

export function historyDayLabel(section: Pick<HistoryDaySection, "date" | "isToday">, nowMs: number) {
  if (section.isToday) return "Today";
  const yesterday = addLocalDays(startOfLocalDay(new Date(nowMs)), -1);
  if (formatLocalDayKey(section.date) === formatLocalDayKey(yesterday)) return "Yesterday";
  return section.date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short"
  });
}

export function groupHistoryDayEntries(entries: HistoryDayEntry[]): HistoryEntryGroup[] {
  const groups = new Map<string, HistoryEntryGroup>();

  for (const historyEntry of entries) {
    const key = historyEntryGroupKey(historyEntry.entry);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(historyEntry);
      existing.totalSeconds += historyEntry.overlapSeconds;
      continue;
    }
    groups.set(key, {
      entries: [historyEntry],
      key,
      representative: historyEntry,
      totalSeconds: historyEntry.overlapSeconds
    });
  }

  return [...groups.values()];
}

function historyEntryGroupKey(entry: MobileTimeEntry) {
  const categoryNameKey = normalizeGroupText(entry.categoryName);
  const descriptionKey = normalizeGroupText(entry.description);

  // A blank uncategorized entry has no useful aggregate identity. Keep it as
  // an individual row so its edit and delete actions remain directly available.
  if (!entry.categoryId && !categoryNameKey && !descriptionKey) {
    return `entry:${entry.id}`;
  }

  const categoryKey = entry.categoryId
    ? `id:${entry.categoryId}`
    : `name:${categoryNameKey || "uncategorized"}`;
  return `${categoryKey}|description:${descriptionKey || "no-description"}`;
}

function normalizeGroupText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
}

function startOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addLocalDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatLocalDayKey(date: Date) {
  return [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}
