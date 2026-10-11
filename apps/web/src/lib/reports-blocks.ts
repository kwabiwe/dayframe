import type { ReportDayActivities, ReportResult } from "@/lib/report-service";

// Web Reports top (Blocks parity step 15a): the hero tiles and the week/month blocks, from the
// report's daily series. Mirrors apps/mobile/src/lib/reportsBlocks.ts (goal cells within 15% of the
// daily goal; stacks scaled to 12 hours unless a busier day needs more).

export const REPORT_STACK_MIN_SCALE_SECONDS = 12 * 3600;
const GOAL_MET_SHARE = 0.85;

/** The report's days that have started by the time the report was read (today included). */
export function elapsedDays<T extends { start: string }>(days: readonly T[], capturedNow: string) {
  const now = Date.parse(capturedNow);
  return days.filter((day) => Date.parse(day.start) <= now);
}

export type ReportHero = {
  framedSeconds: number;
  deltaSeconds: number | null;
  dailyAverageSeconds: number;
  elapsedDayCount: number;
  best: { label: string; seconds: number } | null;
  /** One cell per elapsed day: met, or not (empty when there is no daily goal). */
  goalDays: boolean[];
};

export function reportHero(report: ReportResult, dailyGoalMinutes: number | null | undefined): ReportHero {
  const framedSeconds = report.timeCoveredSeconds;
  const elapsed = elapsedDays(
    report.dailySeries.map((point, index) => ({ ...point, start: report.dailyByActivity[index]?.start ?? "" })),
    report.capturedNow
  );
  const best = elapsed.reduce<{ label: string; seconds: number } | null>(
    (top, day) => (day.coveredSeconds > (top?.seconds ?? 0) ? { label: day.label, seconds: day.coveredSeconds } : top),
    null
  );
  const goalSeconds = dailyGoalMinutes && dailyGoalMinutes > 0 ? dailyGoalMinutes * 60 : null;
  return {
    framedSeconds,
    deltaSeconds: report.range.preset === "custom" ? null : framedSeconds - report.previousPeriodCoveredSeconds,
    dailyAverageSeconds: elapsed.length ? Math.round(framedSeconds / elapsed.length) : 0,
    elapsedDayCount: elapsed.length,
    best,
    goalDays: goalSeconds ? elapsed.map((day) => day.coveredSeconds >= goalSeconds * GOAL_MET_SHARE) : []
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
