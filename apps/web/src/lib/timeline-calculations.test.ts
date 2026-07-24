import { describe, expect, it } from "vitest";
import type { TimeEntryRow } from "./queries";
import {
  buildTimelineTimesheetRows,
  clipTimelineEntries,
  mergeTimelineEntries,
  timelineDailyTotals,
  timelineEntryDisplayInterval
} from "./timeline-calculations";

const weekDays = Array.from({ length: 7 }, (_, index) => localDate(2026, 7, 20 + index));
const capturedNow = localDate(2026, 7, 23, 18);
const weekRange = { start: weekDays[0], end: localDate(2026, 7, 27) };

describe("Timeline period calculations", () => {
  it("clips the same entry collection used by Calendar and List", () => {
    const entries = [
      entry("inside", localDate(2026, 7, 23, 9), localDate(2026, 7, 23, 10)),
      entry("before", localDate(2026, 7, 19, 22), localDate(2026, 7, 20, 2)),
      entry("after", localDate(2026, 7, 26, 23), localDate(2026, 7, 27, 2)),
      entry("outside", localDate(2026, 7, 19, 9), localDate(2026, 7, 19, 10))
    ];

    expect(clipTimelineEntries(entries, weekRange, capturedNow).map(({ id, durationSeconds }) => ({
      id,
      durationSeconds
    }))).toEqual([
      { id: "after", durationSeconds: 3600 },
      { id: "inside", durationSeconds: 3600 },
      { id: "before", durationSeconds: 7200 }
    ]);
  });

  it("lets current runtime rows replace stale cached range rows", () => {
    const cached = entry("shared", localDate(2026, 7, 23, 9), null);
    const current = entry("shared", localDate(2026, 7, 23, 9), localDate(2026, 7, 23, 10));
    expect(mergeTimelineEntries([cached], [current])).toEqual([current]);
  });

  it("splits a cross-midnight entry across both Timesheet days", () => {
    const rows = buildTimelineTimesheetRows([
      entry("crossing", localDate(2026, 7, 22, 23, 30), localDate(2026, 7, 23, 1, 30))
    ], weekDays, capturedNow);

    expect(rows[0].days).toEqual([0, 0, 1800, 5400, 0, 0, 0]);
    expect(rows[0].total).toBe(7200);
    expect(timelineDailyTotals(rows, 7)).toEqual([0, 0, 1800, 5400, 0, 0, 0]);
  });

  it("clips List display times without changing the editable entry interval", () => {
    const crossing = entry(
      "crossing",
      localDate(2026, 7, 22, 23, 30),
      localDate(2026, 7, 23, 1, 30)
    );
    const interval = timelineEntryDisplayInterval(crossing, {
      start: localDate(2026, 7, 23),
      end: localDate(2026, 7, 24)
    }, capturedNow);

    expect(interval).toEqual({
      startedAt: localDate(2026, 7, 23).toISOString(),
      stoppedAt: localDate(2026, 7, 23, 1, 30).toISOString()
    });
    expect(crossing.startedAt).toBe(localDate(2026, 7, 22, 23, 30).toISOString());
  });

  it("labels a running List slice as stopped at the selected historical boundary", () => {
    const interval = timelineEntryDisplayInterval(
      entry("running", localDate(2026, 7, 22, 23), null),
      { start: localDate(2026, 7, 22), end: localDate(2026, 7, 23) },
      capturedNow
    );
    expect(interval.stoppedAt).toBe(localDate(2026, 7, 23).toISOString());
  });

  it("uses the same captured current time for running row and daily totals", () => {
    const rows = buildTimelineTimesheetRows([
      entry("running", localDate(2026, 7, 23, 16), null)
    ], weekDays, capturedNow);
    expect(rows[0].total).toBe(7200);
    expect(timelineDailyTotals(rows, 7)[3]).toBe(7200);
  });

  it("keeps category totals internally consistent", () => {
    const rows = buildTimelineTimesheetRows([
      entry("one", localDate(2026, 7, 23, 9), localDate(2026, 7, 23, 10)),
      entry("two", localDate(2026, 7, 24, 9), localDate(2026, 7, 24, 10))
    ], weekDays, capturedNow);
    const dailyTotals = timelineDailyTotals(rows, 7);
    expect(rows[0].total).toBe(7200);
    expect(dailyTotals.reduce((sum, seconds) => sum + seconds, 0)).toBe(rows[0].total);
  });
});

function entry(id: string, startedAt: Date, stoppedAt: Date | null): TimeEntryRow {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "category-1",
    categoryName: "Work",
    categoryColor: "blue",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: id,
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt?.toISOString() ?? null,
    durationSeconds: stoppedAt ? Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000) : 0,
    tagNames: [],
    tags: []
  };
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute);
}
