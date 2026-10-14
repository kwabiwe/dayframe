import { describe, expect, it } from "vitest";
import { withGoalExclusions } from "@dayframe/shared";
import { buildTodayGoalFrame } from "./todayGoalFrame";

const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();
const entry = (id: string, start: string, stop: string | null, color = "blue") => ({
  id,
  startedAt: start,
  stoppedAt: stop,
  categoryColor: color,
  categoryId: `cat-${color}`,
  categoryName: color,
});

describe("buildTodayGoalFrame", () => {
  it("keeps Sleep in the total but out of the goal cells and percent (UIA-043)", () => {
    const entries = [entry("night", at(0), at(7), "sleep"), entry("work", at(9), at(11), "blue")];
    const off = buildTodayGoalFrame({
      categories: [{ id: "cat-sleep", countsTowardGoal: false }, { id: "cat-blue", countsTowardGoal: true }],
      entries,
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(off.totalSeconds).toBe(9 * 3600);
    expect(off.goalSeconds).toBe(2 * 3600);
    expect(off.percent).toBe(25);
    expect(off.cells.flat().map((slice) => slice.color)).toEqual(["blue", "blue"]);
    // Switched back on (or an older server without the flag), Sleep fills the goal again.
    const on = buildTodayGoalFrame({ categories: [{ id: "cat-sleep", countsTowardGoal: true }], entries, goalMinutes: 480, nowMs: day + 12 * 3_600_000 });
    expect(on.goalSeconds).toBe(9 * 3600);
    expect(on.percent).toBe(100);
    expect(buildTodayGoalFrame({ entries, goalMinutes: 480, nowMs: day + 12 * 3_600_000 }).goalSeconds).toBe(9 * 3600);
  });

  it("keeps an archived non-counting activity out through the bootstrap's exclusion list", () => {
    const entries = [entry("night", at(0), at(7), "sleep"), entry("work", at(9), at(10), "blue")];
    const frame = buildTodayGoalFrame({
      // Sleep is archived: only the exclusion list knows it doesn't count.
      categories: withGoalExclusions([{ id: "cat-blue", countsTowardGoal: true }], ["cat-sleep"]),
      entries,
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(8 * 3600);
    expect(frame.goalSeconds).toBe(3600);
  });

  it("counts time without an activity toward the goal", () => {
    const frame = buildTodayGoalFrame({
      categories: [{ id: "cat-sleep", countsTowardGoal: false }],
      entries: [{ id: "bare", startedAt: at(9), stoppedAt: at(10), categoryId: null }],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(frame.goalSeconds).toBe(3600);
  });

  it("fills hour cells in time order and reports the share of the goal", () => {
    const frame = buildTodayGoalFrame({
      entries: [entry("b", at(10), at(10, 30), "lime"), entry("a", at(8), at(9, 30), "blue")],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(2 * 3600);
    expect(frame.goalHours).toBe(8);
    expect(frame.percent).toBe(25);
    expect(frame.cells).toHaveLength(8);
    expect(frame.cells[0]).toEqual([{ key: "a:0", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[1]).toEqual([
      { key: "a:1", color: "blue", fraction: 0.5, live: false },
      { key: "b:1", color: "lime", fraction: 0.5, live: false },
    ]);
    expect(frame.cells[2]).toEqual([]);
  });

  it("counts only today's part of an entry that crosses midnight and the running timer up to now", () => {
    const frame = buildTodayGoalFrame({
      entries: [entry("sleep", new Date(day - 3_600_000).toISOString(), at(1)), entry("live", at(9), null, "rose")],
      goalMinutes: 480,
      nowMs: day + 9.5 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(90 * 60);
    expect(frame.cells[0]).toEqual([{ key: "sleep:0", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[1]).toEqual([{ key: "live:1", color: "rose", fraction: 0.5, live: true }]);
  });

  it("caps the percentage and the cells at the goal while the total keeps counting", () => {
    const frame = buildTodayGoalFrame({ entries: [entry("long", at(0), at(10))], goalMinutes: 480, nowMs: day + 11 * 3_600_000 });
    expect(frame.totalSeconds).toBe(10 * 3600);
    expect(frame.percent).toBe(100);
    expect(frame.cells.every((cell) => cell.length === 1 && cell[0].fraction === 1)).toBe(true);
  });

  it("uses the default eight-hour goal when the account has none and rounds odd goals to whole-hour cells", () => {
    expect(buildTodayGoalFrame({ entries: [], goalMinutes: undefined, nowMs: day }).goalHours).toBe(8);
    const odd = buildTodayGoalFrame({ entries: [], goalMinutes: 450, nowMs: day });
    expect(odd.goalHours).toBe(7.5);
    expect(odd.cells).toHaveLength(8);
    expect(buildTodayGoalFrame({ entries: [], goalMinutes: 20, nowMs: day }).cells).toHaveLength(1);
  });

  it("counts overlapping time once in the total and toward the goal, in the colour of the entry that started first (D14)", () => {
    const frame = buildTodayGoalFrame({
      entries: [
        entry("work", at(9), at(11), "blue"),
        entry("walk", at(10, 30), at(11, 30), "lime"),
        entry("call", at(9, 15), at(9, 45), "rose"),
      ],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    // 2h + 1h + 30m logged, but only 09:00–11:30 is covered: the hero and the goal both read 2h 30m.
    expect(frame.totalSeconds).toBe(150 * 60);
    expect(frame.goalSeconds).toBe(150 * 60);
    expect(frame.percent).toBe(31);
    expect(frame.cells[0]).toEqual([{ key: "work:0", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[1]).toEqual([{ key: "work:1", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[2]).toEqual([{ key: "walk:2", color: "lime", fraction: 0.5, live: false }]);
    expect(frame.cells.flat().some((slice) => slice.key.startsWith("call"))).toBe(false);
  });

  it("counts two overlapping blocks of the same activity once", () => {
    const frame = buildTodayGoalFrame({
      entries: [entry("a", at(9), at(11)), entry("b", at(10), at(12))],
      goalMinutes: 480,
      nowMs: day + 13 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(3 * 3600);
    expect(frame.goalSeconds).toBe(3 * 3600);
  });

  it("runs a running block that overlaps a finished one to now, counting the shared time once", () => {
    const frame = buildTodayGoalFrame({
      entries: [entry("inbox", at(9), at(10), "steel"), entry("live", at(9, 30), null, "blue")],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    // Inbox 09:00–10:00 and Deep work since 09:30: 3h covered at 12:00 (logged would be 3h 30m).
    expect(frame.totalSeconds).toBe(3 * 3600);
    expect(frame.cells[2]).toEqual([{ key: "live:2", color: "blue", fraction: 1, live: true }]);
  });

  it("counts only today's part of blocks that overlap across midnight", () => {
    const frame = buildTodayGoalFrame({
      entries: [
        entry("night", new Date(day - 2 * 3_600_000).toISOString(), at(1)),
        entry("late", new Date(day - 3_600_000).toISOString(), at(0, 30), "steel"),
      ],
      goalMinutes: 480,
      nowMs: day + 2 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(3600);
    expect(frame.goalSeconds).toBe(3600);
  });

  it("never passes the real day on a clock-change day", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      // 25 Oct 2026: clocks go back at 02:00 BST, so the local day is 25 hours long.
      const longDay = new Date(2026, 9, 25).getTime();
      const nowMs = new Date(2026, 9, 25, 23, 59).getTime();
      const frame = buildTodayGoalFrame({
        entries: [
          { id: "a", startedAt: new Date(longDay).toISOString(), stoppedAt: new Date(nowMs).toISOString(), categoryColor: "blue" },
          { id: "b", startedAt: new Date(longDay).toISOString(), stoppedAt: new Date(nowMs).toISOString(), categoryColor: "lime" },
        ],
        goalMinutes: 480,
        nowMs,
      });
      // 24h 59m of real time, covered once (logged would read twice that).
      expect(frame.totalSeconds).toBe((24 * 60 + 59) * 60);
      expect(nowMs - longDay).toBe((24 * 60 + 59) * 60_000);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("fills the goal with the covered time of goal-counting activities only, overlaps with Sleep included in full", () => {
    const categories = [{ id: "cat-sleep", countsTowardGoal: false }, { id: "cat-blue", countsTowardGoal: true }];
    const frame = buildTodayGoalFrame({
      categories,
      entries: [
        entry("night", at(0), at(7), "sleep"),
        // Reading in bed overlaps Sleep 06:00–07:00; it counts toward the goal in full.
        entry("reading", at(6), at(8), "blue"),
        entry("work", at(7, 30), at(9), "blue"),
      ],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    // Hero: 00:00–09:00 covered once. Cells: Reading ∪ Work = 06:00–09:00.
    expect(frame.totalSeconds).toBe(9 * 3600);
    expect(frame.goalSeconds).toBe(3 * 3600);
    expect(frame.percent).toBe(38);
    expect(frame.cells.flat().every((slice) => slice.color === "blue")).toBe(true);
    // The goal never exceeds the hero.
    expect(frame.goalSeconds).toBeLessThanOrEqual(frame.totalSeconds);
  });

  it("keeps the goal time equal to the hero when every activity counts, whatever overlaps", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let run = 0; run < 200; run += 1) {
      const nowMs = day + Math.floor(random() * 24 * 3_600_000);
      const entries = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, index) => {
        const from = day - 3_600_000 + Math.floor(random() * 25 * 3_600_000);
        const to = random() < 0.15 ? null : new Date(from + 1 + Math.floor(random() * 4 * 3_600_000)).toISOString();
        return entry(`e${index}`, new Date(from).toISOString(), to, ["blue", "lime", "rose"][index % 3]);
      });
      const frame = buildTodayGoalFrame({ entries, goalMinutes: 1440, nowMs });
      expect(frame.goalSeconds).toBe(frame.totalSeconds);
      expect(frame.totalSeconds).toBeLessThanOrEqual(Math.floor((nowMs - day) / 1000));
    }
  });

  it("terminates for goals whose hour cells are not whole milliseconds", () => {
    // 394 min / 7 cells is fractional: a cursor on a cell edge once took a zero step forever.
    for (const goalMinutes of [394, 645, 675]) {
      const frame = buildTodayGoalFrame({ entries: [entry("long", at(0), at(12))], goalMinutes, nowMs: day + 13 * 3_600_000 });
      expect(frame.percent).toBe(100);
      const filled = frame.cells.map((cell) => cell.reduce((sum, slice) => sum + slice.fraction, 0));
      expect(filled.every((fraction) => Math.abs(fraction - 1) < 1e-9)).toBe(true);
    }
  });

  it("terminates for every goal up to a full day with a day-long entry", () => {
    for (let goalMinutes = 1; goalMinutes <= 1440; goalMinutes += 1) {
      const frame = buildTodayGoalFrame({ entries: [entry("day", at(0), at(23, 59))], goalMinutes, nowMs: day + 86_399_000 });
      expect(frame.cells.flat().length).toBeLessThanOrEqual(frame.cells.length);
    }
  });

  it("colours shared time by the entry that really started first, even before midnight", () => {
    const frame = buildTodayGoalFrame({
      entries: [
        { ...entry("zz-sleep", new Date(day - 2 * 3_600_000).toISOString(), at(7), "blue") },
        { ...entry("aa-reading", new Date(day - 30 * 60_000).toISOString(), at(0, 45), "lime") },
      ],
      goalMinutes: 480,
      nowMs: day + 8 * 3_600_000,
    });
    expect(frame.cells[0]).toEqual([{ key: "zz-sleep:0", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells.flat().some((slice) => slice.key.startsWith("aa-reading"))).toBe(false);
  });

  it("ignores future and zero-length entries", () => {
    const frame = buildTodayGoalFrame({
      entries: [entry("future", at(14), at(15)), entry("zero", at(8), at(8))],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(0);
    expect(frame.cells.flat()).toEqual([]);
  });
});
