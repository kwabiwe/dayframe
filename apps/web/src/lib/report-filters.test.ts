import { afterEach, describe, expect, it } from "vitest";
import {
  REPORT_MAX_RANGE_DAYS,
  defaultReportFilters,
  filtersForCustomRange,
  filtersForPreset,
  parseReportQueryInput,
  serializeReportFilters,
  shiftReportRange
} from "./report-filters";

const now = new Date(2026, 6, 22, 12);
const categoryA = "20000000-0000-4000-8000-000000000001";
const categoryB = "20000000-0000-4000-8000-000000000002";
const tagA = "30000000-0000-4000-8000-000000000001";
const placeA = "40000000-0000-4000-8000-000000000001";
const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

describe("report filter URL model", () => {
  it("defaults to the current Monday-to-Sunday week with no filters", () => {
    const input = parseReportQueryInput({}, { now });
    expect(input.filters).toEqual(expect.objectContaining({
      range: "this-week",
      from: "2026-07-20",
      to: "2026-07-26",
      categories: [],
      tags: [],
      places: [],
      sources: [],
      description: "",
      sort: "newest",
      page: 1
    }));
    expect(input.range.dayCount).toBe(7);
    expect(input.dayBoundaries).toHaveLength(7);
  });

  it.each([
    ["today", "2026-07-22", "2026-07-22"],
    ["yesterday", "2026-07-21", "2026-07-21"],
    ["this-week", "2026-07-20", "2026-07-26"],
    ["last-week", "2026-07-13", "2026-07-19"],
    ["last-7-days", "2026-07-16", "2026-07-22"],
    ["this-month", "2026-07-01", "2026-07-31"],
    ["last-month", "2026-06-01", "2026-06-30"],
    ["last-30-days", "2026-06-23", "2026-07-22"]
  ] as const)("resolves the %s preset", (range, from, to) => {
    const input = parseReportQueryInput({ range }, { now });
    expect(input.filters).toEqual(expect.objectContaining({ range, from, to }));
  });

  it("treats the visible custom end date as inclusive and the server end as exclusive", () => {
    const input = parseReportQueryInput({ range: "custom", from: "2026-07-20", to: "2026-07-22" }, { now });
    const exclusiveEnd = new Date(input.range.end);
    expect(input.filters.to).toBe("2026-07-22");
    expect([exclusiveEnd.getFullYear(), exclusiveEnd.getMonth() + 1, exclusiveEnd.getDate()]).toEqual([2026, 7, 23]);
    expect(input.range.dayCount).toBe(3);
  });

  it("shifts a custom range by its full duration while preserving every non-date filter", () => {
    const base = parseReportQueryInput({
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-03",
      categories: categoryA,
      tags: tagA,
      description: " school "
    }, { now }).filters;

    expect(shiftReportRange(base, "previous")).toEqual(expect.objectContaining({
      from: "2026-06-28",
      to: "2026-06-30",
      categories: [categoryA],
      tags: [tagA],
      description: "school"
    }));
    expect(shiftReportRange(base, "next")).toEqual(expect.objectContaining({
      from: "2026-07-04",
      to: "2026-07-06",
      categories: [categoryA]
    }));
  });

  it("round-trips all supported filters through one canonical serializer", () => {
    const filters = parseReportQueryInput({
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-03",
      categories: `${categoryA},${categoryB},uncategorized`,
      tags: tagA,
      places: `${placeA},no-place`,
      sources: "manual_app,mobile_app",
      description: "school pickup",
      sort: "duration",
      page: "3"
    }, { now }).filters;
    const serialized = serializeReportFilters(filters);
    const reparsed = parseReportQueryInput(Object.fromEntries(new URLSearchParams(serialized)), { now }).filters;
    expect(reparsed).toEqual(filters);
  });

  it("handles invalid values safely and de-duplicates valid values", () => {
    const input = parseReportQueryInput({
      range: "not-a-range",
      categories: `bad,${categoryA},${categoryA}`,
      tags: "also-bad",
      places: "other-workspace-looking-but-invalid",
      sources: "manual_app,raw_unknown_source",
      page: "-50"
    }, { now });
    expect(input.filters).toEqual(expect.objectContaining({
      range: "this-week",
      categories: [categoryA],
      tags: [],
      places: [],
      sources: ["manual_app"],
      page: 1
    }));
  });

  it("normalizes provisional Dashboard links without losing category intent", () => {
    const input = parseReportQueryInput({ period: "day", start: "2026-07-22", categories: categoryA }, { now });
    expect(input.filters).toEqual(expect.objectContaining({
      range: "custom",
      from: "2026-07-22",
      to: "2026-07-22",
      categories: [categoryA]
    }));
  });

  it("caps custom ranges at the documented one-year maximum", () => {
    const input = parseReportQueryInput({ range: "custom", from: "2025-01-01", to: "2026-12-31" }, { now });
    expect(input.range.dayCount).toBe(REPORT_MAX_RANGE_DAYS);
    expect(input.range.wasClamped).toBe(true);
    expect(input.dayBoundaries).toHaveLength(REPORT_MAX_RANGE_DAYS);
  });

  it("builds DST-safe local day boundaries", () => {
    process.env.TZ = "Europe/London";
    const input = parseReportQueryInput({ range: "custom", from: "2026-03-29", to: "2026-03-29" }, { now });
    expect(input.dayBoundaries[0].key).toBe("2026-03-29");
    expect(new Date(input.dayBoundaries[0].end).getTime() - new Date(input.dayBoundaries[0].start).getTime()).toBe(23 * 3_600_000);
  });

  it("reconstructs independent history states for browser Back and Forward", () => {
    const initial = filtersForPreset(defaultReportFilters(now), "today", now);
    const filtered = { ...initial, categories: [categoryA], tags: [tagA] };
    const custom = filtersForCustomRange(filtered, "2026-07-01", "2026-07-04");

    const history = [initial, filtered, custom].map((filters) =>
      parseReportQueryInput(Object.fromEntries(new URLSearchParams(serializeReportFilters(filters))), { now }).filters
    );
    expect(history).toEqual([initial, filtered, custom]);
  });
});
