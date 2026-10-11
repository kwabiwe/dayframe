import { describe, expect, it } from "vitest";
import type { TimeEntryRow } from "./queries";
import {
  clipTimelineEntries,
  mergeTimelineEntries,
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
    updatedAt: startedAt.toISOString(),
    durationSeconds: stoppedAt ? Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000) : 0,
    tagNames: [],
    tags: []
  };
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute);
}
