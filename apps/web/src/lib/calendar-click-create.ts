import { formatLocalDate } from "@/lib/calendar-grid";
import { dateTimeLocalInputToIso } from "@/lib/format";

export const calendarClickCreateSnapMinutes = 15;
export const calendarClickCreateDurationMinutes = 30;
export const calendarClickCreateScrollTolerancePx = 1;

export type CalendarClickCreateSlot = {
  continuesIntoNextDay: boolean;
  height: number;
  rawMinutes: number;
  startedAt: string;
  startMinutes: number;
  stoppedAt: string;
  top: number;
};

export type CalendarDraftAnchorGeometry = {
  continuesIntoNextDay: boolean;
  height: number;
  top: number;
};

export type CalendarCreatePointerSequence = {
  clientX: number;
  clientY: number;
  dayKey: string;
  pointerId: number;
  pointerDownTimeStamp: number;
  scrollLeft: number;
  scrollTop: number;
};

export type CalendarConsumedPointer = {
  pointerDownTimeStamp: number;
  pointerId: number;
  sessionId: number;
};

export type CalendarCreateTargetKind =
  | "day-body"
  | "entry"
  | "action"
  | "resize"
  | "draft"
  | "other";

export function calculateCalendarClickCreateSlot({
  clientY,
  day,
  dayBodyRect,
  defaultDurationMinutes = calendarClickCreateDurationMinutes,
  endHour,
  rowHeight,
  snapMinutes = calendarClickCreateSnapMinutes,
  startHour
}: {
  clientY: number;
  day: Date;
  dayBodyRect: { height: number; top: number };
  defaultDurationMinutes?: number;
  endHour: number;
  rowHeight: number;
  snapMinutes?: number;
  startHour: number;
}): CalendarClickCreateSlot | null {
  const values = [
    clientY,
    dayBodyRect.height,
    dayBodyRect.top,
    defaultDurationMinutes,
    endHour,
    rowHeight,
    snapMinutes,
    startHour,
    day.getTime()
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    dayBodyRect.height <= 0 ||
    rowHeight <= 0 ||
    snapMinutes <= 0 ||
    defaultDurationMinutes <= 0 ||
    endHour <= startHour
  ) {
    return null;
  }

  const startBoundaryMinutes = startHour * 60;
  const endBoundaryMinutes = endHour * 60;
  const relativeY = clamp(clientY - dayBodyRect.top, 0, dayBodyRect.height);
  const rawMinutes = startBoundaryMinutes + (relativeY / rowHeight) * 60;
  const flooredMinutes = Math.floor(rawMinutes / snapMinutes) * snapMinutes;
  const startMinutes = clamp(
    flooredMinutes,
    startBoundaryMinutes,
    endBoundaryMinutes - snapMinutes
  );
  const startedAt = isoForLocalDateMinutes(day, startMinutes);
  if (!startedAt) return null;

  const startedAtMs = new Date(startedAt).getTime();
  const stoppedAtMs = startedAtMs + defaultDurationMinutes * 60_000;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(stoppedAtMs)) return null;
  const stoppedAt = new Date(stoppedAtMs).toISOString();
  const stoppedAtDate = new Date(stoppedAt);
  const continuesIntoNextDay = formatLocalDate(stoppedAtDate) !== formatLocalDate(day);
  const visibleDurationMinutes = Math.min(
    defaultDurationMinutes,
    endBoundaryMinutes - startMinutes
  );

  return {
    continuesIntoNextDay,
    height: (visibleDurationMinutes / 60) * rowHeight,
    rawMinutes,
    startedAt,
    startMinutes,
    stoppedAt,
    top: ((startMinutes - startBoundaryMinutes) / 60) * rowHeight
  };
}

export function calculateCalendarDraftAnchorGeometry({
  day,
  endHour,
  rowHeight,
  startedAt,
  startHour,
  stoppedAt
}: {
  day: Date;
  endHour: number;
  rowHeight: number;
  startedAt: string;
  startHour: number;
  stoppedAt: string;
}): CalendarDraftAnchorGeometry | null {
  const start = new Date(startedAt);
  const stop = new Date(stoppedAt);
  if (
    !Number.isFinite(day.getTime()) ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(stop.getTime()) ||
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0 ||
    endHour <= startHour ||
    stop <= start
  ) {
    return null;
  }

  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const axisStart = new Date(dayStart);
  axisStart.setHours(startHour, 0, 0, 0);
  const axisEnd = new Date(dayStart);
  axisEnd.setHours(endHour, 0, 0, 0);
  const visibleStart = new Date(Math.max(start.getTime(), axisStart.getTime()));
  const visibleEnd = new Date(Math.min(stop.getTime(), axisEnd.getTime()));
  if (visibleEnd <= visibleStart) return null;

  const startMinutes = visibleStart <= axisStart
    ? startHour * 60
    : visibleStart.getHours() * 60 + visibleStart.getMinutes();
  const endMinutes = visibleEnd >= axisEnd
    ? endHour * 60
    : visibleEnd.getHours() * 60 + visibleEnd.getMinutes();
  return {
    continuesIntoNextDay: stop > dayEnd,
    height: ((endMinutes - startMinutes) / 60) * rowHeight,
    top: ((startMinutes - startHour * 60) / 60) * rowHeight
  };
}

export function isEligibleCalendarCreatePointer({
  button,
  consumed,
  ctrlKey,
  defaultPrevented,
  isPrimary,
  pointerType,
  resizeActive,
  targetKind
}: {
  button: number;
  consumed: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isPrimary: boolean;
  pointerType: string;
  resizeActive: boolean;
  targetKind: CalendarCreateTargetKind;
}) {
  return (
    button === 0 &&
    pointerType === "mouse" &&
    isPrimary &&
    !ctrlKey &&
    !defaultPrevented &&
    !resizeActive &&
    !consumed &&
    targetKind === "day-body"
  );
}

export function calendarCreatePointerSequenceAccepted({
  cancelled = false,
  clientX,
  clientY,
  consumed = false,
  dayKey,
  movementThresholdPx,
  pointerId,
  scrollLeft,
  scrollTop,
  sequence,
  targetEligible
}: {
  cancelled?: boolean;
  clientX: number;
  clientY: number;
  consumed?: boolean;
  dayKey: string;
  movementThresholdPx: number;
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
  sequence: CalendarCreatePointerSequence | null;
  targetEligible: boolean;
}) {
  if (
    !sequence ||
    cancelled ||
    consumed ||
    !targetEligible ||
    !Number.isFinite(movementThresholdPx) ||
    movementThresholdPx <= 0 ||
    sequence.pointerId !== pointerId ||
    sequence.dayKey !== dayKey
  ) {
    return false;
  }

  const movement = Math.hypot(clientX - sequence.clientX, clientY - sequence.clientY);
  const scrollDelta = Math.max(
    Math.abs(scrollLeft - sequence.scrollLeft),
    Math.abs(scrollTop - sequence.scrollTop)
  );
  return movement < movementThresholdPx && scrollDelta <= calendarClickCreateScrollTolerancePx;
}

export function calendarPointerMatchesConsumed(
  token: CalendarConsumedPointer | null,
  pointer: Pick<CalendarConsumedPointer, "pointerDownTimeStamp" | "pointerId">
) {
  return Boolean(
    token &&
    token.pointerId === pointer.pointerId &&
    token.pointerDownTimeStamp === pointer.pointerDownTimeStamp
  );
}

export function calendarPointHitsSemanticBlock({
  blocks,
  clientX,
  clientY,
  dayBodyTop
}: {
  blocks: ReadonlyArray<{
    height: number;
    left: number;
    right: number;
    top: number;
  }>;
  clientX: number;
  clientY: number;
  dayBodyTop: number;
}) {
  const relativeY = clientY - dayBodyTop;
  return blocks.some((block) => (
    clientX >= block.left &&
    clientX <= block.right &&
    relativeY >= block.top &&
    relativeY < block.top + block.height
  ));
}

function isoForLocalDateMinutes(day: Date, minutes: number) {
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return dateTimeLocalInputToIso(
    `${formatLocalDate(day)}T${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
