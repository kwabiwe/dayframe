import { afterEach, describe, expect, it } from "vitest";
import type { LocationReviewWindowDraft } from "./locationReviewDraft";
import { parseCommuteInterruptionDraft } from "./commuteInterruptionDraft";

const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function draft(overrides: Partial<LocationReviewWindowDraft> = {}): LocationReviewWindowDraft {
  return {
    baselineStartedAt: new Date(2026, 8, 29, 7, 0, 34, 123).toISOString(),
    baselineStoppedAt: new Date(2026, 8, 29, 7, 39, 52, 987).toISOString(),
    startDateText: "2026-09-29", startTimeText: "07:13",
    stopDateText: "2026-09-29", stopTimeText: "07:26",
    ...overrides
  };
}

describe("minute-resolution commute interruption draft", () => {
  it.each([26, 39])("canonicalises the new boundaries, including a resume minute matching the parent (%s)", (endMinute) => {
    expect(parseCommuteInterruptionDraft(draft({ stopTimeText: `07:${endMinute}` }))).toEqual({
      status: "valid", error: null,
      mutation: {
        action: "interrupt_commute",
        stopStartedAt: new Date(2026, 8, 29, 7, 13, 0, 0).toISOString(),
        stopEndedAt: new Date(2026, 8, 29, 7, endMinute, 0, 0).toISOString()
      }
    });
  });

  it.each([
    { startTimeText: "07:26", stopTimeText: "07:13" },
    { startTimeText: "07:13", stopTimeText: "07:13" }
  ])("rejects reversed/equal canonical boundaries with specific guidance: %j", (changes) => {
    expect(parseCommuteInterruptionDraft(draft(changes))).toEqual({
      status: "invalid", mutation: null, error: "The stop must begin before the journey resumes."
    });
  });

  it.each([{ startTimeText: "07:00" }, { stopTimeText: "07:40" }])(
    "validates against the exact unrounded parent bounds: %j", (changes) => {
      expect(parseCommuteInterruptionDraft(draft(changes))).toEqual({
        status: "invalid", mutation: null, error: "Both stop times must be inside this commute."
      });
    }
  );

  it("keeps missing fields separate from populated but malformed fields", () => {
    expect(parseCommuteInterruptionDraft(draft({ stopTimeText: " " }))).toEqual({
      status: "incomplete", mutation: null, error: "Enter both stop dates and times."
    });
    expect(parseCommuteInterruptionDraft(draft({ stopTimeText: "07:" }))).toEqual({
      status: "invalid", mutation: null, error: "Enter the time as HH:mm."
    });
  });

  it.each([
    ["Europe/London", "2026-09-29T22:40:34.123Z", "2026-09-29T23:30:52.987Z",
      "2026-09-29", "23:50", "2026-09-30", "00:10", "2026-09-29T22:50:00.000Z", "2026-09-29T23:10:00.000Z"],
    ["Europe/London", "2026-03-29T00:00:34.123Z", "2026-03-29T02:59:52.987Z",
      "2026-03-29", "00:45", "2026-03-29", "02:15", "2026-03-29T00:45:00.000Z", "2026-03-29T01:15:00.000Z"],
    ["Europe/London", "2026-10-25T00:00:34.123Z", "2026-10-25T02:30:52.987Z",
      "2026-10-25", "01:13", "2026-10-25", "01:26", "2026-10-25T00:13:00.000Z", "2026-10-25T00:26:00.000Z"],
    ["America/New_York", "2026-03-08T05:00:34.123Z", "2026-03-08T08:30:52.987Z",
      "2026-03-08", "01:30", "2026-03-08", "03:15", "2026-03-08T06:30:00.000Z", "2026-03-08T07:15:00.000Z"],
    ["America/New_York", "2026-11-01T04:00:34.123Z", "2026-11-01T08:30:52.987Z",
      "2026-11-01", "01:13", "2026-11-01", "01:26", "2026-11-01T05:13:00.000Z", "2026-11-01T05:26:00.000Z"]
  ])("preserves local dates and existing DST resolution in %s from %s", (
    zone, baselineStartedAt, baselineStoppedAt, startDateText, startTimeText, stopDateText, stopTimeText,
    stopStartedAt, stopEndedAt
  ) => {
    process.env.TZ = zone;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(parseCommuteInterruptionDraft({ baselineStartedAt, baselineStoppedAt,
      startDateText, startTimeText, stopDateText, stopTimeText })).toEqual({
      status: "valid", error: null, mutation: { action: "interrupt_commute", stopStartedAt, stopEndedAt }
    });
  });

  it.each([
    ["Europe/London", "2026-03-29", "01:15", "02:30"],
    ["America/New_York", "2026-03-08", "02:15", "03:30"]
  ])("rejects a nonexistent spring-forward time in %s", (zone, date, startTimeText, stopTimeText) => {
    process.env.TZ = zone;
    expect(parseCommuteInterruptionDraft(draft({
      baselineStartedAt: `${date}T00:00:00.000Z`, baselineStoppedAt: `${date}T12:00:00.000Z`,
      startDateText: date, stopDateText: date, startTimeText, stopTimeText
    }))).toEqual({ status: "invalid", mutation: null, error: "Enter a valid date and time." });
  });
});
