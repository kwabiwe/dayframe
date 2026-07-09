import { describe, expect, it } from "vitest";
import {
  calendarSwipeDelta,
  formatCalendarHourLabel,
  shouldCaptureCalendarSwipe,
  shouldCommitCalendarSwipe
} from "./calendarGestures";

describe("calendar gestures", () => {
  it("formats wrapped timeline hour labels as clock times", () => {
    expect(formatCalendarHourLabel(0)).toBe("00:00");
    expect(formatCalendarHourLabel(24)).toBe("00:00");
    expect(formatCalendarHourLabel(-1)).toBe("23:00");
  });

  it("captures natural diagonal horizontal swipes before the parent scroll view eats them", () => {
    expect(shouldCaptureCalendarSwipe({ dx: 7, dy: 28 })).toBe(true);
    expect(shouldCaptureCalendarSwipe({ dx: 10, dy: 20 })).toBe(true);
    expect(shouldCaptureCalendarSwipe({ dx: -12, dy: 28 })).toBe(true);
    expect(shouldCaptureCalendarSwipe({ dx: -15, dy: 90 })).toBe(true);
  });

  it("does not capture mostly vertical gestures", () => {
    expect(shouldCaptureCalendarSwipe({ dx: 5, dy: 40 })).toBe(false);
    expect(shouldCommitCalendarSwipe({ dx: 12, dy: 80, vx: 0.2 })).toBe(false);
  });

  it("commits shorter deliberate swipes and quick flicks", () => {
    expect(shouldCommitCalendarSwipe({ dx: -19, dy: 40, vx: 0.02 })).toBe(true);
    expect(shouldCommitCalendarSwipe({ dx: 9, dy: 24, vx: 0.18 })).toBe(true);
  });

  it("keeps day and week swipe directions explicit", () => {
    expect(calendarSwipeDelta("day", { dx: -19, dy: 30, vx: 0.01 })).toBe(1);
    expect(calendarSwipeDelta("day", { dx: 19, dy: 30, vx: 0.01 })).toBe(-1);
    expect(calendarSwipeDelta("week", { dx: -19, dy: 30, vx: 0.01 })).toBe(-1);
    expect(calendarSwipeDelta("week", { dx: 19, dy: 30, vx: 0.01 })).toBe(1);
  });
});
