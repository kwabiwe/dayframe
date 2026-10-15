import { describe, expect, it } from "vitest";
import {
  initialReportRangeDraft,
  nextReportRangeDraft,
  reportRangeDraftComplete,
  reportRangeDraftBounds,
  reportRangeDraftCaption,
  reportRangeDraftDayCount
} from "@/lib/report-range-draft";

describe("Reports custom range draft (date-picker audit, 14 Oct 2026)", () => {
  it("takes first then last day, swaps a reversed pair, and restarts on a third tap", () => {
    const first = nextReportRangeDraft({ start: "2026-10-05", end: "2026-10-11" }, "2026-10-08");
    expect(first).toEqual({ start: "2026-10-08", end: null });
    expect(nextReportRangeDraft(first, "2026-10-03")).toEqual({ start: "2026-10-03", end: "2026-10-08" });
    expect(nextReportRangeDraft(first, "2026-10-09")).toEqual({ start: "2026-10-08", end: "2026-10-09" });
    expect(nextReportRangeDraft(first, "2026-10-08")).toEqual({ start: "2026-10-08", end: "2026-10-08" });
  });

  it("caps choosable days at today and at 366 inclusive days from the first", () => {
    expect(reportRangeDraftBounds({ start: "2026-10-01", end: "2026-10-03" }, "2026-10-14")).toEqual({ min: null, max: "2026-10-14" });
    expect(reportRangeDraftBounds({ start: "2026-10-01", end: null }, "2026-10-14")).toEqual({ min: "2025-10-01", max: "2026-10-14" });
    const old = reportRangeDraftBounds({ start: "2024-01-01", end: null }, "2026-10-14");
    expect(old.max).toBe("2024-12-31");
    expect(reportRangeDraftDayCount({ start: "2024-01-01", end: old.max })).toBe(366);
    expect(reportRangeDraftDayCount({ start: old.min!, end: "2024-01-01" })).toBe(366);
  });

  it("opens on the range up to today and offers Done only for a whole range within the limits", () => {
    expect(initialReportRangeDraft("2026-10-12", "2026-10-18", "2026-10-15")).toEqual({ start: "2026-10-12", end: "2026-10-15" });
    expect(initialReportRangeDraft("2026-10-01", "2026-10-03", "2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-03" });
    expect(initialReportRangeDraft("2026-10-16", "2026-10-18", "2026-10-15")).toEqual({ start: "2026-10-15", end: null });
    expect(reportRangeDraftComplete({ start: "2026-10-01", end: "2026-10-15" }, "2026-10-15")).toBe(true);
    expect(reportRangeDraftComplete({ start: "2026-10-01", end: null }, "2026-10-15")).toBe(false);
    expect(reportRangeDraftComplete({ start: "2026-10-01", end: "2026-10-16" }, "2026-10-15")).toBe(false);
    expect(reportRangeDraftComplete({ start: "2025-10-14", end: "2026-10-14" }, "2026-10-15")).toBe(true);
    expect(reportRangeDraftComplete({ start: "2025-10-13", end: "2026-10-14" }, "2026-10-15")).toBe(false);
  });

  it("counts calendar days across a clock change", () => {
    expect(reportRangeDraftDayCount({ start: "2026-10-24", end: "2026-10-26" })).toBe(3);
    expect(reportRangeDraftDayCount({ start: "2026-10-24", end: null })).toBeNull();
  });

  it("captions the range for its month and year", () => {
    expect(reportRangeDraftCaption({ start: "2026-10-03", end: "2026-10-09" })).toBe("3 – 9 Oct 2026 · 7 days");
    expect(reportRangeDraftCaption({ start: "2026-09-28", end: "2026-10-04" })).toBe("28 Sept – 4 Oct 2026 · 7 days");
    expect(reportRangeDraftCaption({ start: "2025-12-29", end: "2026-01-04" })).toBe("29 Dec 2025 – 4 Jan 2026 · 7 days");
    expect(reportRangeDraftCaption({ start: "2026-10-09", end: "2026-10-09" })).toBe("Fri 9 Oct 2026 · 1 day");
    expect(reportRangeDraftCaption({ start: "2026-10-03", end: null })).toBe("From Sat 3 Oct · tap the last day");
  });
});
