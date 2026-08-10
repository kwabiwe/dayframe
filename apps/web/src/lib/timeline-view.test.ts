import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_PREFERENCE,
  formatTimelinePeriodLabel,
  resetTimelineState,
  resolveTimelineRanges,
  shiftTimelineState,
  shouldAdvanceStaleTimelineToToday,
  timelineHref,
  timelinePreferenceCookieValue,
  timelinePreferenceFromCookieValue,
  timelineStateFromSearchParams,
  toTimelineDateKey,
  updateTimelinePreference
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

describe("Timeline view and scope preference", () => {
  it("uses today with Calendar Week when no preference exists", () => {
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now })).toEqual({
      date: "2026-07-23",
      scope: "week",
      view: "calendar"
    });
  });

  it("restores a saved List Day preference without persisting the selected date", () => {
    const preference = { lastView: "list" as const, preferredScope: "day" as const };
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now, preference })).toEqual({
      date: "2026-07-23",
      scope: "day",
      view: "list"
    });
    expect(updateTimelinePreference(preference, { scope: "day", view: "list" })).toEqual(preference);
  });

  it("lets a valid explicit URL override the saved view and scope", () => {
    expect(timelineStateFromSearchParams(
      new URLSearchParams("date=2026-07-30&scope=week&view=calendar"),
      { now, preference: { lastView: "list", preferredScope: "day" } }
    )).toEqual({
      date: "2026-07-30",
      scope: "week",
      view: "calendar"
    });
  });

  it("keeps the non-Timesheet scope through a Timesheet visit", () => {
    const dayPreference = updateTimelinePreference(DEFAULT_TIMELINE_PREFERENCE, {
      scope: "day",
      view: "calendar"
    });
    const afterTimesheet = updateTimelinePreference(dayPreference, {
      scope: "week",
      view: "timesheet"
    });
    expect(afterTimesheet).toEqual({ lastView: "timesheet", preferredScope: "day" });
    expect(timelineStateFromSearchParams(new URLSearchParams("view=list"), {
      now,
      preference: afterTimesheet
    })).toEqual({ date: "2026-07-23", scope: "day", view: "list" });
  });

  it("restores Timesheet in Week while retaining the previous non-Timesheet scope", () => {
    const preference = { lastView: "timesheet" as const, preferredScope: "day" as const };
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now, preference })).toEqual({
      date: "2026-07-23",
      scope: "week",
      view: "timesheet"
    });
    expect(timelineStateFromSearchParams(new URLSearchParams("view=calendar"), { now, preference })).toEqual({
      date: "2026-07-23",
      scope: "day",
      view: "calendar"
    });
  });

  it("rejects invalid stored or explicit values without poisoning preferences", () => {
    expect(timelinePreferenceFromCookieValue("grid:month")).toBeNull();
    expect(timelineStateFromSearchParams(
      new URLSearchParams("scope=month&view=grid"),
      { now, preference: { lastView: "list", preferredScope: "day" } }
    )).toEqual({ date: "2026-07-23", scope: "week", view: "calendar" });
    expect(timelinePreferenceCookieValue({ lastView: "list", preferredScope: "day" })).toBe("list:day");
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

  it("advances only a stale view that had been showing the previous Today", () => {
    const nextDay = localDate(2026, 7, 24, 8);
    expect(shouldAdvanceStaleTimelineToToday(
      { date: "2026-07-23", scope: "day", view: "list" },
      "2026-07-23",
      nextDay
    )).toBe(true);
    expect(shouldAdvanceStaleTimelineToToday(
      { date: "2026-07-20", scope: "day", view: "list" },
      "2026-07-23",
      nextDay
    )).toBe(false);
    expect(shouldAdvanceStaleTimelineToToday(
      { date: "2026-07-23", scope: "day", view: "list" },
      "2026-07-23",
      now
    )).toBe(false);
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

describe("Timeline period labels", () => {
  it("labels the current local Day as Today", () => {
    expect(formatTimelinePeriodLabel("day", resolveTimelineRanges({
      date: "2026-07-23",
      scope: "day",
      view: "list"
    }), now)).toBe("Today");
  });

  it("uses approved abbreviated day and same-year week formats", () => {
    expect(formatTimelinePeriodLabel("day", resolveTimelineRanges({
      date: "2026-07-31",
      scope: "day",
      view: "calendar"
    }))).toBe("Fri, 31 Jul 2026");
    expect(formatTimelinePeriodLabel("week", resolveTimelineRanges({
      date: "2026-07-31",
      scope: "week",
      view: "calendar"
    }))).toBe("Mon 27 Jul – Sun 2 Aug 2026");
  });

  it("keeps cross-year week ranges unambiguous", () => {
    expect(formatTimelinePeriodLabel("week", resolveTimelineRanges({
      date: "2026-12-30",
      scope: "week",
      view: "calendar"
    }))).toBe("Mon 28 Dec 2026 – Sun 3 Jan 2027");
  });
});

function localDate(year: number, month: number, day: number, hour = 0) {
  return new Date(year, month - 1, day, hour);
}
