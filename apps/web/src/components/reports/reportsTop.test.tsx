import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportResult } from "@/lib/report-service";
import { ReportsTop } from "./ReportsTop";

const at = (date: number, hour = 0) => new Date(2026, 9, date, hour).toISOString();
const day = (date: number) => ({ key: `d${date}`, label: `Day ${date}`, start: at(date), end: at(date + 1) });

function report(overrides: Partial<ReportResult> = {}): ReportResult {
  const days = [5, 6, 7, 8, 9, 10, 11].map(day);
  return {
    range: { preset: "this-week" },
    timeCoveredSeconds: 9 * 3600,
    totalLoggedSeconds: 10 * 3600,
    previousPeriodCoveredSeconds: 8 * 3600,
    capturedNow: at(6, 12),
    byCategory: [{ id: "work", name: "Work", color: "blue", seconds: 9 * 3600, entryCount: 3 }],
    dailySeries: days.map((entry, index) => ({ key: entry.key, label: entry.label, seconds: 0, coveredSeconds: index === 0 ? 9 * 3600 : 0, additionalOverlappingActivitySeconds: 0 })),
    dailyByActivity: days.map((entry, index) => ({ ...entry, activities: index === 0 ? [{ id: "work", seconds: 9 * 3600 }, { id: "uncategorized", seconds: 3600 }] : [] })),
    ...overrides
  } as unknown as ReportResult;
}

describe("Reports top", () => {
  it("shows the four tiles with Total logged beside Total framed", () => {
    const html = renderToStaticMarkup(<ReportsTop dailyGoalMinutes={480} report={report()} />);
    expect(html).toContain("Total framed");
    expect(html).toContain("10h 00m logged · overlaps count once above");
    expect(html).toContain("+1h 00m vs the week before");
    expect(html).toContain("across 2 days so far");
    expect(html).toContain("Days on goal");
    expect((html.match(/class="is-met"/g) ?? []).length).toBe(1);
  });

  it("draws a week as one column per day, each named with its activities", () => {
    const html = renderToStaticMarkup(<ReportsTop dailyGoalMinutes={480} report={report()} />);
    expect((html.match(/class="df-wb[ "]/g) ?? []).length).toBe(7);
    expect(html).toContain('aria-label="Day 5: 9h 00m framed, Work 9h 00m, No activity 1h 00m"');
    expect(html).toContain("The days in blocks");
  });

  it("draws a month as a Monday-first grid and says how to see the goal without one", () => {
    const html = renderToStaticMarkup(<ReportsTop dailyGoalMinutes={null} report={report({ range: { preset: "this-month" } as ReportResult["range"] })} />);
    expect(html).toContain("The month in blocks");
    // 5 Oct 2026 is a Monday: no blank cells before it.
    expect(html).not.toContain("df-mday is-empty");
    expect(html).toContain("Set a daily goal in Settings to see it here.");
  });
});
