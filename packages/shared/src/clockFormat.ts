/**
 * Clock times of day ("09:30" or "9:30 AM") for every Dayframe surface (owner decision 16 Oct
 * 2026). The 12/24-hour choice is a per-device setting — web keeps it in localStorage, iPhone on
 * the phone — and defaults to following the system. Durations and running clocks are never clock
 * times and keep their own formatters (`formatDuration`).
 */
export type ClockFormat = "12h" | "24h";
export type ClockFormatPreference = "system" | ClockFormat;

export const CLOCK_FORMAT_PREFERENCES: readonly ClockFormatPreference[] = ["system", "12h", "24h"];

export function isClockFormatPreference(value: unknown): value is ClockFormatPreference {
  return value === "system" || value === "12h" || value === "24h";
}

/** The clock format to use: the stored choice, or the system's when it follows the system. */
export function resolveClockFormat(preference: ClockFormatPreference, system: ClockFormat): ClockFormat {
  return preference === "system" ? system : preference;
}

/**
 * The format the runtime's default locale uses. Browsers and Hermes report the locale's hour
 * cycle (`h11`/`h12` are 12-hour); anything unreadable keeps Dayframe's 24-hour default.
 */
export function systemClockFormat(locale?: string): ClockFormat {
  try {
    const options = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & {
      hourCycle?: string;
    };
    if (options.hourCycle === "h11" || options.hourCycle === "h12") return "12h";
    if (options.hourCycle === "h23" || options.hourCycle === "h24") return "24h";
    return options.hour12 === true ? "12h" : "24h";
  } catch {
    return "24h";
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function meridiem(hour: number) {
  return hour % 24 < 12 ? "AM" : "PM";
}

function twelveHour(hour: number) {
  const value = hour % 12;
  return value === 0 ? 12 : value;
}

/**
 * One clock time from an hour (0–24; 24 is the end of a day) and a minute: "09:30" or "9:30 AM".
 * The end of the day reads "24:00" in 24-hour mode and "12:00 AM" in 12-hour mode.
 */
export function formatClockParts(hour: number, minute: number, format: ClockFormat): string {
  if (format === "24h") return `${pad2(hour)}:${pad2(minute)}`;
  return `${twelveHour(hour)}:${pad2(minute)} ${meridiem(hour)}`;
}

/** A whole-hour axis label: "08:00" or "8 AM" ("12 PM" at noon, "12 AM" at midnight). */
export function formatClockHour(hour: number, format: ClockFormat): string {
  if (format === "24h") return `${pad2(hour)}:00`;
  return `${twelveHour(hour)} ${meridiem(hour)}`;
}

/** Minutes after local midnight (0–1440) as a clock time. */
export function formatClockMinutes(minutes: number, format: ClockFormat): string {
  const safe = Math.max(0, Math.round(minutes));
  return formatClockParts(Math.floor(safe / 60), safe % 60, format);
}

/** A moment as a clock time in the runtime's local zone (the device's own zone). */
export function formatClockTime(value: string | number | Date, format: ClockFormat): string {
  const date = value instanceof Date ? value : new Date(value);
  return formatClockParts(date.getHours(), date.getMinutes(), format);
}

/** A canonical "HH:MM" (24-hour) value, as typed fields store it, in the device's format. */
export function formatClockValue(value: string, format: ClockFormat): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  return formatClockParts(Number(match[1]), Number(match[2]), format);
}
