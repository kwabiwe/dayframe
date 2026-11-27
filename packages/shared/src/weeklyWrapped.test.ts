import { describe, expect, it } from "vitest";
import { buildWeeklyWrapped } from "./weeklyWrapped";

describe("Weekly Wrapped reporting projection", () => {
  const activity = { id: "work", name: "Work", color: "coral" };
  const day = (key: string, seconds = 0, future = false) => ({
    key, label: key, shortLabel: key[0], future, activities: [{ id: activity.id, seconds }]
  });

  it("reuses daily allocations, excludes future days and identifies a single busiest day", () => {
    const week = buildWeeklyWrapped([day("Monday", 90), day("Tuesday", 30), day("Wednesday", 500, true)], [activity]);
    expect(week.totalSeconds).toBe(120);
    expect(week.trackedDays).toBe(2);
    expect(week.busiest?.key).toBe("Monday");
    expect(week.activities).toEqual([{ ...activity, seconds: 120, share: 1 }]);
    expect(week.columns[2].segments).toEqual([]);
  });

  it("omits a busiest day when the week is empty or tied", () => {
    expect(buildWeeklyWrapped([day("Monday")], [activity])).toMatchObject({ busiest: null, totalSeconds: 0, activities: [] });
    expect(buildWeeklyWrapped([day("Monday", 30), day("Tuesday", 30)], [activity]).busiest).toBeNull();
  });
});
