import { describe, expect, it, vi } from "vitest";
import { clearLocaleDateFormats, currentTimeZoneId, formatLocaleDate } from "./localeDateFormat";

describe("formatLocaleDate", () => {
  const date = new Date(2026, 9, 12, 18, 45);
  it.each([
    { weekday: "narrow" },
    { weekday: "long", day: "numeric", month: "long" },
    { day: "numeric", month: "short" },
    { month: "long" }
  ] as Intl.DateTimeFormatOptions[])("matches toLocaleDateString for %j", (options) => {
    expect(formatLocaleDate(date, options)).toBe(date.toLocaleDateString(undefined, options));
  });
  it("builds one formatter per option set", () => {
    const Original = Intl.DateTimeFormat;
    let created = 0;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation((function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      created += 1;
      return new Original(...args);
    }) as never);
    for (let day = 1; day <= 30; day += 1) formatLocaleDate(new Date(2026, 8, day), { weekday: "short", day: "2-digit" });
    expect(created).toBe(1);
    spy.mockRestore();
  });
  it("never reuses a formatter between zones that share an offset (Codex r2 on #374)", () => {
    const original = process.env.TZ;
    vi.useFakeTimers();
    try {
      // London and Lagos are both UTC+1 in summer; January differs (London is UTC+0).
      process.env.TZ = "Europe/London";
      clearLocaleDateFormats();
      formatLocaleDate(new Date(2026, 6, 1), { month: "short" });
      process.env.TZ = "Africa/Lagos";
      // No clear: only the throttled zone re-read (30 s) separates the two zones' formatters.
      vi.setSystemTime(Date.now() + 31_000);
      const january = new Date(2026, 0, 1, 0, 30);
      expect(formatLocaleDate(january, { month: "short" })).toBe(january.toLocaleDateString(undefined, { month: "short" }));
    } finally {
      vi.useRealTimers();
      process.env.TZ = original;
      clearLocaleDateFormats();
    }
  });
  it("never reuses a formatter across a time-zone change (Codex r1 on #374)", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      clearLocaleDateFormats();
      formatLocaleDate(new Date(2026, 9, 12, 12), { weekday: "long" });
      process.env.TZ = "Asia/Tokyo";
      // The zone changed while the app was away; returning to the foreground clears the cache.
      clearLocaleDateFormats();
      const tuesdayMidnight = new Date(2026, 9, 13, 0, 0);
      expect(formatLocaleDate(tuesdayMidnight, { weekday: "long" })).toBe(tuesdayMidnight.toLocaleDateString(undefined, { weekday: "long" }));
    } finally {
      process.env.TZ = original;
      clearLocaleDateFormats();
    }
  });

  it("follows a zone change with a different UTC offset at once, without waiting for the 30 s recheck", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Europe/London";
      const now = Date.parse("2026-08-14T12:00:00Z");
      expect(currentTimeZoneId(now)).toBe("Europe/London");
      process.env.TZ = "America/New_York";
      expect(currentTimeZoneId(now + 1_000)).toBe("America/New_York");
    } finally {
      process.env.TZ = original;
      clearLocaleDateFormats();
    }
  });
});
