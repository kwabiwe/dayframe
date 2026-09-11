import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  const originalTimezone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "Europe/London";
  });
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });
  it.each(["2026-03-29", "2026-10-25"])(
    "keeps DST day %s as one bucket with its actual duration",
    (key) => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        "Europe/London",
      );
      const now = +parseLocalDate(key)! + 12 * 3_600_000;
      const range = buildReportRange({ start: key, end: key }, now);
      expect(range.buckets).toHaveLength(1);
      expect((+range.end - +range.start) / 3_600_000).toBe(
        key.includes("03-29") ? 23 : 25,
      );
      expect(range.bucketUnit).toBe("day");
      expect(range.axisLayout).toBe("single-day");
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
        count <= 31 ? count : count <= 180 ? 27 : 13,
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
    expect(buildReportRange("week", +new Date(2024, 1, 20))).toMatchObject({
      bucketUnit: "day",
      axisLayout: "week",
    });
    expect(buildReportRange("year", +new Date(2024, 1, 20))).toMatchObject({
      bucketUnit: "month",
      axisLayout: "year",
    });
  });
  it("keeps full future portions of presets while custom future dates remain invalid", () => {
    const now = +new Date(2026, 8, 11, 10);
    const week = buildReportRange("week", now);
    const month = buildReportRange("month", now);
    const year = buildReportRange("year", now);
    expect(formatLocalDateKey(addLocalDays(week.end, -1))).toBe("2026-09-13");
    expect(formatLocalDateKey(addLocalDays(month.end, -1))).toBe("2026-09-30");
    expect(formatLocalDateKey(addLocalDays(year.end, -1))).toBe("2026-12-31");
    expect(validateCustomRange("2026-09-11", "2026-09-12", now).error).toContain(
      "Future",
    );
  });
});
