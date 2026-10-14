import { describe, expect, it } from "vitest";
import { buildHistoryDaySections } from "./historyPresentation";
import { buildEarlierThisWeek, shortDuration, earlierDayReviewCounts } from "./earlierThisWeek";
import { buildTodayGoalFrame } from "./todayGoalFrame";

const today = new Date(2026, 9, 7);
const nowMs = today.getTime() + 15 * 3_600_000;
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 7 - daysAgo, h, m).toISOString();
const entry = (id: string, start: string, stop: string | null, color = "blue") => ({
  id, startedAt: start, stoppedAt: stop, categoryColor: color, categoryId: `cat-${color}`, categoryName: color, description: null,
}) as never;

function earlier(entries: unknown[]) {
  return buildEarlierThisWeek(buildHistoryDaySections({ days: 7, entries: entries as never, nowMs }), nowMs, entries as never);
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

  it("fills a timer still running since an earlier day to that day's midnight", () => {
    const days = earlier([entry("forgot", at(1, 23), null)]);
    expect(days[0].segments).toEqual([{ key: "forgot", color: "blue", left: 23 / 24, width: 1 / 24 }]);
    expect(days[0].totalSeconds).toBe(3600);
  });

  it("leaves out days older than a week", () => {
    expect(earlier([entry("old", at(8, 9), at(8, 10))]).every((day) => day.segments.length === 0)).toBe(true);
  });

  it("counts overlapping time once in a past day's total, matching that day's Today hero (D14)", () => {
    const entries = [entry("a", at(1, 9), at(1, 11)), entry("b", at(1, 10), at(1, 12), "lime")];
    const [yesterday] = earlier(entries);
    // 4h logged, 3h covered.
    expect(yesterday.totalSeconds).toBe(3 * 3600);
    // The same number yesterday's Today hero showed at the end of that day.
    const endOfYesterday = new Date(2026, 9, 6, 23, 59, 59).getTime();
    expect(yesterday.totalSeconds).toBe(buildTodayGoalFrame({ entries, goalMinutes: 480, nowMs: endOfYesterday }).totalSeconds);
    // The mini ribbon still draws every block.
    expect(yesterday.segments.map((segment) => segment.key)).toEqual(["a", "b"]);
  });

  it("counts two overlapping blocks of the same activity once", () => {
    const [yesterday] = earlier([entry("a", at(1, 9), at(1, 11)), entry("b", at(1, 10), at(1, 12)), entry("c", at(1, 9, 30), at(1, 10, 30))]);
    expect(yesterday.totalSeconds).toBe(3 * 3600);
  });

  it("splits overlapping blocks across midnight, counting each day's covered part once", () => {
    const days = earlier([entry("sleep", at(2, 22), at(1, 6)), entry("read", at(2, 23), at(1, 0, 30), "lime")]);
    // Day before yesterday: 22:00–24:00 covered (2h, not 3h); yesterday: 00:00–06:00 (6h, not 6h 30m).
    expect(days[1].totalSeconds).toBe(2 * 3600);
    expect(days[0].totalSeconds).toBe(6 * 3600);
  });

  it("totals a clock-change day by its real length, overlaps once", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 25 Oct 2026 (clocks go back): 00:00–06:00 local is 7 real hours.
      const now = new Date(2026, 9, 26, 15).getTime();
      const iso = (h: number) => new Date(2026, 9, 25, h).toISOString();
      const entries = [entry("a", iso(0), iso(6)), entry("b", iso(1), iso(6), "lime")];
      const days = buildEarlierThisWeek(buildHistoryDaySections({ days: 7, entries: entries as never, nowMs: now }), now, entries as never);
      expect(days[0].dayKey).toBe("2026-10-25");
      expect(days[0].totalSeconds).toBe(7 * 3600);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("keeps sub-second clips, so a past day's total always matches that day's hero (Codex on #410)", () => {
    const base = new Date(2026, 9, 6, 9).getTime();
    // Two separate blocks: 59.9 s and 0.5 s. The hero covers 60.4 s and reads "1m".
    const entries = [
      entry("a", new Date(base).toISOString(), new Date(base + 59_900).toISOString()),
      entry("b", new Date(base + 120_000).toISOString(), new Date(base + 120_500).toISOString(), "lime"),
    ];
    const [yesterday] = earlier(entries);
    const hero = buildTodayGoalFrame({ entries, goalMinutes: 480, nowMs: new Date(2026, 9, 6, 23, 59, 59).getTime() }).totalSeconds;
    expect(hero).toBe(60);
    expect(yesterday.totalSeconds).toBe(hero);
    expect(shortDuration(yesterday.totalSeconds)).toBe("1m");
  });

  it("writes totals the one Dayframe way (UIA-042)", () => {
    expect(shortDuration(0)).toBe("0m");
    expect(shortDuration(35 * 60)).toBe("35m");
    expect(shortDuration(2 * 3600)).toBe("2h");
    expect(shortDuration(125 * 60)).toBe("2h 5m");
  });
});

describe("earlierDayReviewCounts (the hatched chip, 14 Oct 2026)", () => {
  const days = [12, 11, 10].map((day) => ({ dayKey: `2026-10-${day}`, date: new Date(2026, 9, day) }));
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
  const item = (start: string | null, stop: string | null, createdAt: string | null = null) => ({
    suggestedStartedAt: start,
    suggestedStoppedAt: stop,
    createdAt
  });

  it("counts each day's open moments, an overnight one on both days", () => {
    const counts = earlierDayReviewCounts(days, [
      item(at(12, 9), at(12, 10)),
      item(at(11, 23), at(12, 7)),
      item(at(10, 12), at(10, 12, 30)),
      item(null, null, at(10, 18)),
      item(at(9, 9), at(9, 10))
    ]);
    expect([...counts]).toEqual([["2026-10-12", 2], ["2026-10-11", 1], ["2026-10-10", 2]]);
  });

  it("leaves a day with nothing open out, and a moment ending at midnight on its own day", () => {
    const counts = earlierDayReviewCounts(days, [item(at(11, 22), at(12, 0))]);
    expect([...counts]).toEqual([["2026-10-11", 1]]);
    expect(earlierDayReviewCounts(days, []).size).toBe(0);
  });
});
