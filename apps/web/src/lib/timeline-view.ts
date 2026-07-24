export const TIMELINE_SCOPES = ["day", "week"] as const;
export const TIMELINE_VIEWS = ["calendar", "list", "timesheet"] as const;

export type TimelineScope = (typeof TIMELINE_SCOPES)[number];
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

export type TimelineState = {
  date: string;
  scope: TimelineScope;
  view: TimelineView;
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

export function timelineStateFromSearchParams(
  input: TimelineSearchInput,
  options: { now?: Date } = {}
): TimelineState {
  const now = startOfLocalDay(options.now ?? new Date());
  const date = toTimelineDateKey(parseTimelineDateKey(searchValue(input, "date")) ?? now);
  const requestedScope = searchValue(input, "scope");
  const requestedView = searchValue(input, "view");
  const view = isTimelineView(requestedView) ? requestedView : "calendar";
  const scope = view === "timesheet"
    ? "week"
    : isTimelineScope(requestedScope)
      ? requestedScope
      : "week";

  return { date, scope, view };
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
  const scope = view === "timesheet"
    ? "week"
    : isTimelineScope(state.scope)
      ? state.scope
      : "week";
  return {
    date: toTimelineDateKey(date ?? startOfLocalDay(new Date())),
    scope,
    view
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
  return value === "calendar" || value === "list" || value === "timesheet";
}
