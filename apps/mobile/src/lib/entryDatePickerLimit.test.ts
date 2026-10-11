import { describe, expect, it } from "vitest";
import { entryDatePickerMaxDate } from "./entryDatePickerLimit";

describe("entry sheet date picker limit (UIA-011)", () => {
  const now = new Date("2026-10-11T23:58:00");

  it("stops a running block's start at today", () => {
    expect(entryDatePickerMaxDate({ running: true, target: "start", now })).toBe(now);
  });

  it("leaves a finished block's start and end open, so an overnight end after midnight stays choosable", () => {
    expect(entryDatePickerMaxDate({ running: false, target: "end", now })).toBeNull();
    expect(entryDatePickerMaxDate({ running: false, target: "start", now })).toBeNull();
  });
});
