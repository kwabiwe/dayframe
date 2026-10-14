import { describe, expect, it } from "vitest";
import { addCalendarDays, buildCalendarGrid, CALENDAR_WEEKDAY_LABELS, maskTimeInput, parseTimeInput } from "./calendar-grid";

describe("calendar grid", () => {
  it("always returns six complete Monday-first weeks with selectable adjacent-month dates (D4)", () => {
    const july = buildCalendarGrid(2026, 7);
    const august = buildCalendarGrid(2026, 8);
    const june = buildCalendarGrid(2026, 6);

    expect(july).toHaveLength(42);
    expect(august).toHaveLength(42);
    // 1 July 2026 is a Wednesday: the grid starts on Monday 29 June.
    expect(july[0]).toMatchObject({ date: "2026-06-29", inCurrentMonth: false });
    expect(july.at(-1)).toMatchObject({ date: "2026-08-09", inCurrentMonth: false });
    // 1 August 2026 is a Saturday: Monday 27 July.
    expect(august[0]).toMatchObject({ date: "2026-07-27", inCurrentMonth: false });
    expect(august.at(-1)).toMatchObject({ date: "2026-09-06", inCurrentMonth: false });
    // 1 June 2026 is a Monday: the month starts the grid.
    expect(june[0]).toMatchObject({ date: "2026-06-01", inCurrentMonth: true });
    expect(CALENDAR_WEEKDAY_LABELS).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  });

  it("adds local calendar days across months and the clock change", () => {
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-10-25", -1)).toBe("2026-10-24");
    expect(addCalendarDays("2026-03-29", 1)).toBe("2026-03-30");
  });
});

describe("time input", () => {
  it("keeps typed digits stable and normalises compact values on commit", () => {
    expect(maskTimeInput("725")).toBe("725");
    expect(maskTimeInput("1025")).toBe("1025");
    expect(maskTimeInput("10:25")).toBe("10:25");
    expect(parseTimeInput("725")).toBe("07:25");
    expect(parseTimeInput("1025")).toBe("10:25");
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("2345")).toBe("23:45");
  });

  it("rejects times that cannot be inferred safely", () => {
    expect(parseTimeInput("2460")).toBeNull();
    expect(parseTimeInput("12:99")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });
});
