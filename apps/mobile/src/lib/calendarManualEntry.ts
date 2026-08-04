import type { MobileTimeEntry } from "./api";

const CALENDAR_SLOT_MINUTES = 15;
const CALENDAR_DEFAULT_DURATION_MS = 30 * 60 * 1000;
const CALENDAR_LAST_START_MINUTE = 23 * 60 + 45;

export const CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR =
  "That time cannot be represented safely because the clocks change on this date. Choose another time.";
export const CALENDAR_MANUAL_ENTRY_INVALID_ERROR =
  "Choose a valid Calendar date and time, then try again.";

export type CalendarManualEntryDraftResult =
  | { ok: true; entry: MobileTimeEntry }
  | { ok: false; error: string };

export type CalendarManualEntryRequestResult =
  | { ok: true; entry: MobileTimeEntry }
  | { ok: false; ignored: true }
  | { ok: false; ignored: false; error: string };

let calendarDraftSequence = 0;

export function createCalendarManualEntryDraft({
  dayKey,
  startMinute,
  now
}: {
  dayKey: string;
  startMinute: number;
  now: number;
}): CalendarManualEntryDraftResult {
  const day = parseLocalDayKey(dayKey);
  if (!day || !Number.isFinite(startMinute) || !Number.isFinite(now)) {
    return { ok: false, error: CALENDAR_MANUAL_ENTRY_INVALID_ERROR };
  }

  const normalizedStartMinute = Math.min(
    CALENDAR_LAST_START_MINUTE,
    Math.max(0, Math.floor(startMinute / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_MINUTES)
  );
  const start = new Date(
    day.year,
    day.month - 1,
    day.day,
    Math.floor(normalizedStartMinute / 60),
    normalizedStartMinute % 60,
    0,
    0
  );

  if (!matchesLocalComponents(start, {
    ...day,
    hour: Math.floor(normalizedStartMinute / 60),
    minute: normalizedStartMinute % 60
  })) {
    return { ok: false, error: CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR };
  }

  const finish = new Date(start.getTime() + CALENDAR_DEFAULT_DURATION_MS);
  if (
    finish.getTime() <= start.getTime()
    || finish.getTime() - start.getTime() !== CALENDAR_DEFAULT_DURATION_MS
    || !roundTripsThroughMinutePrecision(start)
    || !roundTripsThroughMinutePrecision(finish)
  ) {
    return { ok: false, error: CALENDAR_MANUAL_ENTRY_CLOCK_CHANGE_ERROR };
  }

  calendarDraftSequence += 1;
  return {
    ok: true,
    entry: {
      categoryColor: null,
      categoryId: null,
      categoryName: null,
      clientName: null,
      confidence: "manual",
      description: null,
      durationSeconds: CALENDAR_DEFAULT_DURATION_MS / 1000,
      id: `manual-draft:calendar:${dayKey}:${normalizedStartMinute}:${now}:${calendarDraftSequence}`,
      placeName: null,
      projectColor: null,
      projectId: null,
      projectName: null,
      reviewStatus: "confirmed",
      source: "manual_app",
      startedAt: start.toISOString(),
      stoppedAt: finish.toISOString(),
      tagNames: [],
      tags: []
    }
  };
}

export function resolveCalendarManualEntryRequest({
  dayKey,
  selectedDayKey,
  startMinute,
  now
}: {
  dayKey: string;
  selectedDayKey: string;
  startMinute: number;
  now: number;
}): CalendarManualEntryRequestResult {
  if (dayKey !== selectedDayKey) return { ok: false, ignored: true };
  const result = createCalendarManualEntryDraft({ dayKey, startMinute, now });
  return result.ok
    ? result
    : { ok: false, ignored: false, error: result.error };
}

function parseLocalDayKey(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    !Number.isFinite(candidate.getTime())
    || candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function matchesLocalComponents(
  date: Date,
  components: { year: number; month: number; day: number; hour: number; minute: number }
) {
  return Number.isFinite(date.getTime())
    && date.getFullYear() === components.year
    && date.getMonth() === components.month - 1
    && date.getDate() === components.day
    && date.getHours() === components.hour
    && date.getMinutes() === components.minute
    && date.getSeconds() === 0
    && date.getMilliseconds() === 0;
}

function roundTripsThroughMinutePrecision(date: Date) {
  const reconstructed = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    0,
    0
  );
  return reconstructed.getTime() === date.getTime();
}
