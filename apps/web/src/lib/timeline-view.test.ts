import { afterAll, describe, expect, it } from "vitest";
import {
  resetTimelineState,
  resolveTimelineRanges,
  shiftTimelineState,
  timelineHref,
  timelineStateFromSearchParams,
  toTimelineDateKey
} from "./timeline-view";

const originalTimeZone = process.env.TZ;
process.env.TZ = "Europe/London";
afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

const now = localDate(2026, 7, 23, 12);

describe("Timeline URL state", () => {
  it("uses safe explicit defaults", () => {
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now })).toEqual({
      date: "2026-07-23",
      scope: "week",
      view: "calendar"
    });
  });

  it("accepts valid date, scope, and view values", () => {
    expect(timelineStateFromSearchParams(
      new URLSearchParams("date=2026-07-22&scope=day&view=list"),
      { now }
    )).toEqual({
      date: "2026-07-22",
      scope: "day",
      view: "list"
    });
  });

  it.each([
    ["not-a-date", "2026-07-23"],
    ["2026-02-30", "2026-07-23"],
    ["2026-13-01", "2026-07-23"]
  ])("falls back safely for invalid date %s", (date, expected) => {
    expect(timelineStateFromSearchParams(new URLSearchParams(`date=${date}`), { now }).date).toBe(expected);
  });

  it("falls back safely for invalid scope and view", () => {
    expect(timelineStateFromSearchParams(
      new URLSearchParams("date=2026-07-22&scope=month&view=grid"),
      { now }
    )).toEqual({
      date: "2026-07-22",
      scope: "week",
      view: "calendar"
    });
  });

  it("normalizes Timesheet to Week", () => {
    expect(timelineStateFromSearchParams(
      new URLSearchParams("date=2026-07-22&scope=day&view=timesheet"),
      { now }
    )).toEqual({
      date: "2026-07-22",
      scope: "week",
      view: "timesheet"
    });
  });

  it("serializes canonically and preserves supported extra parameters", () => {
    const state = timelineStateFromSearchParams(
      new URLSearchParams("category=category-1&date=2026-07-22&scope=day&view=list"),
      { now }
    );
    expect(timelineHref("category=category-1&entry=entry-1", state)).toBe(
      "/timeline?date=2026-07-22&scope=day&view=list&category=category-1&entry=entry-1"
    );
  });

  it("round trips direct bookmarked state", () => {
    const href = timelineHref("", {
      date: "2025-11-03",
      scope: "week",
      view: "calendar"
    });
    expect(timelineStateFromSearchParams(new URL(href, "https://dayframe.test").searchParams, { now })).toEqual({
      date: "2025-11-03",
      scope: "week",
      view: "calendar"
    });
  });

  it("normalizes Timesheet overrides in the serializer", () => {
    expect(timelineHref("", {
      date: "2026-07-23",
      scope: "day",
      view: "calendar"
    }, { view: "timesheet" })).toBe(
      "/timeline?date=2026-07-23&scope=week&view=timesheet"
    );
  });
});

describe("Timeline local calendar ranges", () => {
  it("resolves a selected Day from local midnight to the next local midnight", () => {
    const ranges = resolveTimelineRanges({ date: "2026-07-23", scope: "day", view: "calendar" });
    expect(toTimelineDateKey(ranges.day.start)).toBe("2026-07-23");
    expect(toTimelineDateKey(ranges.day.end)).toBe("2026-07-24");
    expect(ranges.active).toEqual(ranges.day);
  });

  it("uses the containing Monday-Sunday week", () => {
    const ranges = resolveTimelineRanges({ date: "2026-07-23", scope: "week", view: "list" });
    expect(toTimelineDateKey(ranges.week.start)).toBe("2026-07-20");
    expect(toTimelineDateKey(ranges.week.end)).toBe("2026-07-27");
    expect(ranges.weekDays.map(toTimelineDateKey)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26"
    ]);
  });

  it("moves by one calendar day or one calendar week", () => {
    expect(shiftTimelineState(
      { date: "2026-03-29", scope: "day", view: "calendar" },
      "next"
    ).date).toBe("2026-03-30");
    expect(shiftTimelineState(
      { date: "2026-10-25", scope: "week", view: "list" },
      "previous"
    ).date).toBe("2026-10-18");
  });

  it("resets Day and Week anchors to the local current date", () => {
    expect(resetTimelineState(
      { date: "2025-01-01", scope: "day", view: "calendar" },
      now
    ).date).toBe("2026-07-23");
    expect(resetTimelineState(
      { date: "2025-01-01", scope: "week", view: "list" },
      now
    ).date).toBe("2026-07-23");
  });

  it("uses calendar arithmetic for the Europe/London spring-forward day and week", () => {
    const day = resolveTimelineRanges({ date: "2026-03-29", scope: "day", view: "calendar" });
    const week = resolveTimelineRanges({ date: "2026-03-29", scope: "week", view: "calendar" });
    expect(toTimelineDateKey(day.day.end)).toBe("2026-03-30");
    expect(day.day.end.getTime() - day.day.start.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(toTimelineDateKey(week.week.start)).toBe("2026-03-23");
    expect(toTimelineDateKey(week.week.end)).toBe("2026-03-30");
    expect(week.week.end.getTime() - week.week.start.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it("uses calendar arithmetic for the Europe/London autumn clock-change day and week", () => {
    const ranges = resolveTimelineRanges({ date: "2026-10-25", scope: "day", view: "calendar" });
    const week = resolveTimelineRanges({ date: "2026-10-25", scope: "week", view: "calendar" });
    expect(toTimelineDateKey(ranges.day.start)).toBe("2026-10-25");
    expect(toTimelineDateKey(ranges.day.end)).toBe("2026-10-26");
    expect(ranges.day.end.getTime() - ranges.day.start.getTime()).toBe(25 * 60 * 60 * 1000);
    expect(toTimelineDateKey(week.week.start)).toBe("2026-10-19");
    expect(toTimelineDateKey(week.week.end)).toBe("2026-10-26");
    expect(week.week.end.getTime() - week.week.start.getTime()).toBe(169 * 60 * 60 * 1000);
  });
});

function localDate(year: number, month: number, day: number, hour = 0) {
  return new Date(year, month - 1, day, hour);
}
