import { describe, expect, it } from "vitest";
import {
  anchoredCalendarScrollY,
  calendarPinchTransform,
  calendarSwipeDelta,
  formatCalendarHourLabel,
  shouldCaptureCalendarSwipe,
  shouldCommitCalendarSwipe
} from "./calendarGestures";

describe("calendar gestures", () => {
  it("keeps the pinch anchor under a stationary gesture midpoint", () => {
    expect(anchoredCalendarScrollY({
      anchorY: 300,
      currentMidpointY: 220,
      nextHourHeight: 108,
      startHourHeight: 72,
      startMidpointY: 220,
      startScrollY: 400
    })).toBe(550);
  });

  it("accounts for midpoint translation while pinching and clamps the scroll origin", () => {
    expect(anchoredCalendarScrollY({
      anchorY: 300,
      currentMidpointY: 250,
      nextHourHeight: 108,
      startHourHeight: 72,
      startMidpointY: 220,
      startScrollY: 400
    })).toBe(520);
    expect(anchoredCalendarScrollY({
      anchorY: 20,
      currentMidpointY: 300,
      nextHourHeight: 48,
      startHourHeight: 72,
      startMidpointY: 200,
      startScrollY: 0
    })).toBe(0);
  });

  it("keeps the live pinch focal point anchored without a React layout update", () => {
    expect(calendarPinchTransform({
      currentFocalY: 240,
      gestureScale: 1.5,
      maxHourHeight: 128,
      minHourHeight: 48,
      startFocalY: 240,
      startHourHeight: 72
    })).toEqual({ hourHeight: 108, scale: 1.5, translateY: -120 });
  });

  it("tracks focal-point movement and clamps the live pinch range", () => {
    expect(calendarPinchTransform({
      currentFocalY: 260,
      gestureScale: 3,
      maxHourHeight: 128,
      minHourHeight: 48,
      startFocalY: 240,
      startHourHeight: 72
    })).toEqual({
      hourHeight: 128,
      scale: 128 / 72,
      translateY: 260 - 240 * (128 / 72)
    });
    expect(calendarPinchTransform({
      currentFocalY: 200,
      gestureScale: 0.1,
      maxHourHeight: 128,
      minHourHeight: 48,
      startFocalY: 200,
      startHourHeight: 72
    }).hourHeight).toBe(48);
  });

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
