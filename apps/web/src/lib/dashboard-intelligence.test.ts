import { describe, expect, it } from "vitest";
import {
  buildCategoryAllocationSummary,
  buildDashboardPeriod,
  buildDashboardReportsUrl,
  calculateCategoryAllocation,
  calculateGoalProgress,
  calculatePreviousPeriodComparison,
  dedupeDashboardEntries,
  entryOverlapSeconds,
  getTopCategory,
  type DashboardEntry
} from "./dashboard-intelligence";

const selectedDate = "2026-07-22";
const day = buildDashboardPeriod(selectedDate, "day");
const week = buildDashboardPeriod(selectedDate, "week");
const now = localDate(2026, 7, 22, 18);

describe("dashboard category allocation", () => {
  it("returns useful empty day and week results", () => {
    expect(calculateCategoryAllocation([], day, { now })).toEqual({
      totalSeconds: 0,
      categories: [],
      visibleCategories: []
    });
    expect(calculateCategoryAllocation([], week, { now }).totalSeconds).toBe(0);
  });

  it("represents Uncategorized-only data explicitly", () => {
    const result = calculateCategoryAllocation([
      entry("uncategorized", null, null, 9, 10)
    ], day, { now });

    expect(result.categories).toEqual([
      expect.objectContaining({
        id: "uncategorized",
        name: "Uncategorized",
        isUncategorized: true,
        seconds: 3600,
        percentage: 100
      })
    ]);
  });

  it("handles one category as a single 100% slice", () => {
    const result = calculateCategoryAllocation([entry("work", "work", "Work", 9, 11)], day, { now });
    expect(result.visibleCategories).toEqual([
      expect.objectContaining({ name: "Work", seconds: 7200, percentage: 100 })
    ]);
  });

  it("limits visible categories to the top five and groups the rest as Other", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry(`category-${index}`, `category-${index}`, `Category ${index}`, 8 + index, 9 + index)
    );
    const result = calculateCategoryAllocation(entries, day, { now: localDate(2026, 7, 22, 23) });

    expect(result.categories).toHaveLength(7);
    expect(result.visibleCategories).toHaveLength(6);
    expect(result.visibleCategories[5]).toEqual(expect.objectContaining({
      name: "Other",
      isOther: true,
      seconds: 7200,
      categoryIds: ["category-5", "category-6"]
    }));
  });

  it("uses alphabetical order to break top-category ties", () => {
    const result = calculateCategoryAllocation([
      entry("work", "work", "Work", 9, 10),
      entry("admin", "admin", "Admin", 10, 11)
    ], day, { now });

    expect(getTopCategory(result)?.name).toBe("Admin");
  });

  it("deduplicates an active entry repeated across BootstrapData collections", () => {
    const running = entry("running", "work", "Work", 16, null);
    expect(dedupeDashboardEntries([running], [running], [running])).toHaveLength(1);
  });

  it("includes a running timer up to now", () => {
    const result = calculateCategoryAllocation([
      entry("running", "work", "Work", 16, null)
    ], day, { now: localDate(2026, 7, 22, 17, 30) });
    expect(result.totalSeconds).toBe(5400);
  });

  it("clips entries crossing midnight to the selected range", () => {
    const crossMidnight: DashboardEntry = {
      ...entry("overnight", "sleep", "Sleep", 0, 1),
      startedAt: localDate(2026, 7, 21, 23, 30).toISOString(),
      stoppedAt: localDate(2026, 7, 22, 1, 30).toISOString()
    };
    expect(entryOverlapSeconds(crossMidnight, day, now)).toBe(5400);
  });

  it("builds an accessible exact-value summary", () => {
    const result = calculateCategoryAllocation([
      entry("work", "work", "Work", 9, 10),
      entry("admin", "admin", "Admin", 10, 10.5)
    ], day, { now });
    expect(buildCategoryAllocationSummary(result, shortDuration)).toBe(
      "Category allocation totals 1h 30m. Work 1h, 67%; Admin 30m, 33%."
    );
  });

  it("creates future-compatible report links that preserve date and category intent", () => {
    const workCategoryId = "20000000-0000-4000-8000-000000000001";
    const allocation = calculateCategoryAllocation([entry("work", workCategoryId, "Work", 9, 10)], day, { now });
    expect(buildDashboardReportsUrl("day", day, allocation.categories[0])).toBe(
      `/reports?range=custom&from=2026-07-22&to=2026-07-22&categories=${workCategoryId}`
    );

    const uncategorized = calculateCategoryAllocation([
      entry("uncategorized", null, null, 10, 11)
    ], day, { now });
    expect(buildDashboardReportsUrl("day", day, uncategorized.categories[0])).toContain(
      "categories=uncategorized"
    );

    const grouped = calculateCategoryAllocation(
      Array.from({ length: 7 }, (_, index) =>
        entry(`category-${index}`, `category-${index}`, `Category ${index}`, 8 + index, 9 + index)
      ),
      day,
      { now: localDate(2026, 7, 22, 23) }
    );
    expect(buildDashboardReportsUrl("day", day, grouped.visibleCategories[5])).toContain(
      "categories=category-5%2Ccategory-6"
    );
  });
});

describe("dashboard goals and previous periods", () => {
  it("handles zero daily and weekly goals", () => {
    expect(calculateGoalProgress(3600, 0)).toEqual({
      goalSeconds: 0,
      percentage: null,
      clampedPercentage: 0,
      isExceeded: false
    });
    expect(calculateGoalProgress(3600, undefined).percentage).toBeNull();
  });

  it("keeps exceeded goals readable while clamping only the visual bar", () => {
    expect(calculateGoalProgress(10 * 3600, 8 * 60)).toEqual({
      goalSeconds: 8 * 3600,
      percentage: 125,
      clampedPercentage: 100,
      isExceeded: true
    });
  });

  it("handles a zero previous period without Infinity or NaN", () => {
    const comparison = calculatePreviousPeriodComparison(3600, 0);
    expect(comparison.direction).toBe("more");
    expect(comparison.percentageChange).toBeNull();
  });

  it("handles a zero selected period", () => {
    expect(calculatePreviousPeriodComparison(0, 3600)).toEqual(expect.objectContaining({
      direction: "less",
      absoluteDeltaSeconds: 3600,
      percentageChange: 100
    }));
  });

  it("compares more, less, and equal periods factually", () => {
    expect(calculatePreviousPeriodComparison(5400, 3600)).toEqual(expect.objectContaining({
      direction: "more",
      absoluteDeltaSeconds: 1800,
      percentageChange: 50
    }));
    expect(calculatePreviousPeriodComparison(2700, 3600)).toEqual(expect.objectContaining({
      direction: "less",
      absoluteDeltaSeconds: 900,
      percentageChange: 25
    }));
    expect(calculatePreviousPeriodComparison(3600, 3600).direction).toBe("same");
  });

  it("resolves Day and Week ranges around the selected date", () => {
    expect(day.start).toEqual(localDate(2026, 7, 22));
    expect(day.previousStart).toEqual(localDate(2026, 7, 21));
    expect(week.start).toEqual(localDate(2026, 7, 20));
    expect(week.previousStart).toEqual(localDate(2026, 7, 13));
  });
});

function entry(
  id: string,
  categoryId: string | null,
  categoryName: string | null,
  startHour: number,
  endHour: number | null
): DashboardEntry {
  return {
    id,
    categoryId,
    categoryName,
    categoryColor: categoryId ? "blue" : null,
    startedAt: localDate(2026, 7, 22, startHour).toISOString(),
    stoppedAt: endHour === null ? null : localDate(2026, 7, 22, endHour).toISOString()
  };
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  const wholeHour = Math.floor(hour);
  return new Date(year, month - 1, day, wholeHour, minute + Math.round((hour - wholeHour) * 60));
}

function shortDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ") || "0m";
}
