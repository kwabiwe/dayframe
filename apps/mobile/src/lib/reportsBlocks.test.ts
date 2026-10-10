import { describe, expect, it } from "vitest";
import { buildReportRange } from "./reportsRanges";
import {
  formatReportDelta,
  monthGridLeadingBlanks,
  previousReportWindow,
  reportHeroPeriod,
  reportStackHeights,
  weekGoalDays,
} from "./reportsBlocks";

// Friday 9 October 2026, 14:07 local.
const now = +new Date(2026, 9, 9, 14, 7, 30);

describe("Blocks Reports helpers", () => {
  it("compares this week so far with the same stretch of last week", () => {
    const range = buildReportRange("week", now);
    const previous = previousReportWindow("week", range, now)!;
    expect(previous.comparison).toBe("week");
    expect(previous.start).toEqual(new Date(2026, 8, 28));
    // Elapsed since Monday 5 Oct, floored to five minutes: 4 days 14:05.
    expect(+previous.end - +previous.start).toBe(
      (4 * 24 + 14) * 3_600_000 + 5 * 60_000,
    );
    expect(previous.request).toEqual({
      start: previous.start.toISOString(),
      end: previous.end.toISOString(),
      buckets: [
        {
          key: "previous",
          start: previous.start.toISOString(),
          end: previous.end.toISOString(),
        },
      ],
    });
  });

  it("clamps the previous month to its own length and skips custom ranges", () => {
    const lateMarch = +new Date(2026, 2, 31, 12);
    const range = buildReportRange("month", lateMarch);
    const previous = previousReportWindow("month", range, lateMarch)!;
    expect(previous.start).toEqual(new Date(2026, 1, 1));
    expect(previous.end).toEqual(new Date(2026, 2, 1));
    expect(previous.comparison).toBe("month");
    const custom = buildReportRange({ start: "2026-10-01", end: "2026-10-05" }, now);
    expect(previousReportWindow({ start: "2026-10-01", end: "2026-10-05" }, custom, now)).toBeNull();
  });

  it("has nothing to compare in the first five minutes of a period", () => {
    const monday = +new Date(2026, 9, 5, 0, 3);
    expect(previousReportWindow("week", buildReportRange("week", monday), monday)).toBeNull();
    const today = buildReportRange("today", now);
    expect(previousReportWindow("today", today, now)?.comparison).toBe("yesterday");
    expect(previousReportWindow("year", buildReportRange("year", now), now)?.start).toEqual(
      new Date(2025, 0, 1),
    );
  });

  it("words the delta pill and its spoken form", () => {
    expect(formatReportDelta(2 * 3600 + 10 * 60, "week")).toEqual({
      text: "+2h 10m vs last week so far",
      spoken: "2 hours 10 minutes more than last week so far",
    });
    expect(formatReportDelta(-45 * 60, "yesterday")).toEqual({
      text: "−45m vs yesterday so far",
      spoken: "45 minutes less than yesterday so far",
    });
    expect(formatReportDelta(20, "month").text).toBe("Same as last month so far");
  });

  it("names the hero period for each range", () => {
    expect(reportHeroPeriod("week", buildReportRange("week", now))).toBe("this week");
    expect(reportHeroPeriod("today", buildReportRange("today", now))).toBe("today");
    expect(reportHeroPeriod("year", buildReportRange("year", now))).toBe("in 2026");
    expect(reportHeroPeriod("month", buildReportRange("month", now))).toMatch(/^in /);
    const custom = buildReportRange({ start: "2026-10-01", end: "2026-10-05" }, now);
    expect(reportHeroPeriod({ start: "2026-10-01", end: "2026-10-05" }, custom)).toBe(
      custom.title,
    );
  });

  it("counts goal days up to today, within 15% of the daily goal", () => {
    const range = buildReportRange("week", now);
    const seconds = [8 * 3600, 6.8 * 3600, 6.7 * 3600, 0, 3600, 9 * 3600, 9 * 3600];
    const buckets = range.buckets.map((b, i) => ({ start: b.start, seconds: seconds[i] }));
    // Goal 8h: 85% is 6h 48m. Saturday and Sunday are still ahead.
    expect(weekGoalDays(buckets, now, 480)).toEqual([true, true, false, false, false]);
    expect(weekGoalDays(buckets, now, null)).toEqual([]);
    expect(weekGoalDays(buckets, now, 0)).toEqual([]);
  });

  it("places the first of the month under its Monday-first weekday", () => {
    expect(monthGridLeadingBlanks(new Date(2026, 9, 1))).toBe(3); // Thursday
    expect(monthGridLeadingBlanks(new Date(2026, 1, 1))).toBe(6); // Sunday
    expect(monthGridLeadingBlanks(new Date(2026, 5, 1))).toBe(0); // Monday
  });

  it("stacks day blocks against at least a 12-hour column, never thinner than the minimum", () => {
    expect(reportStackHeights([6 * 3600, 60], 12 * 3600, 170, 6)).toEqual([85, 6]);
    // A 16-hour day rescales the column instead of overflowing it.
    expect(reportStackHeights([16 * 3600], 16 * 3600, 170, 6)).toEqual([170]);
    expect(reportStackHeights([], 0, 170, 6)).toEqual([]);
  });
});
