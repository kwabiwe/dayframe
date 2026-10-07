import type { HistoryDaySection } from "./historyPresentation";

/**
 * "Earlier this week" on Today (Blocks prototype): the six days before today, newest first, each
 * with a 24-hour mini ribbon of its entries and the day's logged total. Tapping a day opens it in
 * Calendar, which holds everything older.
 */
export const EARLIER_DAYS = 6;
const DAY_MS = 86_400_000;

export type MiniRibbonSegment = { key: string; color: string | null; left: number; width: number };

export type EarlierDay = {
  dayKey: string;
  date: Date;
  weekday: string;
  dateLabel: string;
  spokenDate: string;
  totalSeconds: number;
  segments: MiniRibbonSegment[];
};

function dayKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "2h05", "2h" or "35m", as the prototype's week rows write totals. */
export function shortDuration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

export function buildEarlierThisWeek(sections: readonly HistoryDaySection[], nowMs: number): EarlierDay[] {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: EARLIER_DAYS }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (index + 1));
    const dayStart = date.getTime();
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    // Local days are 23 or 25 hours across a clock change; the ribbon spans the real day.
    const dayMs = next.getTime() - dayStart || DAY_MS;
    const dayKey = dayKeyOf(date);
    const section = byKey.get(dayKey);
    const segments = (section?.entries ?? [])
      .map(({ entry }) => {
        const start = Math.max(Date.parse(entry.startedAt), dayStart);
        const end = Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, next.getTime());
        return { entry, start, end };
      })
      .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .sort((a, b) => a.start - b.start || a.entry.id.localeCompare(b.entry.id))
      .map(({ entry, start, end }) => ({
        key: entry.id,
        color: entry.categoryColor ?? entry.categoryId ?? null,
        left: (start - dayStart) / dayMs,
        width: (end - start) / dayMs,
      }));
    return {
      dayKey,
      date,
      weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
      dateLabel: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      spokenDate: date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
      totalSeconds: section?.totalSeconds ?? 0,
      segments,
    };
  });
}
