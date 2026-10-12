import { describe, expect, it } from "vitest";
import { dateTimeLocal, dateTimeLocalInputToIso } from "@/lib/format";
import {
  calculateCalendarClickCreateSlot,
  calculateCalendarDraftAnchorGeometry,
  calendarCreateGhostGeometry,
  calendarCreateLimitMinutes,
  calendarCreateMinuteIsFuture,
  calendarCreatePointerSequenceAccepted,
  calendarDragCreateRange,
  calendarDragCreateSlot,
  calendarPointHitsSemanticBlock,
  calendarPointerMatchesConsumed,
  calendarPointerMinutesAt,
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
    expect(isEligibleCalendarCreatePointer({ ...basePointer, pointerType: "pen" })).toBe(true);
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

describe("Calendar create stops at now (owner decision 12 Oct 2026, option B)", () => {
  const today = new Date(2026, 9, 12, 12);
  const now = new Date(2026, 9, 12, 10, 37, 40);

  it("allows a whole past day, today up to now (floored to the minute) and none of a future day", () => {
    expect(calendarCreateLimitMinutes(new Date(2026, 9, 11, 23), now)).toBe(24 * 60);
    expect(calendarCreateLimitMinutes(today, now)).toBe(10 * 60 + 37);
    expect(calendarCreateLimitMinutes(new Date(2026, 9, 13, 0), now)).toBe(0);
  });

  it("treats a point at or after now as future time, and never any point of a past day", () => {
    expect(calendarCreateMinuteIsFuture({ day: today, minutes: 10 * 60 + 36.9, now })).toBe(false);
    expect(calendarCreateMinuteIsFuture({ day: today, minutes: 10 * 60 + 37, now })).toBe(true);
    expect(calendarCreateMinuteIsFuture({ day: today, minutes: 23 * 60, now })).toBe(true);
    expect(calendarCreateMinuteIsFuture({ day: new Date(2026, 9, 13, 12), minutes: 0, now })).toBe(true);
    expect(calendarCreateMinuteIsFuture({ day: new Date(2026, 9, 11, 12), minutes: 24 * 60, now })).toBe(false);
  });

  it("reads the unsnapped minute under the pointer, clamped to the axis", () => {
    const axis = { dayBodyTop: 100, endHour: 24, rowHeight: 64, startHour: 0 };
    expect(calendarPointerMinutesAt({ ...axis, clientY: 100 + (10 * 60 + 37.5) / 60 * 64 })).toBeCloseTo(10 * 60 + 37.5);
    expect(calendarPointerMinutesAt({ ...axis, clientY: 0 })).toBe(0);
    expect(calendarPointerMinutesAt({ ...axis, clientY: 100_000 })).toBe(24 * 60);
  });

  it("holds a drag range at the limit in either direction and keeps the 5-minute steps below it", () => {
    const axis = { endHour: 24, startHour: 0 };
    // No limit: unchanged behaviour (main's axis-end rule included).
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 600, currentMinutes: 700 }))
      .toEqual({ startMinutes: 600, endMinutes: 700, heldAtLimit: false });
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 1440, currentMinutes: 1440 }))
      .toEqual({ startMinutes: 1435, endMinutes: 1440, heldAtLimit: false });
    // Past → future: the end stops at now.
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 600, currentMinutes: 900, limitMinutes: 637 }))
      .toEqual({ startMinutes: 600, endMinutes: 637, heldAtLimit: true });
    // Dragging upward from a press that rounded past now.
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 640, currentMinutes: 600, limitMinutes: 637 }))
      .toEqual({ startMinutes: 600, endMinutes: 637, heldAtLimit: true });
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 0, currentMinutes: 30, limitMinutes: 2 }))
      .toEqual({ startMinutes: 0, endMinutes: 2, heldAtLimit: true });
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 600, currentMinutes: 620, limitMinutes: 637 }))
      .toEqual({ startMinutes: 600, endMinutes: 620, heldAtLimit: false });
  });

  it("keeps the start on the 5-minute grid when a full step no longer fits before now (Codex r1 on #369)", () => {
    const axis = { endHour: 24, startHour: 0 };
    // Now 10:37, press snapped to 10:35: 10:35–10:37, never 10:32–10:37.
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 635, currentMinutes: 700, limitMinutes: 637 }))
      .toEqual({ startMinutes: 635, endMinutes: 637, heldAtLimit: true });
    // Now exactly on a step (10:35): a full step ending at now.
    expect(calendarDragCreateRange({ ...axis, anchorMinutes: 640, currentMinutes: 700, limitMinutes: 635 }))
      .toEqual({ startMinutes: 630, endMinutes: 635, heldAtLimit: true });
    for (let limit = 1; limit < 24 * 60; limit += 1) {
      for (const [anchor, current] of [[limit - 3, limit + 40], [limit + 5, limit + 10], [limit - 1, limit - 1], [limit - 40, limit + 2]]) {
        const range = calendarDragCreateRange({
          ...axis,
          anchorMinutes: Math.round(anchor / 5) * 5,
          currentMinutes: Math.round(current / 5) * 5,
          limitMinutes: limit
        });
        expect(range.startMinutes % 5).toBe(0);
        expect(range.endMinutes).toBeLessThanOrEqual(limit);
        expect(range.endMinutes - range.startMinutes).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("never draws the ghost past the now line, growing a too-short ghost upward instead (Codex r1 on #369)", () => {
    const axis = { rowHeight: 64, startHour: 0 };
    const nowLineY = (12 * 60 / 60) * 64;
    // 11:55 → 12:00 at default zoom: the 12px minimum used to reach 774.7px, past the line at 768px.
    const held = calendarCreateGhostGeometry({ ...axis, endMinutes: 720, limitMinutes: 720, startMinutes: 715 });
    expect(held.height).toBe(12);
    expect(held.top + held.height + 2).toBe(nowLineY);
    // A tall ghost keeps its true geometry; with no limit (a past day) the old downward minimum stays.
    expect(calendarCreateGhostGeometry({ ...axis, endMinutes: 720, limitMinutes: 720, startMinutes: 660 }))
      .toEqual({ height: 62, top: 704 });
    expect(calendarCreateGhostGeometry({ ...axis, endMinutes: 545, startMinutes: 540 }))
      .toEqual({ height: 12, top: 576 });
    // Far enough above now, a short ghost still grows downward.
    expect(calendarCreateGhostGeometry({ ...axis, endMinutes: 545, limitMinutes: 720, startMinutes: 540 }))
      .toEqual({ height: 12, top: 576 });
  });

  it("keeps short ghosts ending before now above the now line too (Codex r2 on #369)", () => {
    const axis = { rowHeight: 64, startHour: 0 };
    // At 11:56, an 11:50–11:55 ghost used to reach 769.33px with the now line at 764px.
    const nowLineY = ((11 * 60 + 56) / 60) * 64;
    const ghost = calendarCreateGhostGeometry({ ...axis, endMinutes: 715, limitMinutes: 716, startMinutes: 710 });
    expect(ghost.top + ghost.height).toBeLessThanOrEqual(nowLineY - 2);
    expect(ghost.height).toBe(12);
    // Sweep: every short range (5–15 minutes) ending up to 15 minutes before now, at every zoom.
    for (const rowHeight of [48, 64, 92, 128, 192]) {
      for (let limit = 30; limit <= 24 * 60; limit += 7) {
        for (let endGap = 0; endGap <= 15; endGap += 1) {
          for (const length of [1, 2, 4, 5, 10, 15]) {
            const endMinutes = limit - endGap;
            const startMinutes = endMinutes - length;
            const geometry = calendarCreateGhostGeometry({ endMinutes, limitMinutes: limit, rowHeight, startHour: 0, startMinutes });
            const lineY = (limit / 60) * rowHeight;
            expect(geometry.top + geometry.height).toBeLessThanOrEqual(lineY - 2 + 1e-9);
            expect(geometry.height).toBeGreaterThanOrEqual(12);
            expect(geometry.top).toBeGreaterThanOrEqual(0);
            // Never drawn lower than the range itself starts.
            expect(geometry.top).toBeLessThanOrEqual((startMinutes / 60) * rowHeight + 1e-9);
          }
        }
      }
    }
  });

  it("creates a dragged range ending where the ghost stops, and nothing that starts at or after now", () => {
    const held = calendarDragCreateSlot({ day: today, endMinutes: 10 * 60 + 37, now, startMinutes: 10 * 60 });
    expect(held?.startedAt).toBe(new Date(2026, 9, 12, 10, 0).toISOString());
    expect(held?.stoppedAt).toBe(new Date(2026, 9, 12, 10, 37).toISOString());
    expect(calendarDragCreateSlot({ day: today, endMinutes: 11 * 60, now, startMinutes: 10 * 60 + 37 })).toBeNull();
    expect(calendarDragCreateSlot({ day: new Date(2026, 9, 13, 12), endMinutes: 600, now, startMinutes: 540 })).toBeNull();
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
