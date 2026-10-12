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
  now = new Date(),
  rowHeight,
  snapMinutes = calendarClickCreateSnapMinutes,
  startHour
}: {
  clientY: number;
  day: Date;
  dayBodyRect: { height: number; top: number };
  defaultDurationMinutes?: number;
  endHour: number;
  now?: Date;
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
    day.getTime(),
    now.getTime()
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
  const proposedStopMs = startedAtMs + defaultDurationMinutes * 60_000;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(proposedStopMs)) return null;
  // Blocks never start in the future; a slot that would run past now is held at now (floored to
  // the minute, as the drag ghost is), so a click just before the now line still creates.
  const stoppedAtMs = Math.min(proposedStopMs, floorToMinuteMs(now.getTime()));
  if (stoppedAtMs - startedAtMs < 60_000) return null;
  const stoppedAt = new Date(stoppedAtMs).toISOString();
  const stoppedAtDate = new Date(stoppedAt);
  const continuesIntoNextDay = formatLocalDate(stoppedAtDate) !== formatLocalDate(day);
  const visibleDurationMinutes = Math.min(
    (stoppedAtMs - startedAtMs) / 60_000,
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
  let endMinutes = visibleEnd >= axisEnd
    ? endHour * 60
    : visibleEnd.getHours() * 60 + visibleEnd.getMinutes();
  if (
    endMinutes <= startMinutes &&
    stop > start &&
    formatLocalDate(visibleStart) === formatLocalDate(visibleEnd)
  ) {
    endMinutes = Math.min(
      endHour * 60,
      startMinutes + Math.max(1, (visibleEnd.getTime() - visibleStart.getTime()) / 60_000)
    );
  }
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
    (pointerType === "mouse" || pointerType === "pen") &&
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

function floorToMinuteMs(ms: number) {
  return Math.floor(ms / 60_000) * 60_000;
}

/**
 * The latest local minute of `day` a new block may reach (owner decision, 12 Oct 2026: Calendar
 * creates past time only). A past day allows all of it, today stops at now (floored to the
 * minute) and a future day allows none.
 */
export function calendarCreateLimitMinutes(day: Date, now: Date) {
  const dayKey = formatLocalDate(day);
  const nowKey = formatLocalDate(now);
  if (dayKey < nowKey) return 24 * 60;
  if (dayKey > nowKey) return 0;
  return now.getHours() * 60 + now.getMinutes();
}

/** Whether a point on `day`'s minute axis lies in time a block can't start in (at or after now). */
export function calendarCreateMinuteIsFuture({
  day,
  minutes,
  now
}: {
  day: Date;
  minutes: number;
  now: Date;
}) {
  const limit = calendarCreateLimitMinutes(day, now);
  return limit < 24 * 60 && minutes >= limit;
}

/** Unsnapped minute-of-day under a pointer, clamped to the visible axis. */
export function calendarPointerMinutesAt({
  clientY,
  dayBodyTop,
  endHour,
  rowHeight,
  startHour
}: {
  clientY: number;
  dayBodyTop: number;
  endHour: number;
  rowHeight: number;
  startHour: number;
}) {
  return clamp(startHour * 60 + ((clientY - dayBodyTop) / rowHeight) * 60, startHour * 60, endHour * 60);
}

export const calendarDragSnapMinutes = 5;

/** Snapped (5-minute) minute-of-day under a pointer, clamped to the visible axis. */
export function calendarDragMinutesAt({
  clientY,
  dayBodyTop,
  endHour,
  rowHeight,
  startHour
}: {
  clientY: number;
  dayBodyTop: number;
  endHour: number;
  rowHeight: number;
  startHour: number;
}) {
  const raw = startHour * 60 + ((clientY - dayBodyTop) / rowHeight) * 60;
  const snapped = Math.round(raw / calendarDragSnapMinutes) * calendarDragSnapMinutes;
  return clamp(snapped, startHour * 60, endHour * 60);
}

/**
 * The range a drag on empty Calendar time describes: from the press to the pointer, in either
 * direction, never shorter than one 5-minute step and never past the visible axis. `limitMinutes`
 * (see `calendarCreateLimitMinutes`) holds the range at now, so the ghost never runs into the
 * future and always matches what release creates. The start always stays on the 5-minute grid:
 * when a full step no longer fits before the limit, the range starts at the last step before it
 * and ends at the limit, so a block near now may be shorter than 5 minutes (at least 1). Main's
 * axis-end rule (a full step ending at midnight) is the same rule with an on-grid limit.
 * `heldAtLimit` says the end is now rather than a grid time.
 */
export function calendarDragCreateRange({
  anchorMinutes,
  currentMinutes,
  endHour,
  limitMinutes = Number.POSITIVE_INFINITY,
  startHour
}: {
  anchorMinutes: number;
  currentMinutes: number;
  endHour: number;
  limitMinutes?: number;
  startHour: number;
}) {
  const step = calendarDragSnapMinutes;
  const lower = startHour * 60;
  const axisUpper = endHour * 60;
  const upper = Math.max(lower, Math.min(axisUpper, limitMinutes));
  const anchor = clamp(anchorMinutes, lower, upper);
  const current = clamp(currentMinutes, lower, upper);
  let startMinutes = Math.min(anchor, current);
  let endMinutes = Math.max(anchor, current);
  if (endMinutes - startMinutes < step) {
    endMinutes = startMinutes + step;
    if (endMinutes > upper) {
      endMinutes = upper;
      // The last grid step strictly before the limit (the limit itself is now, or midnight).
      startMinutes = Math.min(startMinutes, Math.ceil(upper / step) * step - step);
    }
  }
  return {
    endMinutes: clamp(endMinutes, lower, upper),
    heldAtLimit: upper < axisUpper && endMinutes >= upper,
    startMinutes: clamp(startMinutes, lower, upper)
  };
}

export const calendarCreateGhostMinHeightPx = 12;

/**
 * Where the drag ghost draws. It keeps a 12px minimum so its label stays legible, growing down
 * from the start as before — but never past the now line: on today (`limitMinutes`, see
 * `calendarCreateLimitMinutes`, for the shown now) a ghost whose minimum would cross the line
 * grows upward from just above it instead (its 2px gap kept), or as far up as the axis allows.
 * This covers a range ending at now and a short range ending just before it alike.
 */
export function calendarCreateGhostGeometry({
  endMinutes,
  limitMinutes = Number.POSITIVE_INFINITY,
  rowHeight,
  startHour,
  startMinutes
}: {
  endMinutes: number;
  limitMinutes?: number;
  rowHeight: number;
  startHour: number;
  startMinutes: number;
}) {
  const top = ((startMinutes - startHour * 60) / 60) * rowHeight;
  const span = ((endMinutes - startMinutes) / 60) * rowHeight;
  const height = Math.max(calendarCreateGhostMinHeightPx, span - 2);
  if (!Number.isFinite(limitMinutes)) return { height, top };
  const maxBottom = ((limitMinutes - startHour * 60) / 60) * rowHeight - 2;
  if (top + height <= maxBottom) return { height, top };
  return { height, top: Math.max(0, maxBottom - height) };
}

/** Real elapsed seconds of a dragged local range (DST-safe); null if either bound is nonexistent. */
export function calendarDragRangeSeconds(day: Date, startMinutes: number, endMinutes: number) {
  const startedAt = isoForLocalDateMinutes(day, startMinutes);
  const endIso = endMinutes >= 24 * 60
    ? (() => {
      const lastMinute = isoForLocalDateMinutes(day, 24 * 60 - 1);
      return lastMinute ? new Date(new Date(lastMinute).getTime() + 60_000).toISOString() : null;
    })()
    : isoForLocalDateMinutes(day, endMinutes);
  if (!startedAt || !endIso) return null;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startedAt).getTime()) / 1_000));
}

/**
 * ISO bounds for a dragged range; null when it starts in the future. A range that reaches now
 * (`endMinutes` at or past today's limit) ends at the exact current instant floored to the
 * minute — never at a wall time, which on a DST fall-back day would pick the wrong 01:30.
 */
export function calendarDragCreateSlot({
  day,
  endMinutes,
  now,
  startMinutes
}: {
  day: Date;
  endMinutes: number;
  now: Date;
  startMinutes: number;
}) {
  const startedAt = isoForLocalDateMinutes(day, startMinutes);
  if (!startedAt) return null;
  const startedAtMs = new Date(startedAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startedAtMs) || startedAtMs >= nowMs) return null;
  const limitMinutes = calendarCreateLimitMinutes(day, now);
  const nowFloorMs = floorToMinuteMs(nowMs);
  let endMs = nowFloorMs;
  if (limitMinutes >= 24 * 60 || endMinutes < limitMinutes) {
    const stoppedAtMs = endMinutes >= 24 * 60
      ? new Date(isoForLocalDateMinutes(day, 24 * 60 - 1) ?? "").getTime() + 60_000
      : new Date(isoForLocalDateMinutes(day, endMinutes) ?? "").getTime();
    if (!Number.isFinite(stoppedAtMs)) return null;
    endMs = Math.min(stoppedAtMs, nowFloorMs);
  }
  if (endMs - startedAtMs < 60_000) return null;
  return { startedAt, stoppedAt: new Date(endMs).toISOString() };
}

/**
 * The duration the drag ghost labels: the block release creates (exact, DST-safe bounds, ending at
 * the shown now when held there); the plain range when nothing would be created.
 */
export function calendarDragCreateSeconds({
  day,
  endMinutes,
  now,
  startMinutes
}: {
  day: Date;
  endMinutes: number;
  now: Date;
  startMinutes: number;
}) {
  const slot = calendarDragCreateSlot({ day, endMinutes, now, startMinutes });
  if (!slot) return calendarDragRangeSeconds(day, startMinutes, endMinutes) ?? 0;
  return Math.round((new Date(slot.stoppedAt).getTime() - new Date(slot.startedAt).getTime()) / 1_000);
}
