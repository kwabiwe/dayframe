export const REPORT_RANGE_PRESETS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "last-7-days",
  "this-month",
  "last-month",
  "last-30-days",
  "custom"
] as const;

export type ReportRangePreset = (typeof REPORT_RANGE_PRESETS)[number];
export type ReportSort = "newest" | "duration";

export type ReportFilters = {
  range: ReportRangePreset;
  from: string;
  to: string;
  categories: string[];
  tags: string[];
  places: string[];
  sources: string[];
  description: string;
  sort: ReportSort;
  page: number;
};

export type ReportDayBoundary = {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type ReportQueryInput = {
  filters: ReportFilters;
  range: ReportRangeMetadata;
  previousRange: Pick<ReportRangeMetadata, "from" | "to" | "start" | "end" | "dayCount">;
  dayBoundaries: ReportDayBoundary[];
  pageSize: number;
};

export type ReportRangeMetadata = {
  preset: ReportRangePreset;
  from: string;
  to: string;
  start: string;
  end: string;
  label: string;
  dayCount: number;
  previousFrom: string;
  previousTo: string;
  nextFrom: string;
  nextTo: string;
  canNavigateNext: boolean;
  wasClamped: boolean;
};

export const REPORT_PAGE_SIZE = 25;
export const REPORT_MAX_RANGE_DAYS = 366;
export const REPORT_DAILY_CHART_THRESHOLD = 62;

export const REPORT_SOURCE_VALUES = [
  "manual_app",
  "mobile_app",
  "nfc",
  "widget",
  "shortcut",
  "geofence_specific",
  "geofence_broad",
  "calendar",
  "health_sleep",
  "health_workout",
  "location_learning",
  "home_assistant",
  "ha_button",
  "ha_geofence"
] as const;

type SearchInput = Record<string, string | string[] | null | undefined>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceValues = new Set<string>(REPORT_SOURCE_VALUES);
const rangePresets = new Set<string>(REPORT_RANGE_PRESETS);

export function parseReportQueryInput(
  input: SearchInput,
  options: { now?: Date; pageSize?: number } = {}
): ReportQueryInput {
  const now = startOfLocalDay(options.now ?? new Date());
  const parsed = parseRangeIntent(input, now);
  const normalizedRange = normalizeRange(parsed.preset, parsed.from, parsed.to, now);
  const filters: ReportFilters = {
    range: parsed.preset,
    from: normalizedRange.from,
    to: normalizedRange.to,
    categories: parseIdList(input.categories, ["uncategorized"]),
    tags: parseIdList(input.tags),
    places: parseIdList(input.places, ["no-place"]),
    sources: parseList(input.sources).filter((value) => sourceValues.has(value)),
    description: scalar(input.description)?.trim().slice(0, 160) ?? "",
    sort: scalar(input.sort) === "duration" ? "duration" : "newest",
    page: parsePage(input.page)
  };

  return {
    filters,
    range: normalizedRange,
    previousRange: {
      from: normalizedRange.previousFrom,
      to: normalizedRange.previousTo,
      start: localDateKeyToDate(normalizedRange.previousFrom).toISOString(),
      end: addDays(localDateKeyToDate(normalizedRange.previousTo), 1).toISOString(),
      dayCount: normalizedRange.dayCount
    },
    dayBoundaries: buildDayBoundaries(normalizedRange.from, normalizedRange.to),
    pageSize: options.pageSize ?? REPORT_PAGE_SIZE
  };
}

export function serializeReportFilters(
  filters: ReportFilters,
  overrides: Partial<ReportFilters> = {}
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams({
    range: next.range,
    from: next.from,
    to: next.to
  });
  appendList(params, "categories", next.categories);
  appendList(params, "tags", next.tags);
  appendList(params, "places", next.places);
  appendList(params, "sources", next.sources);
  if (next.description.trim()) params.set("description", next.description.trim());
  if (next.sort === "duration") params.set("sort", "duration");
  if (next.page > 1) params.set("page", `${next.page}`);
  return params.toString();
}

export function reportsHref(filters: ReportFilters, overrides: Partial<ReportFilters> = {}) {
  return `/reports?${serializeReportFilters(filters, overrides)}`;
}

export function reportExportHref(filters: ReportFilters) {
  return `/api/reports/export?${serializeReportFilters(filters, { page: 1 })}`;
}

export function filtersForPreset(
  filters: ReportFilters,
  preset: Exclude<ReportRangePreset, "custom">,
  now = new Date()
): ReportFilters {
  const range = resolvePresetRange(preset, startOfLocalDay(now));
  return {
    ...filters,
    range: preset,
    from: toDateKey(range.start),
    to: toDateKey(range.endInclusive),
    page: 1
  };
}

export function filtersForCustomRange(filters: ReportFilters, from: string, to: string) {
  const normalized = normalizeRange("custom", from, to, localDateKeyToDate(filters.from));
  return {
    ...filters,
    range: "custom" as const,
    from: normalized.from,
    to: normalized.to,
    page: 1
  };
}

export function shiftReportRange(filters: ReportFilters, direction: "previous" | "next") {
  const normalized = normalizeRange(filters.range, filters.from, filters.to, new Date());
  return {
    ...filters,
    from: direction === "previous" ? normalized.previousFrom : normalized.nextFrom,
    to: direction === "previous" ? normalized.previousTo : normalized.nextTo,
    page: 1
  };
}

export function defaultReportFilters(now = new Date()) {
  return parseReportQueryInput({}, { now }).filters;
}

export function isReportUuid(value: string) {
  return uuidPattern.test(value);
}

export function reportRangePresetLabel(preset: ReportRangePreset) {
  return ({
    today: "Today",
    yesterday: "Yesterday",
    "this-week": "This week",
    "last-week": "Last week",
    "last-7-days": "Last 7 days",
    "this-month": "This month",
    "last-month": "Last month",
    "last-30-days": "Last 30 days",
    custom: "Custom"
  } satisfies Record<ReportRangePreset, string>)[preset];
}

function parseRangeIntent(input: SearchInput, now: Date) {
  const canonicalPreset = scalar(input.range);
  if (canonicalPreset && rangePresets.has(canonicalPreset)) {
    const preset = canonicalPreset as ReportRangePreset;
    const presetRange = preset === "custom" ? null : resolvePresetRange(preset, now);
    return {
      preset,
      from: scalar(input.from) ?? (presetRange ? toDateKey(presetRange.start) : toDateKey(now)),
      to: scalar(input.to) ?? (presetRange ? toDateKey(presetRange.endInclusive) : toDateKey(now))
    };
  }

  const legacyPeriod = scalar(input.period);
  const legacyStart = parseDateKey(scalar(input.start));
  if (legacyPeriod && legacyStart) {
    if (legacyPeriod === "day") {
      return { preset: "custom" as const, from: toDateKey(legacyStart), to: toDateKey(legacyStart) };
    }
    if (legacyPeriod === "week") {
      return {
        preset: "custom" as const,
        from: toDateKey(startOfWeek(legacyStart)),
        to: toDateKey(addDays(startOfWeek(legacyStart), 6))
      };
    }
    if (legacyPeriod === "month") {
      const start = new Date(legacyStart.getFullYear(), legacyStart.getMonth(), 1);
      return {
        preset: "custom" as const,
        from: toDateKey(start),
        to: toDateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0))
      };
    }
    if (legacyPeriod === "custom") {
      return {
        preset: "custom" as const,
        from: toDateKey(legacyStart),
        to: scalar(input.end) ?? toDateKey(legacyStart)
      };
    }
  }

  const fallback = resolvePresetRange("this-week", now);
  return {
    preset: "this-week" as const,
    from: toDateKey(fallback.start),
    to: toDateKey(fallback.endInclusive)
  };
}

function normalizeRange(preset: ReportRangePreset, fromValue: string, toValue: string, now: Date) {
  const fallback = preset === "custom"
    ? { start: startOfLocalDay(now), endInclusive: startOfLocalDay(now) }
    : resolvePresetRange(preset, startOfLocalDay(now));
  let start = parseDateKey(fromValue) ?? fallback.start;
  let endInclusive = parseDateKey(toValue) ?? fallback.endInclusive;
  if (endInclusive < start) [start, endInclusive] = [endInclusive, start];

  const requestedDayCount = calendarDayCount(start, endInclusive);
  const wasClamped = requestedDayCount > REPORT_MAX_RANGE_DAYS;
  if (wasClamped) endInclusive = addDays(start, REPORT_MAX_RANGE_DAYS - 1);

  const dayCount = calendarDayCount(start, endInclusive);
  const previousStart = addDays(start, -dayCount);
  const previousEnd = addDays(start, -1);
  const nextStart = addDays(endInclusive, 1);
  const nextEnd = addDays(endInclusive, dayCount);
  const today = startOfLocalDay(now);

  return {
    preset,
    from: toDateKey(start),
    to: toDateKey(endInclusive),
    start: start.toISOString(),
    end: addDays(endInclusive, 1).toISOString(),
    label: formatRangeLabel(start, endInclusive),
    dayCount,
    previousFrom: toDateKey(previousStart),
    previousTo: toDateKey(previousEnd),
    nextFrom: toDateKey(nextStart),
    nextTo: toDateKey(nextEnd),
    canNavigateNext: nextStart <= today,
    wasClamped
  };
}

function resolvePresetRange(preset: Exclude<ReportRangePreset, "custom">, now: Date) {
  if (preset === "today") return { start: now, endInclusive: now };
  if (preset === "yesterday") {
    const yesterday = addDays(now, -1);
    return { start: yesterday, endInclusive: yesterday };
  }
  if (preset === "this-week") {
    const start = startOfWeek(now);
    return { start, endInclusive: addDays(start, 6) };
  }
  if (preset === "last-week") {
    const start = addDays(startOfWeek(now), -7);
    return { start, endInclusive: addDays(start, 6) };
  }
  if (preset === "last-7-days") return { start: addDays(now, -6), endInclusive: now };
  if (preset === "this-month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, endInclusive: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  }
  if (preset === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start, endInclusive: new Date(now.getFullYear(), now.getMonth(), 0) };
  }
  return { start: addDays(now, -29), endInclusive: now };
}

function buildDayBoundaries(from: string, to: string) {
  const start = localDateKeyToDate(from);
  const endInclusive = localDateKeyToDate(to);
  const dayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const boundaries: ReportDayBoundary[] = [];
  for (let cursor = start; cursor <= endInclusive; cursor = addDays(cursor, 1)) {
    boundaries.push({
      key: toDateKey(cursor),
      label: dayFormatter.format(cursor),
      start: cursor.toISOString(),
      end: addDays(cursor, 1).toISOString()
    });
  }
  return boundaries;
}

function parseIdList(value: string | string[] | null | undefined, specialValues: string[] = []) {
  const special = new Set(specialValues);
  return parseList(value).filter((item) => uuidPattern.test(item) || special.has(item));
}

function parseList(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean))].slice(0, 50);
}

function scalar(value: string | string[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function parsePage(value: string | string[] | null | undefined) {
  const parsed = Number.parseInt(scalar(value) ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

function appendList(params: URLSearchParams, name: string, values: string[]) {
  if (values.length > 0) params.set(name, values.join(","));
}

function parseDateKey(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function localDateKeyToDate(value: string) {
  return parseDateKey(value) ?? startOfLocalDay(new Date());
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function calendarDayCount(start: Date, endInclusive: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(endInclusive.getFullYear(), endInclusive.getMonth(), endInclusive.getDate());
  return Math.floor((endUtc - startUtc) / 86_400_000) + 1;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function formatRangeLabel(start: Date, endInclusive: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
  if (toDateKey(start) === toDateKey(endInclusive)) return formatter.format(start);
  if (start.getFullYear() === endInclusive.getFullYear() && start.getMonth() === endInclusive.getMonth()) {
    return `${start.getDate()}–${formatter.format(endInclusive)}`;
  }
  return `${formatter.format(start)} – ${formatter.format(endInclusive)}`;
}
