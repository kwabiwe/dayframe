import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  databaseReadinessError: vi.fn(),
  isUndefinedColumnError: vi.fn(),
  isUndefinedTableError: vi.fn(),
  missingRequiredColumnError: vi.fn(),
  query: vi.fn()
}));

const { buildDashboardDateRange, buildHourlySeries, buildWeekSeries } = await import("./queries");

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

function entry(startedAt: string, stoppedAt: string) {
  return { id: "entry", startedAt, stoppedAt } as Parameters<typeof buildWeekSeries>[0][number];
}

// The web Calendar's past weeks on a UTC server (Vercel) with a viewer in London (follow-up to #367,
// owner-approved 17 Oct 2026): the bootstrap's day and week start at the viewer's midnights when the
// browser sent its zone, and keep the server's when it did not (the iPhone never sends it).
describe("bootstrap day and week ranges", () => {
  it("starts a past week at the viewer's Monday midnight, so a block at 00:30 BST is inside it", () => {
    process.env.TZ = "UTC";
    const range = buildDashboardDateRange("2026-10-12", "Europe/London");
    expect(range).toEqual({
      selectedDate: "2026-10-12",
      previousDate: "2026-10-11",
      nextDate: "2026-10-13",
      dayStart: "2026-10-11T23:00:00.000Z",
      dayEnd: "2026-10-12T23:00:00.000Z",
      weekStart: "2026-10-11T23:00:00.000Z",
      weekEnd: "2026-10-18T23:00:00.000Z"
    });
    const block = new Date("2026-10-11T23:30:00.000Z"); // 00:30 BST on Monday 12 October
    expect(block >= new Date(range.weekStart) && block < new Date(range.weekEnd)).toBe(true);

    // Without the zone the UTC server's week begins an hour later and misses that block.
    const serverRange = buildDashboardDateRange("2026-10-12");
    expect(serverRange.weekStart).toBe("2026-10-12T00:00:00.000Z");
    expect(block >= new Date(serverRange.weekStart)).toBe(false);
  });

  it("gives the week the clocks go back in its 169 hours and keeps date-key days", () => {
    process.env.TZ = "UTC";
    const range = buildDashboardDateRange("2026-10-25", "Europe/London");
    expect(range.weekStart).toBe("2026-10-18T23:00:00.000Z");
    expect(range.weekEnd).toBe("2026-10-26T00:00:00.000Z");
    expect(range.dayStart).toBe("2026-10-24T23:00:00.000Z");
    expect(range.dayEnd).toBe("2026-10-26T00:00:00.000Z");
  });

  it("reads an instant or no date as the viewer's own day", () => {
    process.env.TZ = "UTC";
    expect(buildDashboardDateRange(new Date("2026-10-11T23:30:00Z"), "Europe/London").selectedDate).toBe("2026-10-12");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T23:45:00Z"));
    try {
      expect(buildDashboardDateRange(null, "Europe/London").selectedDate).toBe("2026-10-12");
      expect(buildDashboardDateRange(null).selectedDate).toBe("2026-10-11");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is unchanged without a zone, whatever the server's own zone", () => {
    process.env.TZ = "America/Los_Angeles";
    const range = buildDashboardDateRange("2026-10-12");
    expect(range.dayStart).toBe("2026-10-12T07:00:00.000Z");
    expect(range.weekStart).toBe("2026-10-12T07:00:00.000Z");
  });

  it("buckets the week series and the day's hours by the viewer's clock", () => {
    process.env.TZ = "UTC";
    const range = buildDashboardDateRange("2026-10-12", "Europe/London");
    const now = new Date("2026-10-20T12:00:00Z");
    const early = entry("2026-10-11T23:30:00.000Z", "2026-10-12T00:15:00.000Z"); // 00:30–01:15 BST Monday
    const week = buildWeekSeries([early], range, now, "Europe/London");
    expect(week.map((point) => point.key)).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"
    ]);
    expect(week[0]).toMatchObject({ label: "Mon", seconds: 45 * 60 });

    const morning = entry("2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z"); // 08:00–09:00 BST
    const hours = buildHourlySeries([morning], range, now, "Europe/London");
    expect(hours[0]).toMatchObject({ key: "8", seconds: 3600 });
  });
});
