import { describe, expect, it } from "vitest";
import { dateTimeLocal, dateTimeLocalInputToIso } from "@/lib/format";
import {
  calculateCalendarClickCreateSlot,
  calculateCalendarDraftAnchorGeometry,
  calendarCreatePointerSequenceAccepted,
  calendarPointHitsSemanticBlock,
  calendarPointerMatchesConsumed,
  isEligibleCalendarCreatePointer,
  type CalendarCreatePointerSequence
} from "./calendar-click-create";

describe("Calendar click-to-create time geometry", () => {
  const day = new Date(2026, 7, 2, 12);

  it.each([
    [0, "00:00", "00:30"],
    [10 * 60, "10:00", "10:30"],
    [10 * 60 + 7, "10:00", "10:30"],
    [10 * 60 + 14, "10:00", "10:30"],
    [10 * 60 + 15, "10:15", "10:45"],
    [10 * 60 + 29.99, "10:15", "10:45"]
  ])("floors minute %s to %s–%s", (minute, expectedStart, expectedFinish) => {
    const slot = slotForMinute(minute);
    expect(localClock(slot?.startedAt)).toBe(expectedStart);
    expect(localClock(slot?.stoppedAt)).toBe(expectedFinish);
    expect(durationSeconds(slot)).toBe(1_800);
  });

  it("clamps the bottom pixel to 23:45 and finishes on the following local day", () => {
    const slot = calculateCalendarClickCreateSlot({
      clientY: 1_536,
      day,
      dayBodyRect: { height: 1_536, top: 0 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    });

    expect(slot?.startMinutes).toBe(23 * 60 + 45);
    expect(localClock(slot?.startedAt)).toBe("23:45");
    expect(localClock(slot?.stoppedAt)).toBe("00:15");
    expect(dateTimeLocal(slot?.stoppedAt).slice(0, 10)).toBe("2026-08-03");
    expect(slot?.continuesIntoNextDay).toBe(true);
    expect(slot?.height).toBe(16);
    expect(durationSeconds(slot)).toBe(1_800);
  });

  it.each([64, 92, 128])("returns the same clock slot at row height %s", (rowHeight) => {
    const minute = 10 * 60 + 7;
    const slot = calculateCalendarClickCreateSlot({
      clientY: (minute / 60) * rowHeight + 140,
      day,
      dayBodyRect: { height: 24 * rowHeight, top: 140 },
      endHour: 24,
      rowHeight,
      startHour: 0
    });
    expect(slot?.startMinutes).toBe(600);
    expect(localClock(slot?.startedAt)).toBe("10:00");
  });

  it("uses viewport-relative coordinates and safely clamps out-of-range clicks", () => {
    expect(calculateCalendarClickCreateSlot({
      clientY: 20,
      day,
      dayBodyRect: { height: 1_536, top: 100 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    })?.startMinutes).toBe(0);
    expect(calculateCalendarClickCreateSlot({
      clientY: 2_000,
      day,
      dayBodyRect: { height: 1_536, top: 100 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    })?.startMinutes).toBe(1_425);
  });

  it("rejects invalid or zero geometry without producing a timestamp", () => {
    expect(calculateCalendarClickCreateSlot({
      clientY: 0,
      day,
      dayBodyRect: { height: 0, top: 0 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    })).toBeNull();
    expect(calculateCalendarClickCreateSlot({
      clientY: Number.NaN,
      day,
      dayBodyRect: { height: 1_536, top: 0 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    })).toBeNull();
  });

  it("keeps exact elapsed duration across a local daylight-saving transition", () => {
    const transitionDay = new Date(2026, 2, 29, 12);
    const slot = calculateCalendarClickCreateSlot({
      clientY: 45,
      day: transitionDay,
      dayBodyRect: { height: 1_440, top: 0 },
      endHour: 24,
      rowHeight: 60,
      startHour: 0
    });
    expect(durationSeconds(slot)).toBe(1_800);
  });

  it("reflows an edited draft anchor at every zoom without changing its time", () => {
    for (const rowHeight of [64, 92, 128]) {
      const geometry = calculateCalendarDraftAnchorGeometry({
        day,
        endHour: 24,
        rowHeight,
        startedAt: localIso("2026-08-02T10:15"),
        startHour: 0,
        stoppedAt: localIso("2026-08-02T11:00")
      });
      expect(geometry).toEqual({
        continuesIntoNextDay: false,
        height: (45 / 60) * rowHeight,
        top: (10.25) * rowHeight
      });
    }
  });

  it("clips a cross-midnight anchor to the clicked day", () => {
    expect(calculateCalendarDraftAnchorGeometry({
      day,
      endHour: 24,
      rowHeight: 64,
      startedAt: localIso("2026-08-02T23:45"),
      startHour: 0,
      stoppedAt: localIso("2026-08-03T00:15")
    })).toEqual({ continuesIntoNextDay: true, height: 16, top: 1_520 });
  });

  function slotForMinute(minute: number) {
    return calculateCalendarClickCreateSlot({
      clientY: (minute / 60) * 64,
      day,
      dayBodyRect: { height: 1_536, top: 0 },
      endHour: 24,
      rowHeight: 64,
      startHour: 0
    });
  }
});

describe("Calendar click-to-create pointer intent", () => {
  const basePointer = {
    button: 0,
    consumed: false,
    ctrlKey: false,
    defaultPrevented: false,
    isPrimary: true,
    pointerType: "mouse",
    resizeActive: false,
    targetKind: "day-body" as const
  };
  const sequence: CalendarCreatePointerSequence = {
    clientX: 100,
    clientY: 200,
    dayKey: "2026-08-02",
    pointerId: 7,
    pointerDownTimeStamp: 123.5,
    scrollLeft: 0,
    scrollTop: 640
  };

  it("accepts only an unclaimed primary mouse pointer on the day body", () => {
    expect(isEligibleCalendarCreatePointer(basePointer)).toBe(true);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, button: 1 })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, button: 2 })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, pointerType: "touch" })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, pointerType: "pen" })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, ctrlKey: true })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, defaultPrevented: true })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, resizeActive: true })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, consumed: true })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, targetKind: "entry" })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, targetKind: "action" })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, targetKind: "resize" })).toBe(false);
    expect(isEligibleCalendarCreatePointer({ ...basePointer, targetKind: "draft" })).toBe(false);
  });

  it("accepts deliberate movement below the threshold and rejects cancellation, drag, or scroll", () => {
    const finish = {
      clientX: 103,
      clientY: 204,
      consumed: false,
      dayKey: sequence.dayKey,
      movementThresholdPx: 6,
      pointerId: sequence.pointerId,
      scrollLeft: 0,
      scrollTop: 640,
      sequence,
      targetEligible: true
    };
    expect(calendarCreatePointerSequenceAccepted(finish)).toBe(true);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, clientX: 106, clientY: 200 })).toBe(false);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, scrollTop: 642 })).toBe(false);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, cancelled: true })).toBe(false);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, targetEligible: false })).toBe(false);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, pointerId: 8 })).toBe(false);
    expect(calendarCreatePointerSequenceAccepted({ ...finish, dayKey: "2026-08-03" })).toBe(false);
  });

  it("consumes only the exact editor-dismissal pointer and admits a later click", () => {
    const token = { pointerId: 7, pointerDownTimeStamp: 123.5, sessionId: 4 };
    expect(calendarPointerMatchesConsumed(token, sequence)).toBe(true);
    expect(calendarPointerMatchesConsumed(token, { ...sequence, pointerDownTimeStamp: 124 })).toBe(false);
    expect(calendarPointerMatchesConsumed(token, { ...sequence, pointerId: 8 })).toBe(false);
  });

  it("rejects the visual-only pixel gap only within the semantic lane", () => {
    const blocks = [{ left: 20, right: 120, top: 100, height: 30 }];
    expect(calendarPointHitsSemanticBlock({ blocks, clientX: 60, clientY: 129.5, dayBodyTop: 0 })).toBe(true);
    expect(calendarPointHitsSemanticBlock({ blocks, clientX: 60, clientY: 130, dayBodyTop: 0 })).toBe(false);
    expect(calendarPointHitsSemanticBlock({ blocks, clientX: 140, clientY: 129.5, dayBodyTop: 0 })).toBe(false);
  });
});

function durationSeconds(slot: { startedAt: string; stoppedAt: string } | null | undefined) {
  if (!slot) return 0;
  return (new Date(slot.stoppedAt).getTime() - new Date(slot.startedAt).getTime()) / 1_000;
}

function localClock(value: string | null | undefined) {
  return value ? dateTimeLocal(value).slice(11) : "";
}

function localIso(value: string) {
  const iso = dateTimeLocalInputToIso(value);
  if (!iso) throw new Error(`Bad local date: ${value}`);
  return iso;
}
