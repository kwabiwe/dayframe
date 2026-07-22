import type { TimeEntryRow } from "@/lib/queries";

export type DashboardMode = "day" | "week";

export type DashboardEntry = Pick<
  TimeEntryRow,
  "id" | "categoryId" | "categoryName" | "categoryColor" | "startedAt" | "stoppedAt"
>;

export type DashboardPeriod = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

export type CategoryAllocation = {
  id: string;
  categoryIds: string[];
  name: string;
  color: string | null;
  seconds: number;
  percentage: number;
  isOther: boolean;
  isUncategorized: boolean;
};

export type CategoryAllocationResult = {
  totalSeconds: number;
  categories: CategoryAllocation[];
  visibleCategories: CategoryAllocation[];
};

export const DASHBOARD_VISIBLE_CATEGORY_LIMIT = 5;

export function buildDashboardPeriod(selectedDateKey: string, mode: DashboardMode): DashboardPeriod {
  const selectedDate = parseDateKey(selectedDateKey);
  const start = mode === "week" ? startOfWeek(selectedDate) : selectedDate;
  const end = addDays(start, mode === "week" ? 7 : 1);
  const previousStart = addDays(start, mode === "week" ? -7 : -1);

  return {
    start,
    end,
    previousStart,
    previousEnd: start
  };
}

export function dedupeDashboardEntries(
  ...collections: Array<ReadonlyArray<DashboardEntry | null | undefined>>
) {
  const entries = new Map<string, DashboardEntry>();
  for (const collection of collections) {
    for (const entry of collection) {
      if (entry) entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}

export function entryOverlapSeconds(
  entry: DashboardEntry,
  range: { start: Date; end: Date },
  now: Date = new Date()
) {
  const startedAt = new Date(entry.startedAt).getTime();
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : now.getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt)) return 0;

  const overlapStart = Math.max(startedAt, range.start.getTime());
  const overlapEnd = Math.min(stoppedAt, range.end.getTime());
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 1000));
}

export function calculateCategoryAllocation(
  entries: ReadonlyArray<DashboardEntry>,
  range: { start: Date; end: Date },
  options: { now?: Date; visibleLimit?: number } = {}
): CategoryAllocationResult {
  const now = options.now ?? new Date();
  const grouped = new Map<string, Omit<CategoryAllocation, "percentage" | "isOther">>();

  for (const entry of entries) {
    const seconds = entryOverlapSeconds(entry, range, now);
    if (seconds <= 0) continue;

    const id = entry.categoryId ?? "uncategorized";
    const existing = grouped.get(id);
    if (existing) {
      existing.seconds += seconds;
      continue;
    }

    grouped.set(id, {
      id,
      categoryIds: [id],
      name: entry.categoryName?.trim() || "Uncategorized",
      color: entry.categoryColor,
      seconds,
      isUncategorized: entry.categoryId === null
    });
  }

  const totalSeconds = [...grouped.values()].reduce((sum, category) => sum + category.seconds, 0);
  const categories = [...grouped.values()]
    .sort(compareCategoryAllocation)
    .map<CategoryAllocation>((category) => ({
      ...category,
      percentage: percentageOf(category.seconds, totalSeconds),
      isOther: false
    }));

  return {
    totalSeconds,
    categories,
    visibleCategories: groupOtherCategories(
      categories,
      totalSeconds,
      options.visibleLimit ?? DASHBOARD_VISIBLE_CATEGORY_LIMIT
    )
  };
}

export function groupOtherCategories(
  categories: ReadonlyArray<CategoryAllocation>,
  totalSeconds: number,
  visibleLimit = DASHBOARD_VISIBLE_CATEGORY_LIMIT
) {
  const safeLimit = Math.max(1, Math.floor(visibleLimit));
  if (categories.length <= safeLimit) return [...categories];

  const visible = categories.slice(0, safeLimit);
  const remaining = categories.slice(safeLimit);
  const otherSeconds = remaining.reduce((sum, category) => sum + category.seconds, 0);

  return [
    ...visible,
    {
      id: "other-categories",
      categoryIds: remaining.flatMap((category) => category.categoryIds),
      name: "Other",
      color: "graphite",
      seconds: otherSeconds,
      percentage: percentageOf(otherSeconds, totalSeconds),
      isOther: true,
      isUncategorized: false
    }
  ];
}

export function calculateGoalProgress(totalSeconds: number, goalMinutes: number | null | undefined) {
  const goalSeconds = Number.isFinite(goalMinutes) && (goalMinutes ?? 0) > 0
    ? Math.round((goalMinutes as number) * 60)
    : 0;
  const percentage = goalSeconds > 0 ? Math.round((Math.max(0, totalSeconds) / goalSeconds) * 100) : null;

  return {
    goalSeconds,
    percentage,
    clampedPercentage: percentage === null ? 0 : Math.min(100, Math.max(0, percentage)),
    isExceeded: percentage !== null && percentage > 100
  };
}

export function calculatePreviousPeriodComparison(currentSeconds: number, previousSeconds: number) {
  const current = Math.max(0, currentSeconds);
  const previous = Math.max(0, previousSeconds);
  const deltaSeconds = current - previous;

  return {
    currentSeconds: current,
    previousSeconds: previous,
    deltaSeconds,
    absoluteDeltaSeconds: Math.abs(deltaSeconds),
    direction: deltaSeconds === 0 ? "same" as const : deltaSeconds > 0 ? "more" as const : "less" as const,
    percentageChange: previous > 0 ? Math.round((Math.abs(deltaSeconds) / previous) * 100) : null
  };
}

export function getTopCategory(allocation: CategoryAllocationResult) {
  return allocation.categories[0] ?? null;
}

export function buildDashboardReportsUrl(
  mode: DashboardMode,
  period: DashboardPeriod,
  category: Pick<CategoryAllocation, "categoryIds">
) {
  const params = new URLSearchParams({
    period: mode,
    start: toDateKey(period.start),
    categories: category.categoryIds.join(",")
  });
  return `/reports?${params.toString()}`;
}

export function buildCategoryAllocationSummary(
  allocation: CategoryAllocationResult,
  formatSeconds: (seconds: number) => string
) {
  if (allocation.totalSeconds <= 0) return "No tracked time in this period.";
  const details = allocation.categories
    .map((category) => `${category.name} ${formatSeconds(category.seconds)}, ${category.percentage}%`)
    .join("; ");
  return `Category allocation totals ${formatSeconds(allocation.totalSeconds)}. ${details}.`;
}

function compareCategoryAllocation(
  left: Omit<CategoryAllocation, "percentage" | "isOther">,
  right: Omit<CategoryAllocation, "percentage" | "isOther">
) {
  if (right.seconds !== left.seconds) return right.seconds - left.seconds;
  const nameComparison = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  return nameComparison || left.id.localeCompare(right.id);
}

function percentageOf(seconds: number, totalSeconds: number) {
  return totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0;
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfLocalDay(new Date());
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : startOfLocalDay(new Date());
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
