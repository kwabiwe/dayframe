import { describe, expect, it } from "vitest";
import {
  formatExportDuration,
  dateTimeLocalInputToIso,
  formatActivityEventLabel,
  durationInputValue,
  formatSourceLabel,
  parseDurationInput
} from "./format";

describe("local date/time form helpers", () => {
  it("serializes a UK/BST wall-clock edit as the matching UTC instant", () => {
    expect(
      dateTimeLocalInputToIso("2026-07-06T12:40", {
        timezoneOffsetMinutes: -60
      })
    ).toBe("2026-07-06T11:40:00.000Z");
  });

  it("keeps winter UK wall-clock edits at UTC when there is no offset", () => {
    expect(
      dateTimeLocalInputToIso("2026-01-06T12:40", {
        timezoneOffsetMinutes: 0
      })
    ).toBe("2026-01-06T12:40:00.000Z");
  });

  it("rejects invalid local date/time input", () => {
    expect(dateTimeLocalInputToIso("2026-02-31T12:40")).toBeNull();
    expect(dateTimeLocalInputToIso("12:40")).toBeNull();
  });
});

describe("duration form helpers", () => {
  it("accepts clock, minutes, and written hour/minute durations", () => {
    expect(parseDurationInput("1:15")).toBe(75 * 60);
    expect(parseDurationInput("75m")).toBe(75 * 60);
    expect(parseDurationInput("1h 15m")).toBe(75 * 60);
  });

  it("rejects empty, zero, negative, and malformed durations", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("0:00")).toBeNull();
    expect(parseDurationInput("-15m")).toBeNull();
    expect(parseDurationInput("1:75")).toBeNull();
  });

  it("formats duration drafts as hours and minutes", () => {
    expect(durationInputValue(75 * 60)).toBe("1:15");
  });
});


describe("activity event labels", () => {
  it("labels time away as itself, never as a detected commute (round 3 finding 3)", () => {
    expect(formatActivityEventLabel({ eventType: "commute_detected", timeAway: true })).toBe("Time away");
    expect(formatActivityEventLabel({ eventType: "commute_detected", timeAway: false })).toBe("Commute detected");
  });
});

describe("formatExportDuration", () => {
  it("keeps the report CSV's duration cells as they were", () => {
    expect(formatExportDuration(3600)).toBe("1h 00m");
    expect(formatExportDuration(3900)).toBe("1h 05m");
    expect(formatExportDuration(59.5)).toBe("1m");
    expect(formatExportDuration(0)).toBe("0m");
  });
});

describe("auto-logged visit source label (Log automatically, owner decision 14 Oct 2026)", () => {
  it("names the place for one block and stays plain without one", () => {
    expect(formatSourceLabel("location_auto_log", { placeName: " Gym " })).toBe("Logged automatically · Gym");
    expect(formatSourceLabel("location_auto_log")).toBe("Logged automatically");
    expect(formatSourceLabel("location_auto_log", { placeName: "  " })).toBe("Logged automatically");
    // Other sources never take the place.
    expect(formatSourceLabel("location_learning", { placeName: "Gym" })).toBe("Location learning");
  });
});
