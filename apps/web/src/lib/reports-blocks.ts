import type { ReportDayActivities, ReportResult } from "@/lib/report-service";

// Web Reports top (Blocks parity step 15a): the hero tiles and the week/month blocks, from the
// report's daily series. Mirrors apps/mobile/src/lib/reportsBlocks.ts (goal cells within 15% of the
// daily goal, from time in activities that count toward it; stacks scaled to 12 hours unless a
// busier day needs more).

export const REPORT_STACK_MIN_SCALE_SECONDS = 12 * 3600;
const GOAL_MET_SHARE = 0.85;

/** The report's days that have started by the time the report was read (today included). */
export function elapsedDays<T extends { start: string }>(days: readonly T[], capturedNow: string) {
  const now = Date.parse(capturedNow);
  return days.filter((day) => Date.parse(day.start) <= now);
}

export type ReportHero = {
  /** Time logged in the range, overlaps included (the page's only total, UIA-305). */
  totalSeconds: number;
  deltaSeconds: number | null;
  dailyAverageSeconds: number;
  elapsedDayCount: number;
  best: { label: string; seconds: number } | null;
  /**
   * One cell per elapsed day: met, or not (empty when there is no daily goal). Met uses the day's
   * goal time (`goalSeconds`): activities switched off "Counts toward goal" (Sleep by default)
   * never fill it.
   */
  goalDays: boolean[];
};

export function reportHero(report: ReportResult, dailyGoalMinutes: number | null | undefined): ReportHero {
  // UIA-305 (owner decision): web Reports has one total — time logged, overlaps included, so a
  // day may exceed 24h. Every total, average, best day and comparison uses that same rule.
  const totalSeconds = report.totalLoggedSeconds;
  const elapsed = elapsedDays(
    report.dailySeries.map((point, index) => ({ ...point, start: report.dailyByActivity[index]?.start ?? "" })),
    report.capturedNow
  );
  const best = elapsed.reduce<{ label: string; seconds: number } | null>(
    (top, day) => (day.seconds > (top?.seconds ?? 0) ? { label: day.label, seconds: day.seconds } : top),
    null
  );
  const goalSeconds = dailyGoalMinutes && dailyGoalMinutes > 0 ? dailyGoalMinutes * 60 : null;
  return {
    totalSeconds,
    deltaSeconds: report.range.preset === "custom" ? null : totalSeconds - report.previousPeriodSeconds,
    dailyAverageSeconds: elapsed.length ? Math.round(totalSeconds / elapsed.length) : 0,
    elapsedDayCount: elapsed.length,
    best,
    goalDays: goalSeconds
      ? elapsed.map((day) => (day.goalSeconds ?? day.coveredSeconds) >= goalSeconds * GOAL_MET_SHARE)
      : []
  };
}

/** How the blocks card draws this range: a week of columns, a month grid, or nothing. */
export function reportBlocksLayout(report: ReportResult): "week" | "month" | null {
  const preset = report.range.preset;
  if (preset === "this-month" || preset === "last-month") return "month";
  if (report.dailyByActivity.length >= 1 && report.dailyByActivity.length <= 14) return "week";
  return null;
}

/**
 * Block heights in one day's stack, in display order. The stack holds 12 hours unless the busiest
 * day in view holds more, so a long day rescales instead of overflowing. When not every block fits
 * at the minimum height, the day's smallest blocks are left out (height 0).
 */
export function reportStackHeights(
  seconds: readonly number[],
  busiestSeconds: number,
  columnHeight: number,
  minimumHeight: number,
  gap = 0
) {
  const scale = Math.max(REPORT_STACK_MIN_SCALE_SECONDS, busiestSeconds);
  const fit = Math.max(0, Math.floor((columnHeight + gap) / (minimumHeight + gap)));
  const kept = new Set(
    seconds
      .map((value, index) => ({ value, index }))
      .sort((left, right) => right.value - left.value || left.index - right.index)
      .slice(0, fit)
      .map((item) => item.index)
  );
  const budget = columnHeight - gap * Math.max(0, kept.size - 1);
  const heights = seconds.map((value, index) => (kept.has(index) ? Math.max(minimumHeight, (value / scale) * columnHeight) : 0));
  const total = heights.reduce((sum, height) => sum + height, 0);
  if (total <= budget || total === 0) return heights;
  // Shrink the blocks above the minimum so the stack fits its budget.
  const minimumTotal = heights.filter((height) => height > 0).length * minimumHeight;
  const flexible = total - minimumTotal;
  const room = Math.max(0, budget - minimumTotal);
  return heights.map((height) => (height === 0 ? 0 : minimumHeight + (flexible > 0 ? ((height - minimumHeight) * room) / flexible : 0)));
}

export function busiestDaySeconds(days: readonly ReportDayActivities[]) {
  return days.reduce((top, day) => Math.max(top, day.activities.reduce((sum, activity) => sum + activity.seconds, 0)), 0);
}

/** Empty cells before the first day in a Monday-first month grid. */
export function monthGridLeadingBlanks(firstDayStart: string) {
  return (new Date(firstDayStart).getDay() + 6) % 7;
}

export function isTodayKey(day: { start: string; end: string }, capturedNow: string) {
  const now = Date.parse(capturedNow);
  return Date.parse(day.start) <= now && now < Date.parse(day.end);
}

/**
 * A block height as CSS that fits any stack height: the share of the stack (after its gaps) that
 * the block takes at the reference height. Gaps stay fixed, so a stack drawn shorter than the
 * reference (phones) still holds every kept block.
 */
export function stackHeightCss(height: number, keptCount: number, referenceHeight: number, gap: number) {
  const gaps = gap * Math.max(0, keptCount - 1);
  const share = height / Math.max(1, referenceHeight - gaps);
  return `calc((100% - ${gaps}px) * ${Number(share.toFixed(5))})`;
}

export type ReportBlocksBlock = { id: string; name: string; color: string | null; seconds: number; height: string };
export type ReportBlocksDay = {
  key: string;
  label: string;
  /** 'Mon 5' (weekday and day number) for narrow columns (UIA-306). */
  shortLabel: string;
  /** The day of the month, worked out where the report's days were (the server). */
  dateNumber: number;
  isToday: boolean;
  /** Time logged that day, overlaps included (may exceed 24h). */
  totalSeconds: number;
  accessibleName: string;
  blocks: ReportBlocksBlock[];
  /** Every activity that day, drawn or too small to draw: the touch day panel lists them all. */
  activities: Omit<ReportBlocksBlock, "height">[];
};
export type ReportBlocksModel = { layout: "week" | "month"; leadingBlanks: number; days: ReportBlocksDay[] };

const WEEK_COLUMN = { height: 230, minimum: 6, gap: 3 };
const MONTH_STACK = { height: 52, minimum: 3, gap: 2 };

/**
 * Everything the blocks card draws, computed with the report so the browser never re-derives a
 * date (its time zone can differ from the report's): labels, day numbers, leading blanks, today,
 * each block's height as a share of its stack and each day's accessible name.
 */
export function reportBlocksModel(
  report: ReportResult,
  formatDuration: (seconds: number) => string
): ReportBlocksModel | null {
  const layout = reportBlocksLayout(report);
  if (!layout) return null;
  const lookup = new Map(report.byCategory.map((row) => [row.id, row]));
  const busiest = busiestDaySeconds(report.dailyByActivity);
  const sizing = layout === "week" ? WEEK_COLUMN : MONTH_STACK;
  const days = report.dailyByActivity.map((day, index) => {
    const logged = report.dailySeries[index]?.seconds ?? 0;
    const heights = reportStackHeights(day.activities.map((activity) => activity.seconds), busiest, sizing.height, sizing.minimum, sizing.gap);
    const kept = heights.filter((height) => height > 0).length;
    const named = day.activities.map((activity) => {
      const row = lookup.get(activity.id);
      return { ...activity, name: row?.name ?? "No activity", color: activity.id === "uncategorized" ? null : row?.color ?? null };
    });
    const parts = named.map((activity) => `${activity.name} ${formatDuration(activity.seconds)}`);
    return {
      key: day.key,
      label: day.label,
      shortLabel: day.label.replace(/,/g, "").split(/\s+/).slice(0, 2).join(" "),
      dateNumber: new Date(day.start).getDate(),
      isToday: isTodayKey(day, report.capturedNow),
      totalSeconds: logged,
      accessibleName: `${day.label}: ${formatDuration(logged)} logged${parts.length ? `, ${parts.join(", ")}` : ""}`,
      activities: named.map(({ id, name, color, seconds }) => ({ id, name, color, seconds })),
      blocks: named.flatMap((activity, activityIndex) =>
        heights[activityIndex]
          ? [{ id: activity.id, name: activity.name, color: activity.color, seconds: activity.seconds, height: stackHeightCss(heights[activityIndex], kept, sizing.height, sizing.gap) }]
          : []
      )
    };
  });
  const first = report.dailyByActivity[0];
  return { layout, leadingBlanks: first ? monthGridLeadingBlanks(first.start) : 0, days };
}

/**
 * The slight gap after each slice (staging feedback I2), the Blocks prototype's approach
 * (`DF.donut`: each slice drawn `gap` shorter than its share, never below 0.01): 2.2 px there at
 * 190 px, which is 1.4 units of the web donut's 120-unit view box. A single slice stays a full ring.
 */
export const DONUT_GAP = 1.4;

/** Each slice's drawn length and start, in circumference units, with the gap after each one. */
export function donutArcs(seconds: readonly number[], totalSeconds: number, circumference: number, gap = DONUT_GAP) {
  const total = Math.max(1, totalSeconds);
  const gapped = seconds.filter((value) => value > 0).length > 1;
  let before = 0;
  return seconds.map((value) => {
    const share = totalSeconds > 0 ? (value / total) * circumference : 0;
    const arc = { dash: gapped && share > 0 ? Math.max(0.01, share - gap) : share, offset: -before };
    before += share;
    return arc;
  });
}
