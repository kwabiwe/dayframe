import { describe, expect, it } from "vitest";
import {
  buildComparisonCopy,
  buildReportCategoryAllocation,
  buildReportTrendSeries,
  percentageOf
} from "./report-calculations";

describe("report calculations", () => {
  it("keeps category totals as a partition and groups only the long tail as Other", () => {
    const categories = Array.from({ length: 7 }, (_, index) => ({
      id: index === 6 ? "uncategorized" : `20000000-0000-4000-8000-${`${index + 1}`.padStart(12, "0")}`,
      name: index === 6 ? "Uncategorized" : `Category ${index + 1}`,
      color: index === 6 ? null : "blue",
      seconds: (7 - index) * 600,
      entryCount: 1
    }));
    const total = categories.reduce((sum, row) => sum + row.seconds, 0);
    const allocation = buildReportCategoryAllocation(categories, total, 5);

    expect(allocation.categories.reduce((sum, row) => sum + row.seconds, 0)).toBe(total);
    expect(allocation.visibleCategories).toHaveLength(6);
    expect(allocation.visibleCategories[5]).toEqual(expect.objectContaining({
      name: "Other",
      seconds: categories[5].seconds + categories[6].seconds,
      categoryIds: [categories[5].id, "uncategorized"]
    }));
    expect(allocation.categories.at(-1)).toEqual(expect.objectContaining({ isUncategorized: true }));
  });

  it("preserves zero-filled daily points and aggregates long ranges into seven-day bars", () => {
    const daily = Array.from({ length: 63 }, (_, index) => ({
      key: `2026-01-${`${index + 1}`.padStart(2, "0")}`,
      label: `Day ${index + 1}`,
      seconds: index === 1 ? 3_600 : 0
    }));
    expect(buildReportTrendSeries(daily.slice(0, 7))).toEqual(expect.objectContaining({
      granularity: "day",
      points: expect.arrayContaining([expect.objectContaining({ seconds: 0 })])
    }));
    const aggregated = buildReportTrendSeries(daily);
    expect(aggregated.granularity).toBe("week");
    expect(aggregated.points).toHaveLength(9);
    expect(aggregated.points.reduce((sum, point) => sum + point.seconds, 0)).toBe(3_600);
  });

  it("produces factual, finite comparison copy for zero and non-zero periods", () => {
    const format = (seconds: number) => `${seconds}s`;
    expect(buildComparisonCopy(comparison(7_800, 0), format)).toEqual({
      value: "No prior time",
      detail: "No time in the previous period"
    });
    expect(buildComparisonCopy(comparison(7_800, 3_600), format)).toEqual({
      value: "117% more",
      detail: "4200s more than previous period"
    });
    expect(buildComparisonCopy(comparison(0, 0), format).value).not.toMatch(/Infinity|NaN/);
  });

  it("allows overlapping tag shares without forcing a partition", () => {
    expect(percentageOf(3_600, 4_000)).toBe(90);
    expect(percentageOf(3_000, 4_000)).toBe(75);
    expect(percentageOf(1, 0)).toBe(0);
  });
});

function comparison(currentSeconds: number, previousSeconds: number) {
  const delta = currentSeconds - previousSeconds;
  return {
    currentSeconds,
    previousSeconds,
    absoluteDeltaSeconds: Math.abs(delta),
    direction: delta === 0 ? "same" as const : delta > 0 ? "more" as const : "less" as const,
    percentageChange: previousSeconds > 0 ? Math.round((Math.abs(delta) / previousSeconds) * 100) : null
  };
}
