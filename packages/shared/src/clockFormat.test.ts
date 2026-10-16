import { describe, expect, it } from "vitest";
import {
  formatClockHour,
  formatClockMinutes,
  formatClockParts,
  formatClockTime,
  formatClockValue,
  isClockFormatPreference,
  resolveClockFormat,
  systemClockFormat
} from "./clockFormat";

describe("clock times of day (12/24-hour setting, 16 Oct 2026)", () => {
  it("formats 24-hour times as Dayframe always has", () => {
    expect(formatClockParts(9, 5, "24h")).toBe("09:05");
    expect(formatClockParts(0, 0, "24h")).toBe("00:00");
    expect(formatClockParts(23, 59, "24h")).toBe("23:59");
    expect(formatClockParts(24, 0, "24h")).toBe("24:00");
    expect(formatClockHour(8, "24h")).toBe("08:00");
  });

  it("formats 12-hour times with AM/PM, midnight and noon as 12", () => {
    expect(formatClockParts(9, 5, "12h")).toBe("9:05 AM");
    expect(formatClockParts(0, 0, "12h")).toBe("12:00 AM");
    expect(formatClockParts(12, 0, "12h")).toBe("12:00 PM");
    expect(formatClockParts(13, 30, "12h")).toBe("1:30 PM");
    expect(formatClockParts(23, 59, "12h")).toBe("11:59 PM");
    expect(formatClockParts(24, 0, "12h")).toBe("12:00 AM");
    expect(formatClockHour(0, "12h")).toBe("12 AM");
    expect(formatClockHour(6, "12h")).toBe("6 AM");
    expect(formatClockHour(12, "12h")).toBe("12 PM");
    expect(formatClockHour(18, "12h")).toBe("6 PM");
    expect(formatClockHour(24, "12h")).toBe("12 AM");
  });

  it("formats minutes after midnight, moments and stored HH:MM values", () => {
    expect(formatClockMinutes(615, "12h")).toBe("10:15 AM");
    expect(formatClockMinutes(615, "24h")).toBe("10:15");
    expect(formatClockTime(new Date(2026, 9, 16, 21, 7, 59), "12h")).toBe("9:07 PM");
    expect(formatClockTime(new Date(2026, 9, 16, 21, 7, 59).toISOString(), "24h")).toBe("21:07");
    expect(formatClockTime(new Date(2026, 9, 16, 7, 3).getTime(), "24h")).toBe("07:03");
    expect(formatClockValue("21:30", "12h")).toBe("9:30 PM");
    expect(formatClockValue("21:30", "24h")).toBe("21:30");
    expect(formatClockValue("9:3", "12h")).toBe("9:3");
  });

  it("resolves the stored choice against the system's format", () => {
    expect(resolveClockFormat("system", "12h")).toBe("12h");
    expect(resolveClockFormat("system", "24h")).toBe("24h");
    expect(resolveClockFormat("24h", "12h")).toBe("24h");
    expect(resolveClockFormat("12h", "24h")).toBe("12h");
    expect(isClockFormatPreference("12h")).toBe(true);
    expect(isClockFormatPreference("system")).toBe(true);
    expect(isClockFormatPreference("12")).toBe(false);
    expect(isClockFormatPreference(null)).toBe(false);
  });

  it("reads the system format from the locale's hour cycle", () => {
    expect(systemClockFormat("en-US")).toBe("12h");
    expect(systemClockFormat("en-GB")).toBe("24h");
    expect(systemClockFormat("de-DE")).toBe("24h");
    expect(systemClockFormat("en-GB-u-hc-h12")).toBe("12h");
    expect(systemClockFormat("not a locale!")).toBe("24h");
  });
});
