import { formatClockValue, type ClockFormat } from "@dayframe/shared";

export type CalendarGridDay = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
};

/** Monday first, everywhere (owner decision D4, 14 Oct 2026; a week-start setting is a Future track). */
export const CALENDAR_WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function buildCalendarGrid(year: number, month: number): CalendarGridDay[] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - ((first.getDay() + 6) % 7));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: formatLocalDate(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1
    };
  });
}

/** The `YYYY-MM-DD` day `days` days from `date` (local calendar days, DST-safe). */
export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return formatLocalDate(new Date(year, month - 1, day + days, 12));
}

export function formatLocalDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

/**
 * A typed time as `HH:MM`, or null. Digits alone: one or two are the hour (`9` → 09:00, `15` →
 * 15:00) and three or four are `H:MM` / `HH:MM` (`930` → 09:30, `1530` → 15:30). With a colon the
 * part before it is always the hour and a partial minute is its tens (`15:1` → 15:10, `15:` →
 * 15:00): digits never move across the colon into the hour (owner, 15 Oct 2026; `15:1` used to be
 * read as 01:51). An AM/PM suffix (`9:30 pm`, `930p`, `12 AM`) reads a 1–12 hour as 12-hour time;
 * either clock is understood whatever this browser's 12/24-hour setting (16 Oct 2026). Every
 * typed-time field shares this: Add time, the running start panel, and the quick editor and List
 * edges on commit.
 */
export function parseTimeInput(raw: string): string | null {
  const suffixed = MERIDIEM_SUFFIX.exec(raw.trim());
  const text = suffixed ? suffixed[1].trim() : raw.trim();
  let hour: number;
  let minute: number;
  const separated = /^(\d{1,2}):(\d{0,2})$/.exec(text);
  if (separated) {
    hour = Number(separated[1]);
    minute = Number(separated[2].padEnd(2, "0"));
  } else if (/^\d{1,4}$/.test(text)) {
    const padded = text.length <= 2 ? `${text.padStart(2, "0")}00` : text.padStart(4, "0");
    hour = Number(padded.slice(0, 2));
    minute = Number(padded.slice(2, 4));
  } else {
    return null;
  }
  if (suffixed) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffixed[2].toLowerCase() === "p" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A trailing `am`/`pm` (`a`, `p`, `a.m.`, any case, spaced or not); group 1 is the time before it. */
const MERIDIEM_SUFFIX = /^(.*?)\s*([ap])\.?\s*(?:m\.?)?$/i;

/**
 * What a typed-time field shows: a stored `HH:MM` in this browser's clock format (`21:30` →
 * `9:30 PM` in 12-hour mode), and anything else exactly as typed, so a half-typed time is never
 * rewritten under the caret.
 */
export function displayTypedTime(value: string, clock: ClockFormat) {
  return /^\d{2}:\d{2}$/.test(value) ? formatClockValue(value, clock) : value;
}

export function maskTimeInput(raw: string) {
  // A trailing AM/PM survives as " AM" / " PM" (" A" / " P" while it is being typed).
  const suffix = /\s*([ap])\.?\s*(m)?\.?\s*$/i.exec(raw);
  const body = suffix ? raw.slice(0, suffix.index) : raw;
  const digits = maskTimeDigits(body);
  const meridiem = suffix && /\d/.test(digits) ? ` ${suffix[1].toUpperCase()}${suffix[2] ? "M" : ""}` : "";
  return `${digits}${meridiem}`;
}

function maskTimeDigits(raw: string) {
  if (raw.includes(":")) {
    const [hours = "", minutes = ""] = raw.replace(/[^\d:]/g, "").split(":", 2);
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`;
  }
  // Keep compact digits intact while the user is typing. Inserting the colon
  // after the third digit changes the controlled input's caret position, so a
  // fourth digit can be inserted into the minutes and then truncated. The
  // owning editor normalises complete values (for example 1025 -> 10:25) and
  // blur handles valid three-digit shorthand (725 -> 07:25).
  return raw.replace(/\D/g, "").slice(0, 4);
}
