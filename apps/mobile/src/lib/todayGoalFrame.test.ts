import { describe, expect, it } from "vitest";
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

  it("counts overlapping time once, in the colour of the entry that started first", () => {
    const frame = buildTodayGoalFrame({
      entries: [
        entry("work", at(9), at(11), "blue"),
        entry("walk", at(10, 30), at(11, 30), "lime"),
        entry("call", at(9, 15), at(9, 45), "rose"),
      ],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    });
    expect(frame.totalSeconds).toBe(150 * 60);
    expect(frame.percent).toBe(31);
    expect(frame.cells[0]).toEqual([{ key: "work:0", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[1]).toEqual([{ key: "work:1", color: "blue", fraction: 1, live: false }]);
    expect(frame.cells[2]).toEqual([{ key: "walk:2", color: "lime", fraction: 0.5, live: false }]);
    expect(frame.cells.flat().some((slice) => slice.key.startsWith("call"))).toBe(false);
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
