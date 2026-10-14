import { formatLocaleDate } from "./localeDateFormat";
import { coveredDurationMs, formatDuration } from "@dayframe/shared";
import type { HistoryDaySection } from "./historyPresentation";
import { reviewItemMoment, reviewMomentOverlapsDay } from "./reviewDeckSegments";

/**
 * "Earlier this week" on Today (Blocks prototype): the six days before today, newest first, each
 * with a 24-hour mini ribbon of its entries and the day's covered total (PRD D14, 14 Oct 2026: time
 * that overlapping blocks share counts once, every activity included, the same basis as Today's
 * hero, so a day reads what its Today hero showed). The rows show no goal progress, so the goal
 * rule doesn't apply. Tapping a day opens it in Calendar, which holds everything older. Built on
 * the per-minute clock and memoised by the Dashboard, never on the 1 s tick.
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

/** A day's total, written the one Dayframe way ("6h 25m", UIA-042). */
export function shortDuration(seconds: number) {
  return formatDuration(seconds);
}

/**
 * `entries` are the same logged entries Today's hero reads. Each day's total is their covered time
 * clipped to that day, not the history section's list: sections drop clips shorter than a whole
 * second, which once let a day of a 59.9 s and a 0.5 s block read "<1m" here while its hero read
 * "1m" (Codex Nice-to-have on #410).
 */
export function buildEarlierThisWeek(
  sections: readonly HistoryDaySection[],
  nowMs: number,
  entries: readonly { startedAt: string; stoppedAt: string | null }[]
): EarlierDay[] {
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
      weekday: formatLocaleDate(date, { weekday: "short" }),
      dateLabel: formatLocaleDate(date, { day: "numeric", month: "short" }),
      spokenDate: formatLocaleDate(date, { weekday: "long", day: "numeric", month: "long" }),
      totalSeconds: Math.floor(coveredDurationMs(entries, dayStart, next.getTime(), nowMs) / 1000),
      segments,
    };
  });
}

/**
 * Quick win (b, 14 Oct 2026): how many open Review moments each earlier day has, for the hatched
 * count chip on its row. A moment counts on every day it overlaps (as the Calendar draws it), so
 * overnight sleep counts on both nights' days. Days are local and DST-exact.
 */
export function earlierDayReviewCounts(
  days: readonly Pick<EarlierDay, "dayKey" | "date">[],
  reviewItems: readonly {
    suggestedStartedAt: string | null;
    suggestedStoppedAt: string | null;
    createdAt?: string | null;
  }[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (!reviewItems.length) return counts;
  for (const day of days) {
    const start = new Date(day.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const bounds = { startMs: start.getTime(), endMs: end.getTime() };
    let count = 0;
    for (const item of reviewItems) if (reviewMomentOverlapsDay(reviewItemMoment(item), bounds)) count += 1;
    if (count) counts.set(day.dayKey, count);
  }
  return counts;
}
