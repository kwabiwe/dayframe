import { afterAll, describe, expect, it } from "vitest";
import {
  calculateCalendarClickCreateSlot,
  calculateCalendarDraftAnchorGeometry
} from "./calendar-click-create";
import {
  buildCalendarEntryCompactCreatePlan,
  calendarEntryCompactCreateInitialDraft
} from "./calendar-entry-compact-editor";
import { dateTimeLocal } from "./format";

const originalTimezone = process.env.TZ;

afterAll(() => {
  process.env.TZ = originalTimezone;
});

describe.each([
  {
    fallDate: [2026, 9, 25] as const,
    fallEditedStartIso: "2026-10-25T00:30:00.000Z",
    fallEditedStopIso: "2026-10-25T01:30:00.000Z",
    fallStartIso: "2026-10-25T00:45:00.000Z",
    fallStopIso: "2026-10-25T01:15:00.000Z",
    springDate: [2026, 2, 29] as const,
    springGapMinute: 60,
    springStartLocal: "2026-03-29T00:45",
    springStartIso: "2026-03-29T00:45:00.000Z",
    springStopLocal: "2026-03-29T02:15",
    springStopIso: "2026-03-29T01:15:00.000Z",
    timezone: "Europe/London"
  },
  {
    fallDate: [2026, 10, 1] as const,
    fallEditedStartIso: "2026-11-01T05:30:00.000Z",
    fallEditedStopIso: "2026-11-01T06:30:00.000Z",
    fallStartIso: "2026-11-01T05:45:00.000Z",
    fallStopIso: "2026-11-01T06:15:00.000Z",
    springDate: [2026, 2, 8] as const,
    springGapMinute: 120,
    springStartLocal: "2026-03-08T01:45",
    springStartIso: "2026-03-08T06:45:00.000Z",
    springStopLocal: "2026-03-08T03:15",
    springStopIso: "2026-03-08T07:15:00.000Z",
    timezone: "America/New_York"
  }
])("Calendar DST behavior in $timezone", ({
  fallDate,
  fallEditedStartIso,
  fallEditedStopIso,
  fallStartIso,
  fallStopIso,
  springDate,
  springGapMinute,
  springStartLocal,
  springStartIso,
  springStopLocal,
  springStopIso,
  timezone
}) => {
  it("rejects nonexistent spring-forward rows and preserves exact instants around the gap", () => {
    process.env.TZ = timezone;
    const day = new Date(springDate[0], springDate[1], springDate[2], 12);
    expect(slotAt(day, springGapMinute, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12))).toBeNull();

    const slot = slotAt(day, springGapMinute - 15, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12));
    expect(slot?.startedAt).toBe(springStartIso);
    expect(slot?.stoppedAt).toBe(springStopIso);
    expect(dateTimeLocal(slot?.startedAt)).toBe(springStartLocal);
    expect(dateTimeLocal(slot?.stoppedAt)).toBe(springStopLocal);
    expect(durationSeconds(slot)).toBe(1_800);
    const geometry = geometryFor(day, slot);
    expect(geometry?.height).toBeGreaterThan(0);
    expect(geometry?.top).toBeGreaterThanOrEqual(0);
  });

  it("keeps an untouched repeated-hour draft saveable with its two exact instants", () => {
    process.env.TZ = timezone;
    const day = new Date(fallDate[0], fallDate[1], fallDate[2], 12);
    const slot = slotAt(day, 105, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12));
    expect(slot?.startedAt).toBe(fallStartIso);
    expect(slot?.stoppedAt).toBe(fallStopIso);
    expect(dateTimeLocal(slot?.startedAt).slice(11)).toBe("01:45");
    expect(dateTimeLocal(slot?.stoppedAt).slice(11)).toBe("01:15");
    expect(durationSeconds(slot)).toBe(1_800);

    const source = { startedAt: slot!.startedAt, stoppedAt: slot!.stoppedAt };
    const plan = buildCalendarEntryCompactCreatePlan({
      draft: calendarEntryCompactCreateInitialDraft(source),
      now: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12),
      source
    });
    expect(plan.resolved.startedAt).toBe(fallStartIso);
    expect(plan.resolved.stoppedAt).toBe(fallStopIso);
    expect(plan.durationSeconds).toBe(1_800);
    expect(geometryFor(day, slot)).toEqual({
      continuesIntoNextDay: false,
      height: 32,
      top: 112
    });

    const editedStart = buildCalendarEntryCompactCreatePlan({
      draft: { ...calendarEntryCompactCreateInitialDraft(source), startedAt: "01:30" },
      now: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12),
      source
    });
    expect(editedStart.resolved.startedAt).toBe(fallEditedStartIso);
    expect(editedStart.resolved.stoppedAt).toBe(fallStopIso);
    expect(editedStart.durationSeconds).toBeGreaterThan(0);

    const editedFinish = buildCalendarEntryCompactCreatePlan({
      draft: { ...calendarEntryCompactCreateInitialDraft(source), stoppedAt: "01:30" },
      now: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12),
      source
    });
    expect(editedFinish.resolved.startedAt).toBe(fallStartIso);
    expect(editedFinish.resolved.stoppedAt).toBe(fallEditedStopIso);
    expect(editedFinish.durationSeconds).toBeGreaterThan(0);
  });

  it("preserves ordinary and midnight wall-clock output while rejecting future Finish", () => {
    process.env.TZ = timezone;
    const ordinaryDay = new Date(2026, 1, 10, 12);
    const ordinary = slotAt(ordinaryDay, 10 * 60 + 7, new Date(2026, 1, 10, 18));
    expect(dateTimeLocal(ordinary?.startedAt).slice(11)).toBe("10:00");
    expect(dateTimeLocal(ordinary?.stoppedAt).slice(11)).toBe("10:30");
    expect(durationSeconds(ordinary)).toBe(1_800);
    expect(geometryFor(ordinaryDay, ordinary)?.height).toBe(32);

    const midnightDay = new Date(2026, 0, 15, 12);
    const midnight = slotAt(midnightDay, 23 * 60 + 45, new Date(2026, 0, 16, 12));
    expect(dateTimeLocal(midnight?.startedAt)).toBe("2026-01-15T23:45");
    expect(dateTimeLocal(midnight?.stoppedAt)).toBe("2026-01-16T00:15");
    expect(durationSeconds(midnight)).toBe(1_800);
    expect(geometryFor(midnightDay, midnight)).toEqual({
      continuesIntoNextDay: true,
      height: 16,
      top: 1_520
    });

    const futureDay = new Date(2026, 1, 10, 12);
    expect(slotAt(futureDay, 10 * 60, new Date(2026, 1, 10, 10, 20))).toBeNull();
    expect(slotAt(futureDay, 10 * 60, new Date(2026, 1, 10, 10, 31))).not.toBeNull();
  });
});

function slotAt(day: Date, minute: number, now: Date) {
  return calculateCalendarClickCreateSlot({
    clientY: (minute / 60) * 64,
    day,
    dayBodyRect: { height: 24 * 64, top: 0 },
    endHour: 24,
    now,
    rowHeight: 64,
    startHour: 0
  });
}

function geometryFor(
  day: Date,
  slot: { startedAt: string; stoppedAt: string } | null | undefined
) {
  if (!slot) return null;
  return calculateCalendarDraftAnchorGeometry({
    day,
    endHour: 24,
    rowHeight: 64,
    startedAt: slot.startedAt,
    startHour: 0,
    stoppedAt: slot.stoppedAt
  });
}

function durationSeconds(slot: { startedAt: string; stoppedAt: string } | null | undefined) {
  if (!slot) return 0;
  return (new Date(slot.stoppedAt).getTime() - new Date(slot.startedAt).getTime()) / 1_000;
}
