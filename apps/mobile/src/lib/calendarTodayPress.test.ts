import { describe, expect, it } from "vitest";
import { calendarTodayPressAction, nowRowKey } from "./calendarTodayPress";

describe("the Calendar header's Today pill", () => {
  it("goes to today from another day, keeping the layout out of it", () => {
    for (const layout of ["grid", "list"] as const) {
      expect(calendarTodayPressAction({ layout, selectedDayKey: "2026-10-29", todayKey: "2026-10-30" })).toBe("go-to-today");
    }
  });

  it("scrolls to now on today, in the layout showing", () => {
    expect(calendarTodayPressAction({ layout: "grid", selectedDayKey: "2026-10-30", todayKey: "2026-10-30" })).toBe("scroll-grid-to-now");
    expect(calendarTodayPressAction({ layout: "list", selectedDayKey: "2026-10-30", todayKey: "2026-10-30" })).toBe("scroll-list-to-now");
  });
});

describe("the List's row for now", () => {
  const rows = [{ key: "a", atMs: 100 }, { key: "b", atMs: 200 }, { key: "c", atMs: 300 }];

  it("is the last row to have started", () => {
    expect(nowRowKey(rows, 250)).toBe("b");
    expect(nowRowKey(rows, 200)).toBe("b");
    expect(nowRowKey(rows, 999)).toBe("c");
  });

  it("is the first row before the day's first, and none on an empty day", () => {
    expect(nowRowKey(rows, 50)).toBe("a");
    expect(nowRowKey([], 50)).toBeNull();
  });
});
