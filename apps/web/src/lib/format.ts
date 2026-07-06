export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatClockDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours === 0) {
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

export function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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

  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ??
    new Date(year, month - 1, day, hour, minute, 0, 0).getTimezoneOffset();
  return new Date(utcCandidate.getTime() + timezoneOffsetMinutes * 60_000).toISOString();
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
  review_accept: "Accepted review",
  review_ignore: "Ignored review",
  review_rule: "Created rule",
  entry_update: "Edited entry",
  entry_delete: "Deleted entry"
};

export function formatSourceLabel(value?: string | null) {
  if (!value) return "Unknown source";
  return sourceLabels[value] ?? formatMachineLabel(value);
}

export function formatEventLabel(value?: string | null) {
  if (!value) return "Activity";
  return eventLabels[value] ?? formatMachineLabel(value);
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
