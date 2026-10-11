import { describe, expect, it } from "vitest";
import { dailyActivitySeconds, type ReportResult } from "@/lib/report-service";
import { reportBlocksLayout, reportHero, reportStackHeights, stackHeightCss } from "@/lib/reports-blocks";

const day = (date: number) => ({
  key: `2026-10-0${date}`,
  label: `Day ${date}`,
  start: new Date(Date.UTC(2026, 9, date)).toISOString(),
  end: new Date(Date.UTC(2026, 9, date + 1)).toISOString()
});
const at = (date: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, date, hour, minute)).toISOString();

describe("dailyActivitySeconds", () => {
  it("splits each interval by day and activity, counting a running one up to now", () => {
    const days = [day(5), day(6), day(7)];
    const series = dailyActivitySeconds([
      { startedAt: at(5, 22), stoppedAt: at(6, 2), categoryId: "work" },
      { startedAt: at(5, 9), stoppedAt: at(5, 10), categoryId: "work" },
      { startedAt: at(5, 9), stoppedAt: at(5, 9, 30), categoryId: "uncategorized" },
      { startedAt: at(7, 8), stoppedAt: null, categoryId: "gym" }
    ], days, at(7, 9));
    expect(series.map((entry) => entry.activities)).toEqual([
      [{ id: "work", seconds: 3 * 3600 }, { id: "uncategorized", seconds: 1800 }],
      [{ id: "work", seconds: 2 * 3600 }],
      [{ id: "gym", seconds: 3600 }]
    ]);
  });
});

function report(overrides: Partial<ReportResult> = {}): ReportResult {
  const days = [day(5), day(6), day(7)];
  return {
    range: { preset: "this-week" },
    timeCoveredSeconds: 10 * 3600,
    previousPeriodCoveredSeconds: 12 * 3600,
    capturedNow: at(6, 12),
    dailySeries: days.map((entry, index) => ({ key: entry.key, label: entry.label, seconds: 0, coveredSeconds: [6, 4, 0][index] * 3600, additionalOverlappingActivitySeconds: 0 })),
    dailyByActivity: days.map((entry) => ({ ...entry, activities: [] })),
    ...overrides
  } as unknown as ReportResult;
}

describe("reportHero", () => {
  it("averages over the days so far and marks days within 15% of the goal", () => {
    const hero = reportHero(report(), 420);
    expect(hero.elapsedDayCount).toBe(2);
    expect(hero.dailyAverageSeconds).toBe(5 * 3600);
    expect(hero.best).toEqual({ label: "Day 5", seconds: 6 * 3600 });
    // 6h is within 15% of 7h; 4h is not.
    expect(hero.goalDays).toEqual([true, false]);
    expect(hero.deltaSeconds).toBe(-2 * 3600);
  });

  it("has no goal cells without a goal and no change for a custom range", () => {
    const hero = reportHero(report({ range: { preset: "custom" } as ReportResult["range"] }), 0);
    expect(hero.goalDays).toEqual([]);
    expect(hero.deltaSeconds).toBeNull();
  });
});

describe("reportBlocksLayout", () => {
  it("draws a month as a grid, up to 14 days as columns, and longer ranges not at all", () => {
    expect(reportBlocksLayout(report({ range: { preset: "last-month" } as ReportResult["range"] }))).toBe("month");
    expect(reportBlocksLayout(report())).toBe("week");
    const thirty = Array.from({ length: 30 }, (_, index) => ({ key: `${index}`, label: "", start: at(1, 0), end: at(1, 0), activities: [] }));
    expect(reportBlocksLayout(report({ range: { preset: "last-30-days" } as ReportResult["range"], dailyByActivity: thirty }))).toBeNull();
  });
});

describe("reportStackHeights", () => {
  it("scales to 12 hours, or the busiest day when longer, and keeps every block at least the minimum", () => {
    expect(reportStackHeights([6 * 3600, 3 * 3600], 9 * 3600, 240, 6)).toEqual([120, 60]);
    expect(reportStackHeights([24 * 3600], 24 * 3600, 240, 6)).toEqual([240]);
    expect(reportStackHeights([60, 60], 120, 240, 6)).toEqual([6, 6]);
  });

  it("leaves out the smallest blocks when not all fit at the minimum", () => {
    expect(reportStackHeights([3600, 60, 120], 3780, 15, 6, 3)).toEqual([expect.any(Number), 0, expect.any(Number)]);
  });
});

describe("stackHeightCss", () => {
  it("keeps every kept block inside a stack drawn shorter than the reference (phones)", () => {
    // A 9h day plus seven 1h activities, drawn in a 160 px stack instead of 230 px.
    const seconds = [9 * 3600, ...Array.from({ length: 7 }, () => 3600)];
    const heights = reportStackHeights(seconds, 16 * 3600, 230, 6, 3);
    const kept = heights.filter((height) => height > 0).length;
    const resolve = (css: string, stack: number) => {
      const match = /calc\(\(100% - (\d+)px\) \* ([\d.]+)\)/.exec(css)!;
      return (stack - Number(match[1])) * Number(match[2]);
    };
    for (const stack of [230, 160, 37]) {
      const total = heights.filter(Boolean).reduce((sum, height) => sum + resolve(stackHeightCss(height, kept, 230, 3), stack), 0);
      expect(total + 3 * (kept - 1)).toBeLessThanOrEqual(stack + 0.01);
    }
  });
});
