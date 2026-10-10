import type { ReportSummaryRequest } from "@dayframe/shared";
import { compactDuration, spokenDuration } from "../components/today/todayBlocksLayout";
import {
  addLocalDays,
  startOfLocalDay,
  type ReportRange,
  type ReportRangeChoice,
} from "./reportsRanges";

// Pure helpers for the Blocks Reports screen (design/blocks/ios.html, renderReports).

export type ReportComparison = "yesterday" | "week" | "month" | "year";

/** The delta compares like with like at five-minute grain, so its request key changes rarely. */
const PREVIOUS_GRAIN_MS = 5 * 60_000;

/**
 * The same stretch of the previous period ("vs last week so far"): from the previous period's
 * start, as long as this period has run, never past where this period begins. Custom ranges have
 * no natural previous period and get no delta.
 */
export function previousReportWindow(
  choice: ReportRangeChoice,
  range: ReportRange,
  nowMs: number,
): { start: Date; end: Date; comparison: ReportComparison; request: ReportSummaryRequest } | null {
  if (typeof choice !== "string") return null;
  const elapsed =
    Math.floor((Math.min(nowMs, +range.end) - +range.start) / PREVIOUS_GRAIN_MS) * PREVIOUS_GRAIN_MS;
  if (elapsed <= 0) return null;
  const from = range.start;
  const start =
    choice === "today"
      ? addLocalDays(from, -1)
      : choice === "week"
        ? addLocalDays(from, -7)
        : choice === "month"
          ? new Date(from.getFullYear(), from.getMonth() - 1, 1)
          : new Date(from.getFullYear() - 1, 0, 1);
  const end = new Date(Math.min(+start + elapsed, +from));
  const comparison: ReportComparison = choice === "today" ? "yesterday" : choice;
  return {
    start,
    end,
    comparison,
    request: {
      start: start.toISOString(),
      end: end.toISOString(),
      buckets: [{ key: "previous", start: start.toISOString(), end: end.toISOString() }],
    },
  };
}

function comparisonWords(comparison: ReportComparison) {
  return comparison === "yesterday" ? "yesterday" : `last ${comparison}`;
}

/** "+2h 10m vs last week so far"; under a minute either way reads "Same as …". */
export function formatReportDelta(deltaSeconds: number, comparison: ReportComparison) {
  const words = comparisonWords(comparison);
  if (Math.abs(deltaSeconds) < 60)
    return { text: `Same as ${words} so far`, spoken: `Same as ${words} so far` };
  const more = deltaSeconds > 0;
  const size = Math.abs(deltaSeconds);
  return {
    text: `${more ? "+" : "−"}${compactDuration(size)} vs ${words} so far`,
    spoken: `${spokenDuration(size)} ${more ? "more" : "less"} than ${words} so far`,
  };
}

/** The words after "framed" under the hero total. */
export function reportHeroPeriod(choice: ReportRangeChoice, range: ReportRange) {
  if (choice === "today") return "today";
  if (choice === "week") return "this week";
  if (choice === "month" || choice === "year") return `in ${range.title}`;
  return range.title;
}

/**
 * Goal streak cells for the current week: one per day up to and including today, met when the
 * day's framed time is within 15% of the daily goal. No goal, no cells.
 */
export function weekGoalDays(
  days: readonly { start: Date; seconds: number }[],
  nowMs: number,
  dailyGoalMinutes: number | null | undefined,
) {
  if (!dailyGoalMinutes || dailyGoalMinutes <= 0) return [];
  const today = +startOfLocalDay(new Date(nowMs));
  return days
    .filter((day) => +day.start <= today)
    .map((day) => day.seconds >= dailyGoalMinutes * 60 * 0.85);
}

/** Empty cells before the 1st in a Monday-first month grid. */
export function monthGridLeadingBlanks(firstOfMonth: Date) {
  return (firstOfMonth.getDay() + 6) % 7;
}

export const REPORT_STACK_MIN_SCALE_SECONDS = 12 * 3600;

/**
 * Block heights in one day's stack. The column holds 12 hours (the prototype's scale) unless the
 * busiest day in view holds more, so a long day rescales instead of overflowing.
 */
export function reportStackHeights(
  seconds: readonly number[],
  busiestSeconds: number,
  columnHeight: number,
  minimumHeight: number,
) {
  const scale = Math.max(REPORT_STACK_MIN_SCALE_SECONDS, busiestSeconds);
  return seconds.map((value) => Math.max(minimumHeight, Math.round((value / scale) * columnHeight)));
}
