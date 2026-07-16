export type CalendarSwipeGesture = { dx: number; dy: number; vx: number };

export type CalendarSwipeAxis = "day" | "week";

export type AnchoredCalendarScrollInput = {
  anchorY: number;
  currentMidpointY: number;
  nextHourHeight: number;
  startHourHeight: number;
  startMidpointY: number;
  startScrollY: number;
};

export type CalendarPinchTransformInput = {
  currentFocalY: number;
  gestureScale: number;
  maxHourHeight: number;
  minHourHeight: number;
  startFocalY: number;
  startHourHeight: number;
};

const CALENDAR_SWIPE_CAPTURE_DISTANCE = 6;
const CALENDAR_SWIPE_CAPTURE_INTENT_DISTANCE = 14;
const CALENDAR_SWIPE_COMMIT_DISTANCE = 16;
const CALENDAR_SWIPE_VELOCITY = 0.1;
const CALENDAR_SWIPE_CAPTURE_VERTICAL_RATIO = 0.18;
const CALENDAR_SWIPE_COMMIT_VERTICAL_RATIO = 0.18;

export function formatCalendarHourLabel(hour: number) {
  return `${pad2(((hour % 24) + 24) % 24)}:00`;
}

export function shouldCaptureCalendarSwipe(gesture: Pick<CalendarSwipeGesture, "dx" | "dy">) {
  const absDx = Math.abs(gesture.dx);
  const absDy = Math.abs(gesture.dy);
  return (
    absDx >= CALENDAR_SWIPE_CAPTURE_DISTANCE &&
    (
      absDx >= CALENDAR_SWIPE_CAPTURE_INTENT_DISTANCE ||
      absDx >= absDy * CALENDAR_SWIPE_CAPTURE_VERTICAL_RATIO
    )
  );
}

export function shouldCommitCalendarSwipe(gesture: CalendarSwipeGesture) {
  const absDx = Math.abs(gesture.dx);
  const absDy = Math.abs(gesture.dy);
  const farEnough = absDx >= CALENDAR_SWIPE_COMMIT_DISTANCE;
  const fastEnough = Math.abs(gesture.vx) >= CALENDAR_SWIPE_VELOCITY && absDx >= CALENDAR_SWIPE_CAPTURE_DISTANCE;

  return (
    (farEnough || fastEnough) &&
    absDx >= absDy * CALENDAR_SWIPE_COMMIT_VERTICAL_RATIO
  );
}

export function calendarSwipeDelta(axis: CalendarSwipeAxis, gesture: CalendarSwipeGesture) {
  if (!shouldCommitCalendarSwipe(gesture)) return 0;
  if (axis === "week") return gesture.dx < 0 ? -1 : 1;
  return gesture.dx < 0 ? 1 : -1;
}

export function anchoredCalendarScrollY({
  anchorY,
  currentMidpointY,
  nextHourHeight,
  startHourHeight,
  startMidpointY,
  startScrollY
}: AnchoredCalendarScrollInput) {
  if (!Number.isFinite(startHourHeight) || startHourHeight <= 0) {
    return Math.max(0, startScrollY);
  }
  const scale = nextHourHeight / startHourHeight;
  const scaledAnchorOffset = anchorY * (scale - 1);
  const fingerTranslation = startMidpointY - currentMidpointY;
  return Math.max(0, startScrollY + scaledAnchorOffset + fingerTranslation);
}

export function calendarPinchTransform({
  currentFocalY,
  gestureScale,
  maxHourHeight,
  minHourHeight,
  startFocalY,
  startHourHeight
}: CalendarPinchTransformInput) {
  "worklet";
  const safeStartHourHeight = Number.isFinite(startHourHeight) && startHourHeight > 0
    ? startHourHeight
    : minHourHeight;
  const unclampedHourHeight = safeStartHourHeight * (Number.isFinite(gestureScale) ? gestureScale : 1);
  const hourHeight = Math.min(maxHourHeight, Math.max(minHourHeight, unclampedHourHeight));
  const scale = hourHeight / safeStartHourHeight;
  const translateY = currentFocalY - startFocalY * scale;
  return { hourHeight, scale, translateY };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
