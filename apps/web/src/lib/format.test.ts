import { describe, expect, it } from "vitest";
import {
  dateTimeLocalInputToIso,
  durationInputValue,
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
