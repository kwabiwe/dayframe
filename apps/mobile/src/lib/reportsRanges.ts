import type { BootstrapEntryCoverage } from "./api";

export type ReportWindow = { start: Date; end: Date };
export type ReportDataQuality = "complete" | "partial" | "unknown";

export type ReportsRanges = {
  today: ReportWindow;
  week: ReportWindow;
  weekDays: Array<ReportWindow & { key: string; label: string }>;
};

export function buildReportsRanges(nowMs: number): ReportsRanges {
  const now = new Date(nowMs);
  const todayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  return {
    today: { start: todayStart, end: addLocalDays(todayStart, 1) },
    week: { start: weekStart, end: addLocalDays(weekStart, 7) },
    weekDays: Array.from({ length: 7 }, (_, index) => {
      const start = addLocalDays(weekStart, index);
      return {
        start,
        end: addLocalDays(start, 1),
        key: formatLocalDateKey(start),
        label: start.toLocaleDateString(undefined, { weekday: "short" })
      };
    })
  };
}

export function reportWindowQuality(
  coverage: BootstrapEntryCoverage | undefined,
  required: ReportWindow
): ReportDataQuality {
  if (!coverage) return "unknown";
  const windows = [coverage.dayEntries, coverage.weekEntries, coverage.historyEntries]
    .filter((window): window is NonNullable<typeof window> => Boolean(window) && typeof window === "object")
    .filter((window) => window.hasMore === false)
    .map((window) => ({ start: Date.parse(window.from), end: Date.parse(window.toExclusive) }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const requiredStart = required.start.getTime();
  const requiredEnd = required.end.getTime();
  let cursor = requiredStart;
  for (const window of windows) {
    if (window.end <= cursor || window.start > cursor) continue;
    cursor = Math.max(cursor, window.end);
    if (cursor >= requiredEnd) return "complete";
  }
  return "partial";
}

export function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfLocalWeek(date: Date) {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + (result.getDay() === 0 ? -6 : 1 - result.getDay()));
  return result;
}

export function addLocalDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatLocalDateKey(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
