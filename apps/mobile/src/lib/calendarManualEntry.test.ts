import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR,
  createCalendarManualEntryDraft,
  resolveCalendarManualEntryRequest
} from "./calendarManualEntry";

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe.sequential("Calendar manual-entry draft", () => {
  it("creates the blank Uncategorized 30-minute draft for a valid local slot", () => {
    const result = createCalendarManualEntryDraft({
      dayKey: "2026-08-04",
      startMinute: 10 * 60,
      now: Date.parse("2026-08-04T12:00:00Z")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({
      categoryColor: null,
      categoryId: null,
      categoryName: null,
      clientName: null,
      confidence: "manual",
      description: null,
      durationSeconds: 1800,
      placeName: null,
      projectColor: null,
      projectId: null,
      projectName: null,
      reviewStatus: "confirmed",
      source: "manual_app",
      tagNames: [],
      tags: []
    });
    expect(new Date(result.entry.startedAt).getHours()).toBe(10);
    expect(new Date(result.entry.startedAt).getMinutes()).toBe(0);
    expect(Date.parse(result.entry.stoppedAt!) - Date.parse(result.entry.startedAt)).toBe(1_800_000);
  });

  it("defensively floors to 15 minutes and clamps to the final 23:45 slot", () => {
    const floored = createCalendarManualEntryDraft({
      dayKey: "2026-08-04",
      startMinute: 614.9,
      now: 1
    });
    const clamped = createCalendarManualEntryDraft({
      dayKey: "2026-08-04",
      startMinute: 50_000,
      now: 2
    });

    expect(floored.ok && new Date(floored.entry.startedAt).getHours()).toBe(10);
    expect(floored.ok && new Date(floored.entry.startedAt).getMinutes()).toBe(0);
    expect(clamped.ok && new Date(clamped.entry.startedAt).getHours()).toBe(23);
    expect(clamped.ok && new Date(clamped.entry.startedAt).getMinutes()).toBe(45);
  });

  it("rolls 23:45 into 00:15 on the following local day", () => {
    const result = createCalendarManualEntryDraft({
      dayKey: "2026-08-04",
      startMinute: 1_425,
      now: 3
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finish = new Date(result.entry.stoppedAt!);
    expect([finish.getFullYear(), finish.getMonth() + 1, finish.getDate()]).toEqual([2026, 8, 5]);
    expect([finish.getHours(), finish.getMinutes()]).toEqual([0, 15]);
    expect(finish.getTime() - Date.parse(result.entry.startedAt)).toBe(1_800_000);
  });

  it("rejects malformed dates and non-finite native minutes", () => {
    for (const input of [
      { dayKey: "2026-02-30", startMinute: 600 },
      { dayKey: "04-08-2026", startMinute: 600 },
      { dayKey: "2026-08-04", startMinute: Number.NaN }
    ]) {
      expect(createCalendarManualEntryDraft({ ...input, now: 4 }).ok).toBe(false);
    }
  });

  it("uses a unique local editor identity for repeated presentations of one slot", () => {
    const input = { dayKey: "2026-08-04", startMinute: 600, now: 5 };
    const first = createCalendarManualEntryDraft(input);
    const second = createCalendarManualEntryDraft(input);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.entry.id).not.toBe(second.entry.id);
    expect(first.entry.startedAt).toBe(second.entry.startedAt);
  });

  it("ignores a stale native event after selected-day navigation", () => {
    expect(resolveCalendarManualEntryRequest({
      dayKey: "2026-08-03",
      selectedDayKey: "2026-08-04",
      startMinute: 600,
      now: 6
    })).toEqual({ ok: false, ignored: true });
  });

  it("allows a future draft to reach the existing sheet validation", () => {
    const result = createCalendarManualEntryDraft({
      dayKey: "2030-08-04",
      startMinute: 600,
      now: Date.parse("2026-08-04T12:00:00Z")
    });
    expect(result.ok).toBe(true);
  });

  it("fails closed for a nonexistent spring-forward wall time", () => {
    const result = createCalendarManualEntryDraft({
      dayKey: "2026-03-29",
      startMinute: 75,
      now: 7
    });
    expect(result).toEqual({ ok: false, error: CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR });
  });

  it("uses the deterministic earlier repeated hour and rejects a pair the sheet cannot round-trip", () => {
    const earlier = createCalendarManualEntryDraft({
      dayKey: "2026-10-25",
      startMinute: 60,
      now: 8
    });
    const unsafePair = createCalendarManualEntryDraft({
      dayKey: "2026-10-25",
      startMinute: 90,
      now: 9
    });

    expect(earlier.ok).toBe(true);
    if (earlier.ok) {
      expect(new Date(earlier.entry.startedAt).getTimezoneOffset()).toBe(-60);
      expect(Date.parse(earlier.entry.stoppedAt!) - Date.parse(earlier.entry.startedAt)).toBe(1_800_000);
    }
    expect(unsafePair).toEqual({ ok: false, error: CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR });
  });
});
