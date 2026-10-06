import { describe, expect, it } from "vitest";
import { calendarInitialScrollHour } from "@/lib/calendar-initial-scroll";

const day = (iso: string) => new Date(`${iso}T00:00:00`);
const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map(day);
const at = (iso: string) => new Date(iso);
const entry = (startedAt: string, stoppedAt: string | null = null) => ({
  startedAt: new Date(startedAt).toISOString(),
  stoppedAt: stoppedAt ? new Date(stoppedAt).toISOString() : null
});

describe("calendarInitialScrollHour", () => {
  it("opens an hour and a half before now when today is visible", () => {
    expect(calendarInitialScrollHour({ now: at("2026-10-06T16:30:00"), visibleDays: week, entries: [] })).toBe(15);
  });

  it("never scrolls above midnight early in the day", () => {
    expect(calendarInitialScrollHour({ now: at("2026-10-06T00:40:00"), visibleDays: week, entries: [] })).toBe(0);
  });

  it("keeps the current hour on screen late in the evening", () => {
    expect(calendarInitialScrollHour({ now: at("2026-10-06T23:50:00"), visibleDays: week, entries: [] })).toBeCloseTo(22 + 20 / 60);
  });

  it("opens at the earliest visible entry for a past week", () => {
    const pastWeek = ["2026-09-28", "2026-09-29", "2026-09-30"].map(day);
    const entries = [
      entry("2026-09-29T10:15:00", "2026-09-29T11:00:00"),
      entry("2026-09-30T08:45:00", "2026-09-30T09:30:00"),
      entry("2026-10-06T06:00:00", "2026-10-06T07:00:00")
    ];
    expect(calendarInitialScrollHour({ now: at("2026-10-06T16:30:00"), visibleDays: pastWeek, entries })).toBe(8.25);
  });

  it("opens at 07:00 for an empty week that is not this week", () => {
    expect(calendarInitialScrollHour({ now: at("2026-10-06T16:30:00"), visibleDays: [day("2026-09-29")], entries: [] })).toBe(7);
  });

  it("ignores an overnight entry that began before the visible days", () => {
    const entries = [entry("2026-09-28T23:00:00", "2026-09-29T07:00:00"), entry("2026-09-29T09:30:00", "2026-09-29T10:00:00")];
    expect(calendarInitialScrollHour({ now: at("2026-10-06T16:30:00"), visibleDays: [day("2026-09-29")], entries })).toBe(9);
  });
});
