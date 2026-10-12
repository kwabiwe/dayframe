import { afterEach, describe, expect, it } from "vitest";
import {
  FALLBACK_TIME_ZONE,
  normalizeViewerTimeZone,
  syncViewerTimeZoneCookie,
  viewerTimeZoneCookie,
  viewerTimeZoneFromCookieHeader,
  zonedDateKey,
  zonedStartOfDay
} from "./viewer-time-zone";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("the viewer's time zone cookie", () => {
  it("accepts a zone this runtime knows, in its canonical spelling", () => {
    expect(normalizeViewerTimeZone("Europe/London")).toBe("Europe/London");
    expect(normalizeViewerTimeZone(" europe/london ")).toBe("Europe/London");
    expect(normalizeViewerTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to UTC for a missing, unknown or malformed value", () => {
    expect(FALLBACK_TIME_ZONE).toBe("UTC");
    for (const value of [undefined, null, "", "Mars/Olympus_Mons", "Europe/London; Path=/", "../../etc", "x".repeat(65), 42]) {
      expect(normalizeViewerTimeZone(value)).toBe("UTC");
    }
  });

  it("reads and writes the first-party cookie", () => {
    expect(viewerTimeZoneCookie("Europe/London")).toBe("dayframe_tz=Europe/London; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(viewerTimeZoneCookie("Europe/London", true)).toBe("dayframe_tz=Europe/London; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(viewerTimeZoneFromCookieHeader("theme=dark; dayframe_tz=Europe/London; other=1")).toBe("Europe/London");
    expect(viewerTimeZoneFromCookieHeader("theme=dark")).toBeNull();
    expect(viewerTimeZoneFromCookieHeader(null)).toBeNull();
  });

  it("writes the browser's zone only when the cookie is missing or different", () => {
    process.env.TZ = "Europe/London";
    const doc = { cookie: "" };
    expect(syncViewerTimeZoneCookie(doc)).toBe(true);
    expect(doc.cookie).toBe("dayframe_tz=Europe/London; Path=/; Max-Age=31536000; SameSite=Lax");
    const current = { cookie: "dayframe_tz=Europe/London" };
    expect(syncViewerTimeZoneCookie(current)).toBe(false);
    expect(current.cookie).toBe("dayframe_tz=Europe/London");
    const travelled = { cookie: "dayframe_tz=America/New_York" };
    expect(syncViewerTimeZoneCookie(travelled, true)).toBe(true);
    // Secure over HTTPS; plain-HTTP local development keeps a cookie it can send.
    expect(travelled.cookie).toBe("dayframe_tz=Europe/London; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });
});

describe("calendar days in a zone, whatever the server's own zone", () => {
  it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])("puts 00:30 BST on its own day with the server in %s", (serverZone) => {
    process.env.TZ = serverZone;
    expect(zonedDateKey(new Date("2026-10-11T23:30:00Z"), "Europe/London")).toBe("2026-10-12");
    expect(zonedDateKey(new Date("2026-10-11T23:30:00Z"), "UTC")).toBe("2026-10-11");
    expect(zonedStartOfDay("2026-10-12", "Europe/London").toISOString()).toBe("2026-10-11T23:00:00.000Z");
  });

  it("gives the spring-forward day 23 hours and the fall-back day 25", () => {
    process.env.TZ = "UTC";
    const hours = (key: string, next: string) =>
      (zonedStartOfDay(next, "Europe/London").getTime() - zonedStartOfDay(key, "Europe/London").getTime()) / 3_600_000;
    expect(zonedStartOfDay("2026-03-29", "Europe/London").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(hours("2026-03-29", "2026-03-30")).toBe(23);
    expect(zonedStartOfDay("2026-10-25", "Europe/London").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(hours("2026-10-25", "2026-10-26")).toBe(25);
  });

  it("starts a day whose midnight the clocks skip at the moment it begins", () => {
    process.env.TZ = "UTC";
    // Chile springs forward at midnight: 6 Sep 2026 begins at 01:00 -03.
    expect(zonedStartOfDay("2026-09-06", "America/Santiago").toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(zonedStartOfDay("2026-09-05", "America/Santiago").toISOString()).toBe("2026-09-05T04:00:00.000Z");
  });

  it("refuses a malformed date key", () => {
    expect(() => zonedStartOfDay("12/10/2026", "UTC")).toThrow();
  });
});
