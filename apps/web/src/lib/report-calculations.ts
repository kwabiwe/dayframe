import { groupOtherCategories, type CategoryAllocation } from "@/lib/dashboard-intelligence";
import { REPORT_DAILY_CHART_THRESHOLD } from "@/lib/report-filters";
import type { ReportBreakdownRow, ReportSeriesPoint } from "@/lib/report-service";

export type ReportTrendPoint = ReportSeriesPoint & {
  dayCount: number;
};

export function buildReportCategoryAllocation(
  categories: ReadonlyArray<ReportBreakdownRow>,
  totalSeconds: number,
  visibleLimit = 5
) {
  const allocation = categories.map<CategoryAllocation>((category) => ({
    id: category.id,
    categoryIds: category.id === "uncategorized" ? ["uncategorized"] : [category.id],
    name: category.name,
    color: category.color,
    seconds: category.seconds,
    percentage: percentageOf(category.seconds, totalSeconds),
    isOther: false,
    isUncategorized: category.id === "uncategorized"
  }));

  return {
    totalSeconds,
    categories: allocation,
    visibleCategories: groupOtherCategories(allocation, totalSeconds, visibleLimit)
  };
}

export function buildReportTrendSeries(
  dailySeries: ReadonlyArray<ReportSeriesPoint>,
  dailyThreshold = REPORT_DAILY_CHART_THRESHOLD
): { granularity: "day" | "week"; points: ReportTrendPoint[] } {
  if (dailySeries.length <= dailyThreshold) {
    return {
      granularity: "day",
      points: dailySeries.map((point) => ({ ...point, dayCount: 1 }))
    };
  }

  const points: ReportTrendPoint[] = [];
  for (let index = 0; index < dailySeries.length; index += 7) {
    const group = dailySeries.slice(index, index + 7);
    const first = group[0];
    const last = group[group.length - 1];
    points.push({
      key: `${first.key}/${last.key}`,
      label: formatWeekLabel(first.key, last.key),
      seconds: group.reduce((sum, point) => sum + point.seconds, 0),
      dayCount: group.length
    });
  }
  return { granularity: "week", points };
}

export function buildComparisonCopy(comparison: {
  currentSeconds: number;
  previousSeconds: number;
  absoluteDeltaSeconds: number;
  direction: "same" | "more" | "less";
  percentageChange: number | null;
}, formatDuration: (seconds: number) => string) {
  if (comparison.previousSeconds === 0) {
    return comparison.currentSeconds === 0
      ? { value: "No tracked time", detail: "No time in either period" }
      : { value: "No prior time", detail: "No time in the previous period" };
  }
  if (comparison.direction === "same") {
    return { value: "No change", detail: "Same as the previous period" };
  }
  return {
    value: comparison.percentageChange === null
      ? `${comparison.direction === "more" ? "+" : "−"}${formatDuration(comparison.absoluteDeltaSeconds)}`
      : `${comparison.percentageChange}% ${comparison.direction}`,
    detail: `${formatDuration(comparison.absoluteDeltaSeconds)} ${comparison.direction} than previous period`
  };
}

export function percentageOf(seconds: number, totalSeconds: number) {
  return totalSeconds > 0 ? Math.round((Math.max(0, seconds) / totalSeconds) * 100) : 0;
}

function formatWeekLabel(firstKey: string, lastKey: string) {
  const first = parseDateKey(firstKey);
  const last = parseDateKey(lastKey);
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${first.getDate()}–${short.format(last)}`;
  }
  return `${short.format(first)}–${short.format(last)}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
