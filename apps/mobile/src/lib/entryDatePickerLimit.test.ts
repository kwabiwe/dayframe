import { describe, expect, it } from "vitest";
import { entryDatePickerMaxDate } from "./entryDatePickerLimit";

describe("entry sheet date limit (owner decision D2, 14 Oct 2026)", () => {
  it("stops every start and end, running or finished, at today", () => {
    const now = new Date("2026-10-11T23:58:00");
    expect(entryDatePickerMaxDate(now)).toBe(now);
  });
});
