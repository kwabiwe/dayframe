import { addCalendarDays } from "@/lib/calendar-grid";
import { REPORT_MAX_RANGE_DAYS } from "@/lib/report-filters";

/**
 * The Reports custom range while it is being picked (date-picker audit, 14 Oct 2026, as on
 * iPhone): the first tap sets the first day, the second the last (a day before the first swaps
 * them; the same day again makes a one-day range), and a third tap starts a new range.
 */
export type ReportRangeDraft = { start: string; end: string | null };

/**
 * The draft the dialog opens with: the range showing, up to today (a preset such as This week
 * runs past today, and Done must never commit a day after it). A range wholly after today starts
 * a new one from today.
 */
export function initialReportRangeDraft(from: string, to: string, today: string): ReportRangeDraft {
  if (from > today) return { start: today, end: null };
  return { start: from, end: to > today ? today : to };
}

/** Done is offered only for a whole range within the limits: both days, none after today, at most 366. */
export function reportRangeDraftComplete(draft: ReportRangeDraft, today: string): draft is { start: string; end: string } {
  if (draft.end === null || draft.end > today || draft.start > draft.end) return false;
  return (reportRangeDraftDayCount(draft) ?? Infinity) <= REPORT_MAX_RANGE_DAYS;
}

export function nextReportRangeDraft(draft: ReportRangeDraft, date: string): ReportRangeDraft {
  if (draft.end !== null) return { start: date, end: null };
  return date < draft.start ? { start: date, end: draft.start } : { start: draft.start, end: date };
}

/**
 * The choosable days: never after today, and while the last day is awaited, no further than 366
 * calendar days (inclusive) from the first, either way, so Done is never offered a range the
 * report would clamp.
 */
export function reportRangeDraftBounds(draft: ReportRangeDraft, today: string): { min: string | null; max: string } {
  if (draft.end !== null) return { min: null, max: today };
  const reach = REPORT_MAX_RANGE_DAYS - 1;
  const forward = addCalendarDays(draft.start, reach);
  return { min: addCalendarDays(draft.start, -reach), max: forward < today ? forward : today };
}

export function reportRangeDraftDayCount(draft: ReportRangeDraft) {
  if (draft.end === null) return null;
  const [a, b] = [draft.start, draft.end].map((date) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  });
  return Math.round((b - a) / 86_400_000) + 1;
}

/** "3 – 9 Oct 2026 · 7 days", "Fri 9 Oct 2026 · 1 day", or "From Sat 3 Oct · tap the last day". */
export function reportRangeDraftCaption(draft: ReportRangeDraft) {
  const at = (date: string) => new Date(`${date}T12:00:00`);
  const format = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", options).format(at(date));
  if (draft.end === null) return `From ${format(draft.start, { weekday: "short", day: "numeric", month: "short" })} · tap the last day`;
  const days = reportRangeDraftDayCount(draft)!;
  const count = `${days} day${days === 1 ? "" : "s"}`;
  if (draft.start === draft.end) return `${format(draft.start, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "")} · ${count}`;
  const sameYear = draft.start.slice(0, 4) === draft.end.slice(0, 4);
  const sameMonth = sameYear && draft.start.slice(0, 7) === draft.end.slice(0, 7);
  const first = sameMonth ? format(draft.start, { day: "numeric" })
    : format(draft.start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return `${first} – ${format(draft.end, { day: "numeric", month: "short", year: "numeric" })} · ${count}`;
}
