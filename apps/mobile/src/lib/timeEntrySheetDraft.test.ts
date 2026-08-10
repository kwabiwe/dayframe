import { describe, expect, it } from "vitest";
import {
  selectionAfterDescriptionChange,
  timeEntrySheetLayoutDensity,
  timeEntrySheetDraftHasChanges,
  type TimeEntrySheetDraftSnapshot
} from "./timeEntrySheetDraft";

const baseline: TimeEntrySheetDraftSnapshot = {
  categoryId: "work",
  dateText: "2026-08-08",
  description: "Plan",
  stoppedDateText: "2026-08-08",
  stoppedTimeText: "10:30",
  tagNames: ["Focus"],
  timeText: "10:00"
};

describe("time-entry sheet draft helpers", () => {
  it("ignores the running end while detecting genuine editable changes", () => {
    expect(timeEntrySheetDraftHasChanges({
      baseline,
      current: { ...baseline, stoppedTimeText: "10:31" },
      includeStoppedTime: false
    })).toBe(false);
    expect(timeEntrySheetDraftHasChanges({
      baseline,
      current: { ...baseline, timeText: "09:55" },
      includeStoppedTime: false
    })).toBe(true);
  });

  it("detects stopped-entry end changes and normalizes tag identity", () => {
    expect(timeEntrySheetDraftHasChanges({
      baseline,
      current: { ...baseline, tagNames: [" focus "] },
      includeStoppedTime: true
    })).toBe(false);
    expect(timeEntrySheetDraftHasChanges({
      baseline,
      current: { ...baseline, stoppedTimeText: "10:35" },
      includeStoppedTime: true
    })).toBe(true);
  });

  it("selects fixed-layout density from available height and Dynamic Type", () => {
    expect(timeEntrySheetLayoutDensity({
      fontScale: 1,
      windowHeight: 844
    })).toBe("regular");
    expect(timeEntrySheetLayoutDensity({
      fontScale: 1,
      windowHeight: 740
    })).toBe("compact");
    expect(timeEntrySheetLayoutDensity({
      fontScale: 1.3,
      windowHeight: 844
    })).toBe("compact");
    expect(timeEntrySheetLayoutDensity({
      fontScale: 1.6,
      windowHeight: 844
    })).toBe("condensed");
  });

  it("tracks the native caret after inserting or deleting text", () => {
    expect(selectionAfterDescriptionChange({
      nextText: "Plan#",
      previousSelection: { start: 4, end: 4 },
      previousText: "Plan"
    })).toEqual({ start: 5, end: 5 });
    expect(selectionAfterDescriptionChange({
      nextText: "Pan",
      previousSelection: { start: 2, end: 2 },
      previousText: "Plan"
    })).toEqual({ start: 1, end: 1 });
  });
});
