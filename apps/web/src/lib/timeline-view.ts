export const TIMELINE_SCOPES = ["day", "week"] as const;
// Timesheet left Calendar (owner, 11 Oct): an old view=timesheet link or cookie opens the Calendar.
export const TIMELINE_VIEWS = ["calendar", "list"] as const;

export type TimelineScope = (typeof TIMELINE_SCOPES)[number];
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

export type TimelineState = {
  date: string;
  scope: TimelineScope;
  view: TimelineView;
};

export type TimelinePreference = {
  lastView: TimelineView;
  preferredScope: TimelineScope;
};

export const TIMELINE_PREFERENCE_COOKIE = "dayframe_timeline_preference";
export const DEFAULT_TIMELINE_PREFERENCE: TimelinePreference = {
  lastView: "calendar",
  preferredScope: "week"
};

export type TimelineRange = {
  start: Date;
  end: Date;
};

export type TimelineRanges = {
  day: TimelineRange;
  week: TimelineRange;
  active: TimelineRange;
  weekDays: Date[];
};

type SearchValue = string | string[] | null | undefined;
export type TimelineSearchInput =
  | Pick<URLSearchParams, "get" | "toString">
  | Record<string, SearchValue>;

/**
 * The Calendar state from its URL. A missing or invalid date opens today: `today` (a date key the
 * server worked out in the viewer's zone) when given, otherwise today in the process's own zone.
 */
export function timelineStateFromSearchParams(
  input: TimelineSearchInput,
  options: { now?: Date; preference?: TimelinePreference | null; today?: string | null } = {}
): TimelineState {
  const now = parseTimelineDateKey(options.today) ?? startOfLocalDay(options.now ?? new Date());
  const date = toTimelineDateKey(parseTimelineDateKey(searchValue(input, "date")) ?? now);
  const requestedScope = searchValue(input, "scope");
  const requestedView = searchValue(input, "view");
  const preference = normalizeTimelinePreference(options.preference);
  const view = requestedView == null
    ? preference.lastView
    : isTimelineView(requestedView)
      ? requestedView
      : DEFAULT_TIMELINE_PREFERENCE.lastView;
  const scope = requestedScope == null
    ? preference.preferredScope
    : isTimelineScope(requestedScope)
      ? requestedScope
      : DEFAULT_TIMELINE_PREFERENCE.preferredScope;

  return { date, scope, view };
}

/**
 * The preference a first visit uses when the browser has no Calendar cookie yet: a phone (its user
 * agent says "Mobi", as MDN recommends) opens Day, since a week of seven columns leaves each day
 * too narrow to read at phone width; everything else keeps the usual Week. Once the user picks a
 * view or scope, the cookie decides.
 */
export function firstVisitTimelinePreference(userAgent: string | null | undefined): TimelinePreference | null {
  return userAgent && /Mobi/.test(userAgent) ? { lastView: DEFAULT_TIMELINE_PREFERENCE.lastView, preferredScope: "day" } : null;
}

export function timelinePreferenceFromCookieValue(value?: string | null): TimelinePreference | null {
  if (!value) return null;
  const [lastView, preferredScope] = value.split(":");
  if (!isTimelineView(lastView) || !isTimelineScope(preferredScope)) return null;
  return { lastView, preferredScope };
}

export function timelinePreferenceCookieValue(preference: TimelinePreference) {
  const normalized = normalizeTimelinePreference(preference);
  return `${normalized.lastView}:${normalized.preferredScope}`;
}

export function updateTimelinePreference(
  state: Pick<TimelineState, "scope" | "view">
): TimelinePreference {
  return { lastView: state.view, preferredScope: state.scope };
}

export function timelineSearchString(input: TimelineSearchInput) {
  return mutableSearchParams(input).toString();
}

export function timelineHref(
  input: TimelineSearchInput | string,
  state: TimelineState,
  overrides: Partial<TimelineState> = {}
) {
  const source = typeof input === "string" ? new URLSearchParams(input) : mutableSearchParams(input);
  const normalized = normalizeTimelineState({ ...state, ...overrides });
  const params = new URLSearchParams({
    date: normalized.date,
    scope: normalized.scope,
    view: normalized.view
  });

  for (const [name, value] of source.entries()) {
    if (name === "date" || name === "scope" || name === "view") continue;
    params.append(name, value);
  }

  return `/timeline?${params.toString()}`;
}

export function resolveTimelineRanges(state: TimelineState): TimelineRanges {
  const selectedDate = parseTimelineDateKey(state.date) ?? startOfLocalDay(new Date());
  const dayStart = startOfLocalDay(selectedDate);
  const day = { start: dayStart, end: addCalendarDays(dayStart, 1) };
  const weekStart = startOfMondayWeek(dayStart);
  const week = { start: weekStart, end: addCalendarDays(weekStart, 7) };

  return {
    day,
    week,
    active: state.scope === "day" ? day : week,
    weekDays: Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index))
  };
}

export function shiftTimelineState(
  state: TimelineState,
  direction: "previous" | "next"
): TimelineState {
  const selectedDate = parseTimelineDateKey(state.date) ?? startOfLocalDay(new Date());
  const amount = (state.scope === "day" ? 1 : 7) * (direction === "previous" ? -1 : 1);
  return {
    ...state,
    date: toTimelineDateKey(addCalendarDays(selectedDate, amount))
  };
}

export function resetTimelineState(state: TimelineState, now = new Date()): TimelineState {
  return {
    ...state,
    date: toTimelineDateKey(startOfLocalDay(now))
  };
}

export function shouldAdvanceStaleTimelineToToday(
  state: TimelineState,
  previousTodayKey: string,
  now = new Date()
) {
  const currentTodayKey = toTimelineDateKey(startOfLocalDay(now));
  return currentTodayKey !== previousTodayKey && state.date === previousTodayKey;
}

/**
 * "Today", "Sun 12 Oct 2026" or a week's span. `now` is the current time, or today's date key
 * (null when today is not known yet, which never reads "Today").
 */
/**
 * The Calendar toolbar's date (UI review round 2, owner 30 Oct 2026): "26 Oct – 1 Nov" for a week, "Fri 30 Oct" for a
 * day, with the year only when it isn't the current year (both years when a week spans two).
 */
export function formatCalendarRangeLabel(scope: TimelineScope, ranges: TimelineRanges, today: Date | string | null = new Date()) {
  const currentYear = today instanceof Date ? today.getFullYear() : today ? Number(today.slice(0, 4)) : new Date().getFullYear();
  const withYear = (date: Date) => date.getFullYear() !== currentYear;
  if (scope === "day") {
    const day = ranges.day.start;
    const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", ...(withYear(day) ? { year: "numeric" } : {}) };
    return new Intl.DateTimeFormat("en-GB", options).format(day).replace(",", "");
  }
  const start = ranges.weekDays[0];
  const end = ranges.weekDays[6];
  const spansYears = start.getFullYear() !== end.getFullYear();
  const format = (date: Date, year: boolean) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(date);
  return `${format(start, spansYears || withYear(start))} – ${format(end, spansYears || withYear(end))}`;
}

export function formatTimelinePeriodLabel(
  scope: TimelineScope,
  ranges: TimelineRanges,
  now: Date | string | null = new Date()
) {
  if (scope === "day") {
    const todayKey = now instanceof Date ? toTimelineDateKey(startOfLocalDay(now)) : now;
    if (toTimelineDateKey(ranges.day.start) === todayKey) return "Today";
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(ranges.day.start);
  }

  const start = ranges.weekDays[0];
  const end = ranges.weekDays[6];
  const startDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const endSameYear = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (start.getFullYear() === end.getFullYear()) {
    return `${startDay.format(start).replace(",", "")} – ${endSameYear.format(end).replace(",", "")}`;
  }
  const full = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
  return `${full.format(start).replace(",", "")} – ${full.format(end).replace(",", "")}`;
}

export function parseTimelineDateKey(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function toTimelineDateKey(date: Date) {
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0")
  ].join("-");
}

export function addCalendarDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function normalizeTimelineState(state: TimelineState): TimelineState {
  const date = parseTimelineDateKey(state.date);
  const view = isTimelineView(state.view) ? state.view : "calendar";
  const scope = isTimelineScope(state.scope) ? state.scope : "week";
  return {
    date: toTimelineDateKey(date ?? startOfLocalDay(new Date())),
    scope,
    view
  };
}

function normalizeTimelinePreference(preference: TimelinePreference | null | undefined): TimelinePreference {
  if (!preference) return DEFAULT_TIMELINE_PREFERENCE;
  return {
    lastView: isTimelineView(preference.lastView)
      ? preference.lastView
      : DEFAULT_TIMELINE_PREFERENCE.lastView,
    preferredScope: isTimelineScope(preference.preferredScope)
      ? preference.preferredScope
      : DEFAULT_TIMELINE_PREFERENCE.preferredScope
  };
}

function mutableSearchParams(input: TimelineSearchInput) {
  if ("get" in input && typeof input.get === "function") {
    return new URLSearchParams(input.toString());
  }
  const params = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(input)) {
    const values = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
    for (const value of values) params.append(name, value);
  }
  return params;
}

function searchValue(input: TimelineSearchInput, name: string) {
  if ("get" in input && typeof input.get === "function") return input.get(name);
  const value = (input as Record<string, SearchValue>)[name];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMondayWeek(date: Date) {
  const weekday = date.getDay();
  return addCalendarDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function isTimelineScope(value?: string | null): value is TimelineScope {
  return value === "day" || value === "week";
}

function isTimelineView(value?: string | null): value is TimelineView {
  return value === "calendar" || value === "list";
}
