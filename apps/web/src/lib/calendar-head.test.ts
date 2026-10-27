import { describe, expect, it } from "vitest";
import { calendarHeadModel } from "./calendar-head";

const day = (date: number) => new Date(2026, 9, date);
// Whole minutes: Date truncates a fractional hour.
const at = (date: number, minutes: number) => new Date(2026, 9, date, 0, minutes).toISOString();
const entry = (id: string, date: number, from: number, to: number, categoryId: string | null, name = id) => ({
  id,
  startedAt: at(date, from),
  stoppedAt: at(date, to),
  categoryId,
  categoryName: name,
  categoryColor: categoryId ? "blue" : null
});

describe("Calendar page head (Trello: Calendar page improvements)", () => {
  const weekDays = [5, 6, 7, 8, 9, 10, 11].map(day);
  const entries = [
    entry("w", 6, 9 * 60, 13 * 60, "work", "Work"),
    entry("g", 6, 14 * 60, 15 * 60, "gym", "Gym"),
    entry("r", 6, 16 * 60, 18 * 60, "read", "Reading"),
    entry("x", 6, 19 * 60, 19 * 60 + 30, "admin", "Admin"),
    entry("n", 11, 8 * 60, 9 * 60, null)
  ];
  const model = calendarHeadModel({
    entries: entries as never,
    nowMs: new Date(2026, 9, 11, 14, 48).getTime(),
    selectedDay: day(6),
    weekDays,
    weekLoggedSeconds: 106 * 3600 + 14 * 60
  });

  it("names the month and the week's total, with no separate framed line (#259)", () => {
    expect(model.month).toBe("October");
    expect(model.weekTotal).toBe("106h 14m this week");
    expect(Object.keys(model)).toEqual(["month", "days", "weekTotal"]);
  });

  it("puts each day's total under its date, a dash for none (#256)", () => {
    expect(model.days.map((d) => d.total)).toEqual(["–", "7h 30m", "–", "–", "–", "–", "1h"]);
  });

  it("gives each day its initial, date, selection, today mark and up to three biggest activities", () => {
    expect(model.days.map((d) => `${d.initial}${d.dateNumber}`)).toEqual(["M5", "T6", "W7", "T8", "F9", "S10", "S11"]);
    expect(model.days.filter((d) => d.selected).map((d) => d.dateNumber)).toEqual([6]);
    expect(model.days.filter((d) => d.isToday).map((d) => d.dateNumber)).toEqual([11]);
    expect(model.days[1].bars.map((bar) => bar.name)).toEqual(["Work", "Reading", "Gym"]);
    expect(model.days[6].bars).toEqual([{ key: "none", color: null, name: "No activity" }]);
    expect(model.days[0].accessibleName).toBe("Monday 5 October, nothing framed");
    expect(model.days[1].accessibleName).toBe("Tuesday 6 October, 7h 30m framed");
  });

  it("names a past week by its Monday instead of calling it this week", () => {
    const past = calendarHeadModel({
      entries: [],
      nowMs: new Date(2026, 9, 11, 14, 48).getTime(),
      selectedDay: day(1),
      weekDays: [28, 29, 30].map((date) => new Date(2026, 8, date)).concat([1, 2, 3, 4].map(day)),
      weekLoggedSeconds: 3600
    });
    expect(past.weekTotal).toBe("1h in the week of 28 Sept");
    expect(past.days.some((d) => d.isToday)).toBe(false);
  });

  it("leaves today out until hydration, so the server render and the browser agree", () => {
    const beforeHydration = calendarHeadModel({
      entries: entries as never,
      hydrated: false,
      nowMs: new Date(2026, 9, 11, 14, 48).getTime(),
      selectedDay: day(11),
      weekDays,
      weekLoggedSeconds: 3600
    });
    expect(beforeHydration.days.some((d) => d.isToday)).toBe(false);
    expect(beforeHydration.days.every((d) => d.bars.length === 0)).toBe(true);
    expect(beforeHydration.days[0].accessibleName).toBe("Monday 5 October");
    // Totals depend on where the browser's days start, so the server render shows a dash.
    expect(beforeHydration.days.every((d) => d.total === "–")).toBe(true);
    expect(beforeHydration.weekTotal).toBe("– in the week of 5 Oct");
  });

  it("marks the server's guess at today (the viewer's zone) until hydration", () => {
    const beforeHydration = calendarHeadModel({
      entries: entries as never,
      hydrated: false,
      nowMs: new Date(2026, 9, 11, 14, 48).getTime(),
      selectedDay: day(11),
      todayKeyHint: "2026-10-11",
      weekDays,
      weekLoggedSeconds: 3600
    });
    expect(beforeHydration.days.filter((d) => d.isToday).map((d) => d.dateNumber)).toEqual([11]);
    expect(beforeHydration.weekTotal).toBe("– this week");
  });

  it("shows a day with under a minute framed (Codex r1 on #583)", () => {
    const head = calendarHeadModel({
      entries: [entry("s", 7, 9 * 60, 9 * 60, "work")].map((e) => ({ ...e, stoppedAt: new Date(new Date(e.startedAt).getTime() + 20_000).toISOString() })) as never,
      nowMs: new Date(2026, 9, 11, 14, 48).getTime(),
      selectedDay: day(7),
      weekDays: [5, 6, 7, 8, 9, 10, 11].map(day),
      weekLoggedSeconds: 20
    });
    expect(head.days[2].total).toBe("<1m");
  });
});
