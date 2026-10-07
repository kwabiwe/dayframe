import { describe, expect, it } from "vitest";
import { buildHistoryDaySections } from "./historyPresentation";
import { buildEarlierThisWeek, shortDuration } from "./earlierThisWeek";

const today = new Date(2026, 9, 7);
const nowMs = today.getTime() + 15 * 3_600_000;
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 7 - daysAgo, h, m).toISOString();
const entry = (id: string, start: string, stop: string | null, color = "blue") => ({
  id, startedAt: start, stoppedAt: stop, categoryColor: color, categoryId: `cat-${color}`, categoryName: color, description: null,
}) as never;

function earlier(entries: unknown[]) {
  return buildEarlierThisWeek(buildHistoryDaySections({ days: 7, entries: entries as never, nowMs }), nowMs);
}

describe("earlier this week", () => {
  it("lists the six days before today, newest first, empty days included", () => {
    const days = earlier([]);
    expect(days.map((day) => day.dayKey)).toEqual(["2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(days.every((day) => day.totalSeconds === 0 && day.segments.length === 0)).toBe(true);
  });

  it("places each entry on its day's 24-hour ribbon and totals the day", () => {
    const [yesterday] = earlier([entry("a", at(1, 6), at(1, 12)), entry("b", at(1, 18), at(1, 19), "lime"), entry("today", at(0, 8), at(0, 9))]);
    expect(yesterday.totalSeconds).toBe(7 * 3600);
    expect(yesterday.segments).toEqual([
      { key: "a", color: "blue", left: 0.25, width: 0.25 },
      { key: "b", color: "lime", left: 0.75, width: 1 / 24 },
    ]);
  });

  it("splits an entry across midnight between its days", () => {
    const days = earlier([entry("sleep", at(2, 22), at(1, 6))]);
    expect(days[1].segments).toEqual([{ key: "sleep", color: "blue", left: 22 / 24, width: 2 / 24 }]);
    expect(days[0].segments).toEqual([{ key: "sleep", color: "blue", left: 0, width: 6 / 24 }]);
    expect(days[0].totalSeconds + days[1].totalSeconds).toBe(8 * 3600);
  });

  it("leaves out days older than a week", () => {
    expect(earlier([entry("old", at(8, 9), at(8, 10))]).every((day) => day.segments.length === 0)).toBe(true);
  });

  it("writes totals the prototype's way", () => {
    expect(shortDuration(0)).toBe("0m");
    expect(shortDuration(35 * 60)).toBe("35m");
    expect(shortDuration(2 * 3600)).toBe("2h");
    expect(shortDuration(125 * 60)).toBe("2h05");
  });
});
