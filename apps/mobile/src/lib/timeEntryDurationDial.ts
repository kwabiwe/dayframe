export const TIME_ENTRY_DIAL_MIN_DURATION_MS = 1_000;
export const TIME_ENTRY_DIAL_MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
export const TIME_ENTRY_DIAL_MINUTE_MS = 60_000;
export const TIME_ENTRY_DIAL_ROUNDING_MS = 5 * TIME_ENTRY_DIAL_MINUTE_MS;
export const TIME_ENTRY_DIAL_FULL_TURN_RADIANS = Math.PI * 2;

export type TimeEntryDialInterval = {
  endMs: number;
  startMs: number;
};

export type TimeEntryDialHandle = "start" | "end" | "range";

export type TimeEntryDialMode = "running" | "stopped";

export type TimeEntryDialAdjustment = {
  handle: TimeEntryDialHandle;
  interval: TimeEntryDialInterval;
  minuteDelta: number;
  mode: TimeEntryDialMode;
  nowMs?: number;
};

function finiteTimestamp(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function normalizeTimeEntryDialInterval(
  interval: TimeEntryDialInterval
): TimeEntryDialInterval {
  const startMs = finiteTimestamp(interval.startMs, 0);
  const candidateEnd = finiteTimestamp(interval.endMs, startMs + TIME_ENTRY_DIAL_MIN_DURATION_MS);
  const endMs = Math.min(
    Math.max(candidateEnd, startMs + TIME_ENTRY_DIAL_MIN_DURATION_MS),
    startMs + TIME_ENTRY_DIAL_MAX_DURATION_MS
  );
  return { startMs, endMs };
}

export function adjustTimeEntryDial({
  handle,
  interval,
  minuteDelta,
  mode,
  nowMs
}: TimeEntryDialAdjustment): TimeEntryDialInterval {
  const normalized = normalizeTimeEntryDialInterval(interval);
  const roundedMinuteDelta = Number.isFinite(minuteDelta) ? Math.round(minuteDelta) : 0;
  const deltaMs = roundedMinuteDelta * TIME_ENTRY_DIAL_MINUTE_MS;

  if (mode === "running") {
    const lockedEndMs = finiteTimestamp(nowMs ?? normalized.endMs, normalized.endMs);
    if (handle !== "start") {
      return {
        startMs: Math.min(
          Math.max(normalized.startMs, lockedEndMs - TIME_ENTRY_DIAL_MAX_DURATION_MS),
          lockedEndMs - TIME_ENTRY_DIAL_MIN_DURATION_MS
        ),
        endMs: lockedEndMs
      };
    }
    const candidateStart = normalized.startMs + deltaMs;
    return {
      startMs: Math.min(
        Math.max(candidateStart, lockedEndMs - TIME_ENTRY_DIAL_MAX_DURATION_MS),
        lockedEndMs - TIME_ENTRY_DIAL_MIN_DURATION_MS
      ),
      endMs: lockedEndMs
    };
  }

  if (handle === "range") {
    return {
      startMs: normalized.startMs + deltaMs,
      endMs: normalized.endMs + deltaMs
    };
  }

  if (handle === "start") {
    return {
      startMs: Math.min(
        Math.max(
          normalized.startMs + deltaMs,
          normalized.endMs - TIME_ENTRY_DIAL_MAX_DURATION_MS
        ),
        normalized.endMs - TIME_ENTRY_DIAL_MIN_DURATION_MS
      ),
      endMs: normalized.endMs
    };
  }

  return {
    startMs: normalized.startMs,
    endMs: Math.min(
      Math.max(
        normalized.endMs + deltaMs,
        normalized.startMs + TIME_ENTRY_DIAL_MIN_DURATION_MS
      ),
      normalized.startMs + TIME_ENTRY_DIAL_MAX_DURATION_MS
    )
  };
}

export function mergeTimeEntryDialLocalDateTime({
  baseTimestampMs,
  dateText,
  timeText
}: {
  baseTimestampMs: number;
  dateText: string;
  timeText: string;
}): { timestampMs: number | null; error: string | null } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!dateMatch) return { timestampMs: null, error: "Enter the date as YYYY-MM-DD." };
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!timeMatch) return { timestampMs: null, error: "Enter the time as HH:mm." };

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { timestampMs: null, error: "Enter a valid date and time." };
  }

  const base = new Date(finiteTimestamp(baseTimestampMs, 0));
  const timestamp = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    base.getSeconds(),
    base.getMilliseconds()
  );
  if (
    timestamp.getFullYear() !== year ||
    timestamp.getMonth() !== month - 1 ||
    timestamp.getDate() !== day ||
    timestamp.getHours() !== hour ||
    timestamp.getMinutes() !== minute
  ) {
    return { timestampMs: null, error: "Enter a valid date and time." };
  }
  return { timestampMs: timestamp.getTime(), error: null };
}

export function unwrapTimeEntryDialAngle(previousAngle: number, nextAngle: number) {
  if (!Number.isFinite(previousAngle) || !Number.isFinite(nextAngle)) return 0;
  let delta = nextAngle - previousAngle;
  while (delta > Math.PI) delta -= TIME_ENTRY_DIAL_FULL_TURN_RADIANS;
  while (delta <= -Math.PI) delta += TIME_ENTRY_DIAL_FULL_TURN_RADIANS;
  return delta;
}

export function timeEntryDialMinuteDeltaForRadians(radians: number) {
  if (!Number.isFinite(radians)) return 0;
  return Math.round((radians / TIME_ENTRY_DIAL_FULL_TURN_RADIANS) * 60);
}

export function timeEntryDialAngleForTimestamp(timestampMs: number) {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return -Math.PI / 2;
  const secondsWithinHour = (
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1_000
  );
  return (secondsWithinHour / 3_600) * TIME_ENTRY_DIAL_FULL_TURN_RADIANS - Math.PI / 2;
}

export function timeEntryDialRangeHandleAngle(interval: TimeEntryDialInterval) {
  const normalized = normalizeTimeEntryDialInterval(interval);
  const midpointMs = normalized.startMs + (normalized.endMs - normalized.startMs) / 2;
  return timeEntryDialAngleForTimestamp(midpointMs);
}

export function roundTimeEntryDialTimestamp(timestampMs: number) {
  const timestamp = finiteTimestamp(timestampMs, 0);
  return Math.floor((timestamp + TIME_ENTRY_DIAL_ROUNDING_MS / 2) / TIME_ENTRY_DIAL_ROUNDING_MS) *
    TIME_ENTRY_DIAL_ROUNDING_MS;
}

export function roundTimeEntryDialStop(interval: TimeEntryDialInterval) {
  const normalized = normalizeTimeEntryDialInterval(interval);
  return normalizeTimeEntryDialInterval({
    startMs: normalized.startMs,
    endMs: roundTimeEntryDialTimestamp(normalized.endMs)
  });
}

export function roundTimeEntryDialDuration(
  interval: TimeEntryDialInterval,
  mode: TimeEntryDialMode,
  nowMs?: number
) {
  const normalized = normalizeTimeEntryDialInterval(interval);
  const lockedEndMs = mode === "running"
    ? finiteTimestamp(nowMs ?? normalized.endMs, normalized.endMs)
    : normalized.endMs;
  const durationMs = Math.min(
    TIME_ENTRY_DIAL_MAX_DURATION_MS,
    Math.max(TIME_ENTRY_DIAL_MIN_DURATION_MS, lockedEndMs - normalized.startMs)
  );
  const roundedDurationMs = Math.min(
    TIME_ENTRY_DIAL_MAX_DURATION_MS,
    Math.max(
      TIME_ENTRY_DIAL_MIN_DURATION_MS,
      Math.floor((durationMs + TIME_ENTRY_DIAL_ROUNDING_MS / 2) / TIME_ENTRY_DIAL_ROUNDING_MS) *
        TIME_ENTRY_DIAL_ROUNDING_MS
    )
  );
  return {
    startMs: mode === "running" ? lockedEndMs - roundedDurationMs : normalized.startMs,
    endMs: mode === "running" ? lockedEndMs : normalized.startMs + roundedDurationMs
  };
}

export function formatTimeEntryDialDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.min(
    TIME_ENTRY_DIAL_MAX_DURATION_MS,
    Math.floor(durationMs)
  )) / 1_000;
  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const seconds = wholeSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function timeEntryDialHapticLevel(previousMinuteDelta: number, nextMinuteDelta: number) {
  if (previousMinuteDelta === nextMinuteDelta) return null;
  if (nextMinuteDelta !== 0 && nextMinuteDelta % 60 === 0) return "hour" as const;
  if (nextMinuteDelta !== 0 && nextMinuteDelta % 5 === 0) return "five_minutes" as const;
  return "minute" as const;
}
