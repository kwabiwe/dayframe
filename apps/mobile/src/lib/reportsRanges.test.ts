import { describe, expect, it } from "vitest";
import { ReportSummaryRequestSchema } from "@dayframe/shared";
import {
  addLocalDays,
  buildReportRange,
  calendarDayCount,
  formatLocalDateKey,
  parseLocalDate,
  validateCustomRange,
} from "./reportsRanges";

describe("Revision 2 local report ranges", () => {
  it.each(["2026-03-29", "2026-10-25"])(
    "partitions DST day %s into actual clock hours",
    (key) => {
      // Run this suite with TZ=Europe/London; no runtime TZ mutation in worker threads.
      const now = +parseLocalDate(key)! + 12 * 3_600_000;
      const range = buildReportRange({ start: key, end: key }, now);
      expect(range.buckets.length).toBe(
        (+range.end - +range.start) / 3_600_000,
      );
      if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/London")
        expect(range.buckets.length).toBe(key.includes("03-29") ? 23 : 25);
      expect(new Set(range.buckets.map((b) => b.key)).size).toBe(
        range.buckets.length,
      );
      expect(ReportSummaryRequestSchema.safeParse(range.request).success).toBe(
        true,
      );
    },
  );
  it.each([1, 2, 31, 32, 180, 181, 366])(
    "builds a valid exact %s-day custom partition",
    (count) => {
      const start = new Date(2025, 0, 1);
      const end = addLocalDays(start, count - 1);
      const range = buildReportRange(
        { start: formatLocalDateKey(start), end: formatLocalDateKey(end) },
        +new Date(2027, 0, 1),
      );
      expect(calendarDayCount(range.start, addLocalDays(range.end, -1))).toBe(
        count,
      );
      expect(ReportSummaryRequestSchema.safeParse(range.request).success).toBe(
        true,
      );
      expect(range.buckets[0].start).toEqual(range.start);
      expect(range.buckets.at(-1)?.end).toEqual(range.end);
      expect(range.buckets.length).toBeLessThanOrEqual(
        count === 1 ? 25 : count <= 31 ? 31 : count <= 180 ? 27 : 13,
      );
    },
  );
  it("normalizes reverse/same-day selection, rejects future/invalid/367 days", () => {
    const now = +new Date(2026, 11, 31);
    expect(validateCustomRange("2026-09-09", "2026-09-01", now).value).toEqual({
      start: "2026-09-01",
      end: "2026-09-09",
    });
    expect(
      validateCustomRange("2026-09-09", "2026-09-09", now).value,
    ).toBeDefined();
    expect(
      validateCustomRange("2026-01-01", "2027-01-02", +new Date(2027, 1, 1))
        .error,
    ).toContain("366");
    expect(
      validateCustomRange("2026-12-31", "2027-01-01", now).error,
    ).toContain("Future");
    expect(parseLocalDate("2026-02-30")).toBeNull();
  });
  it("uses Monday week, calendar month and leap calendar year", () => {
    expect(
      buildReportRange("week", +new Date(2026, 8, 13)).start.getDay(),
    ).toBe(1);
    expect(
      buildReportRange("month", +new Date(2024, 1, 20)).buckets,
    ).toHaveLength(29);
    expect(
      buildReportRange("year", +new Date(2024, 1, 20)).buckets,
    ).toHaveLength(12);
    expect(
      buildReportRange("year", +new Date(2024, 1, 20))
        .buckets.filter((b) => b.label)
        .map((b) => b.start.getMonth()),
    ).toEqual([0, 3, 6, 9]);
  });
});
