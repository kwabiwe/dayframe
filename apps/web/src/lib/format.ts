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

export function dateTimeLocal(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
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
