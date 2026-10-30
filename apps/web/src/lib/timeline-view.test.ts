import { afterAll, describe, expect, it } from "vitest";
import {
  firstVisitTimelinePreference,
  formatCalendarRangeLabel,
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

  it("opens an old Timesheet link as the Calendar, keeping the date and scope", () => {
    expect(timelineStateFromSearchParams(
      new URLSearchParams("date=2026-07-22&scope=day&view=timesheet"),
      { now }
    )).toEqual({
      date: "2026-07-22",
      scope: "day",
      view: "calendar"
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
    expect(updateTimelinePreference({ scope: "day", view: "list" })).toEqual(preference);
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


  it("ignores a saved Timesheet preference (the view was removed)", () => {
    expect(timelinePreferenceFromCookieValue("timesheet:day")).toBeNull();
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now, preference: timelinePreferenceFromCookieValue("timesheet:day") })).toEqual({
      date: "2026-07-23",
      scope: "week",
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

describe("Calendar today from the viewer's zone (the server renders in UTC)", () => {
  it("opens a bare /timeline on the date the server worked out for the viewer", () => {
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now, today: "2026-07-24" }).date).toBe("2026-07-24");
    // An explicit date still wins, and an invalid hint falls back to the clock.
    expect(timelineStateFromSearchParams(new URLSearchParams("date=2026-07-01"), { now, today: "2026-07-24" }).date).toBe("2026-07-01");
    expect(timelineStateFromSearchParams(new URLSearchParams(), { now, today: "24/07/2026" }).date).toBe("2026-07-23");
  });

  it("reads Today from a date key, and never while today is unknown", () => {
    const ranges = resolveTimelineRanges({ date: "2026-07-23", scope: "day", view: "calendar" });
    expect(formatTimelinePeriodLabel("day", ranges, "2026-07-23")).toBe("Today");
    expect(formatTimelinePeriodLabel("day", ranges, null)).toBe("Thu, 23 Jul 2026");
    expect(formatTimelinePeriodLabel("day", ranges, "2026-07-24")).toBe("Thu, 23 Jul 2026");
  });
});

describe("Calendar on phones (owner-approved 17 Oct 2026)", () => {
  const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

  it("opens Day on a phone's first visit and keeps Week elsewhere", () => {
    expect(firstVisitTimelinePreference(iPhone)).toEqual({ lastView: "calendar", preferredScope: "day" });
    expect(firstVisitTimelinePreference(android)).toEqual({ lastView: "calendar", preferredScope: "day" });
    expect(firstVisitTimelinePreference(mac)).toBeNull();
    expect(firstVisitTimelinePreference(null)).toBeNull();
    expect(timelineStateFromSearchParams({}, { preference: firstVisitTimelinePreference(iPhone), today: "2026-10-17" }).scope).toBe("day");
    expect(timelineStateFromSearchParams({}, { preference: firstVisitTimelinePreference(mac), today: "2026-10-17" }).scope).toBe("week");
  });

  it("never overrides a scope in the address", () => {
    expect(timelineStateFromSearchParams({ scope: "week" }, { preference: firstVisitTimelinePreference(iPhone), today: "2026-10-17" }).scope).toBe("week");
  });
});

describe("the Calendar toolbar's date (UI review round 2, owner 30 Oct 2026)", () => {
  const ranges = (date: string) => resolveTimelineRanges({ date, scope: "week", view: "calendar" } as never);
  it("says a week as 26 Oct – 1 Nov and a day as Fri 30 Oct, the year only when it isn't this year", () => {
    expect(formatCalendarRangeLabel("week", ranges("2026-10-30"), "2026-10-30")).toBe("26 Oct – 1 Nov");
    expect(formatCalendarRangeLabel("day", ranges("2026-10-30"), "2026-10-30")).toBe("Fri 30 Oct");
    expect(formatCalendarRangeLabel("day", ranges("2025-10-30"), "2026-10-30")).toBe("Thu 30 Oct 2025");
    // A week across New Year names both years.
    expect(formatCalendarRangeLabel("week", ranges("2026-12-31"), "2026-12-31")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(formatCalendarRangeLabel("week", ranges("2025-10-01"), "2026-10-30")).toBe("29 Sept – 5 Oct 2025");
    expect(formatCalendarRangeLabel("day", ranges("2025-09-30"), "2026-10-30")).toBe("Tue 30 Sept 2025");
  });
});
