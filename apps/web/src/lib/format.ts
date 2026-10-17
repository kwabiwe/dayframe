import { formatClockTime, type ClockFormat } from "@dayframe/shared";
/**
 * Every web duration ("6h 25m", "35m", "<1m", "0m") is the shared `formatDuration` (audit
 * UIA-207, the same as iPhone's UIA-042), re-exported here and never wrapped (web UI audit WUI-033);
 * only running clocks use `formatClockDuration`.
 */
export { formatDuration } from "@dayframe/shared";

/**
 * The report CSV's duration cell ("1h 05m", "59m"), unchanged so existing spreadsheets keep
 * reading; the interface uses `formatDuration`.
 */
export function formatExportDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

/** A running clock, always H:MM:SS ("0:08:05"; web UI audit WUI-032, as the iPhone's live block). */
export function formatClockDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * A clock time of day in this device's 12/24-hour format ("09:30" or "9:30 AM"); components read
 * the format with `useClockFormat()`. Durations never use this.
 */
export function formatTime(value: string | Date, clock: ClockFormat) {
  return formatClockTime(value, clock);
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function dateTimeLocal(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function dateTimeLocalInputToIso(
  value: unknown,
  options: { timezoneOffsetMinutes?: number } = {}
) {
  if (typeof value !== "string") return null;
  const match = dateTimeLocalPattern.exec(value.trim());
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  if (
    utcCandidate.getUTCFullYear() !== year ||
    utcCandidate.getUTCMonth() !== month - 1 ||
    utcCandidate.getUTCDate() !== day ||
    utcCandidate.getUTCHours() !== hour ||
    utcCandidate.getUTCMinutes() !== minute
  ) {
    return null;
  }

  if (options.timezoneOffsetMinutes !== undefined) {
    return new Date(
      utcCandidate.getTime() + options.timezoneOffsetMinutes * 60_000
    ).toISOString();
  }

  return dateTimeLocalInputToIsoCandidates(value)[0] ?? null;
}

/**
 * Returns every exact instant represented by a local minute. Most minutes have
 * one candidate, fall-back minutes have two, and spring-forward gaps have none.
 */
export function dateTimeLocalInputToIsoCandidates(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const normalized = value.trim();
  const match = dateTimeLocalPattern.exec(normalized);
  if (!match) return [];

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (
    utcCandidate.getUTCFullYear() !== year ||
    utcCandidate.getUTCMonth() !== month - 1 ||
    utcCandidate.getUTCDate() !== day ||
    utcCandidate.getUTCHours() !== hour ||
    utcCandidate.getUTCMinutes() !== minute
  ) {
    return [];
  }

  const localCandidate = new Date(year, month - 1, day, hour, minute, 0, 0);
  const offsetProbes = [
    localCandidate,
    new Date(year, month - 1, day - 1, 12, 0, 0, 0),
    new Date(year, month - 1, day + 1, 12, 0, 0, 0)
  ];
  const offsets = new Set(offsetProbes.map((probe) => probe.getTimezoneOffset()));
  const candidates = [...offsets]
    .map((offset) => new Date(utcCandidate.getTime() + offset * 60_000))
    .filter((candidate) => dateTimeLocal(candidate) === normalized)
    .map((candidate) => candidate.toISOString());

  return [...new Set(candidates)].sort();
}

export function durationInputValue(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

export function parseDurationInput(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return null;

  const clockMatch = /^(\d+):([0-5]\d)$/.exec(text);
  if (clockMatch) {
    const hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2]);
    const totalSeconds = hours * 3600 + minutes * 60;
    return totalSeconds > 0 ? totalSeconds : null;
  }

  const minutesOnlyMatch = /^(\d+)\s*m?$/.exec(text);
  if (minutesOnlyMatch) {
    const totalSeconds = Number(minutesOnlyMatch[1]) * 60;
    return totalSeconds > 0 ? totalSeconds : null;
  }

  const tokenPattern =
    /(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let totalSeconds = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text))) {
    const amount = Number(match[1]);
    const unit = match[2];
    totalSeconds += unit.startsWith("h") ? amount * 3600 : amount * 60;
    consumed += match[0];
  }

  const leftover = text.replace(tokenPattern, "").trim();
  if (!consumed || leftover) return null;
  return totalSeconds > 0 ? totalSeconds : null;
}

const sourceLabels: Record<string, string> = {
  manual_app: "Web app",
  mobile_app: "Mobile app",
  nfc: "NFC",
  widget: "Widget",
  shortcut: "Shortcut",
  geofence_specific: "Specific place",
  geofence_broad: "Broad place",
  calendar: "Calendar",
  health_sleep: "Health sleep",
  health_workout: "Health workout",
  location_learning: "Location learning",
  // Log automatically (owner decision 14 Oct 2026): a visit logged as a block without a Review card.
  location_auto_log: "Logged automatically",
  home_assistant: "Home Assistant",
  ha_button: "Home Assistant button",
  ha_geofence: "Home Assistant geofence"
};

const eventLabels: Record<string, string> = {
  timer_start: "Started timer",
  timer_stop: "Stopped timer",
  timer_switch: "Switched timer",
  quick_action: "Quick action",
  manual_entry: "Manual entry",
  geofence_enter: "Entered place",
  geofence_exit: "Left place",
  commute_detected: "Trip",
  learned_place_visit: "Learned place visit",
  review_accept: "Accepted review",
  review_ignore: "Ignored review",
  review_rule: "Created rule",
  entry_update: "Edited entry",
  entry_delete: "Deleted entry"
};

/**
 * A friendly source name. For one block, pass its place: an auto-logged visit then reads
 * "Logged automatically · {place}" (Log automatically, owner decision 14 Oct 2026).
 */
export function formatSourceLabel(value?: string | null, options: { placeName?: string | null } = {}) {
  if (!value) return "Unknown source";
  const label = sourceLabels[value] ?? formatMachineLabel(value);
  const place = options.placeName?.trim();
  return value === "location_auto_log" && place ? `${label} · ${place}` : label;
}

export function formatEventLabel(value?: string | null) {
  if (!value) return "Event";
  return eventLabels[value] ?? formatMachineLabel(value);
}

/** Activity label: every Move, time away from a place included, is a trip (PRD D19). */
export function formatActivityEventLabel(event: { eventType?: string | null; timeAway?: boolean }) {
  return event.timeAway ? "Trip" : formatEventLabel(event.eventType);
}

export function formatMachineLabel(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "nfc") return "NFC";
      if (part.toLowerCase() === "ha") return "Home Assistant";
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}
