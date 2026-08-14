import { describe, expect, it } from "vitest";
import { buildCalendarGrid, maskTimeInput, parseTimeInput } from "./calendar-grid";

describe("calendar grid", () => {
  it("always returns six complete weeks with selectable adjacent-month dates", () => {
    const july = buildCalendarGrid(2026, 7);
    const august = buildCalendarGrid(2026, 8);

    expect(july).toHaveLength(42);
    expect(august).toHaveLength(42);
    expect(july[0]).toMatchObject({ date: "2026-06-28", inCurrentMonth: false });
    expect(july.at(-1)).toMatchObject({ date: "2026-08-08", inCurrentMonth: false });
    expect(august[0]).toMatchObject({ date: "2026-07-26", inCurrentMonth: false });
    expect(august.at(-1)).toMatchObject({ date: "2026-09-05", inCurrentMonth: false });
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
