import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReportsRanges, reportWindowQuality } from "./reportsRanges";

describe("Reports local ranges and source coverage", () => {
  const originalTimezone = process.env.TZ;
  beforeAll(() => { process.env.TZ = "Europe/London"; });
  afterAll(() => { process.env.TZ = originalTimezone; });

  it("builds seven contiguous calendar days without assuming fixed milliseconds", () => {
    const ranges = buildReportsRanges(new Date(2026, 2, 29, 12).getTime());
    expect(ranges.weekDays).toHaveLength(7);
    for (let index = 1; index < ranges.weekDays.length; index += 1) {
      expect(ranges.weekDays[index - 1].end.getTime()).toBe(ranges.weekDays[index].start.getTime());
    }
  });

  it("preserves 23-hour and 25-hour local days across DST", () => {
    const spring = buildReportsRanges(new Date(2026, 2, 29, 12).getTime()).today;
    const autumn = buildReportsRanges(new Date(2026, 9, 25, 12).getTime()).today;
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1000);
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("distinguishes complete, partial, and metadata-free windows", () => {
    const required = { start: new Date("2026-09-07T00:00:00.000Z"), end: new Date("2026-09-14T00:00:00.000Z") };
    const base = {
      capturedAt: "2026-09-08T12:00:00.000Z",
      dayEntries: { from: "2026-09-08T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 100, hasMore: false },
      weekEntries: { from: required.start.toISOString(), toExclusive: required.end.toISOString(), limit: 300, hasMore: false },
      historyEntries: { from: "2026-07-01T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 2000, hasMore: false }
    };
    expect(reportWindowQuality(undefined, required)).toBe("unknown");
    expect(reportWindowQuality(base, required)).toBe("complete");
    expect(reportWindowQuality({ ...base, weekEntries: { ...base.weekEntries, hasMore: true }, historyEntries: { ...base.historyEntries, hasMore: true } }, required)).toBe("partial");
  });

  it("does not mistake a gap between complete windows for complete coverage", () => {
    const required = { start: new Date("2026-09-07T00:00:00.000Z"), end: new Date("2026-09-14T00:00:00.000Z") };
    expect(reportWindowQuality({
      capturedAt: "2026-09-08T12:00:00.000Z",
      dayEntries: { from: "2026-09-07T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 100, hasMore: false },
      weekEntries: { from: "2026-09-10T00:00:00.000Z", toExclusive: "2026-09-14T00:00:00.000Z", limit: 300, hasMore: false },
      historyEntries: { from: "2026-07-01T00:00:00.000Z", toExclusive: "2026-09-07T00:00:00.000Z", limit: 2000, hasMore: false }
    }, required)).toBe("partial");
  });
});
