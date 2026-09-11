import { paletteColorFor, type ReportSummary } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import type { ReportRange, ReportWindow } from "./reportsRanges";
import {
  reportSelectionIncludes,
  type ReportCategoryOption,
  type ReportCategorySelection,
} from "./reportsSelection";

export type ReportCategoryDuration = {
  key: string;
  categoryName: string;
  durationMs: number;
  color: string;
  isUncategorized: boolean;
  selected: boolean;
};

export function compareReportCategoryDuration(
  left: ReportCategoryDuration,
  right: ReportCategoryDuration,
) {
  const duration = right.durationMs - left.durationMs;
  return duration || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

export function reportEntryUnion(data: MobileBootstrap) {
  const entries = new Map<string, MobileTimeEntry>();
  for (const entry of [
    ...(data.historyEntries ?? []),
    ...(data.entries ?? []),
    ...(data.weekEntries ?? []),
    ...(data.dayEntries ?? []),
  ])
    if (entry?.id) entries.set(entry.id, entry);
  if (data.activeEntry?.id)
    entries.set(data.activeEntry.id, { ...data.activeEntry, stoppedAt: null });
  return [...entries.values()];
}
export function entryOverlapMs(
  entry: Pick<MobileTimeEntry, "startedAt" | "stoppedAt">,
  window: ReportWindow,
  now: number,
) {
  const start = Date.parse(entry.startedAt);
  const end = Math.min(
    entry.stoppedAt ? Date.parse(entry.stoppedAt) : now,
    now,
  );
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.min(end, +window.end) - Math.max(start, +window.start))
    : 0;
}
export function reportCategoryKey(entry: Pick<MobileTimeEntry, "categoryId">) {
  return entry.categoryId || "uncategorized";
}
const eligible = (entry: MobileTimeEntry) =>
  entry.reviewStatus === "confirmed" || entry.reviewStatus === "accepted";

/** Replace only the server's current timer contribution with the existing Dashboard projection. */
export function buildReportsPresentation(input: {
  data: MobileBootstrap;
  summary: ReportSummary;
  range: ReportRange;
  nowMs: number;
  selection: ReportCategorySelection;
  themeMode: MobileTheme["mode"];
}) {
  const { data, summary, range, selection, themeMode, nowMs } = input;
  const categories = new Map(summary.categories.map((c) => [c.key, { ...c }]));
  const buckets = summary.buckets.map((b) => ({
    ...b,
    byCategory: new Map(b.byCategory.map((c) => [c.key, c.seconds])),
  }));
  const entries = reportEntryUnion(data);
  const active = summary.active;
  if (active) {
    const key = active.categoryId || "uncategorized";
    for (const contribution of active.buckets) {
      const bucket = buckets.find((b) => b.key === contribution.key);
      if (bucket)
        bucket.byCategory.set(
          key,
          Math.max(0, (bucket.byCategory.get(key) ?? 0) - contribution.seconds),
        );
    }
  }
  const replacements = new Map<string, MobileTimeEntry>();
  if (active) {
    const replacement = entries.find((entry) => entry.id === active.id);
    if (
      replacement &&
      (replacement.stoppedAt !== null ||
        replacement.id === data.activeEntry?.id)
    )
      replacements.set(replacement.id, replacement);
  }
  if (
    data.activeEntry &&
    (data.activeEntry.id === active?.id ||
      data.activeEntry.id.startsWith("optimistic-active-timer:") ||
      Date.parse(data.activeEntry.startedAt) >= Date.parse(summary.capturedNow))
  )
    replacements.set(data.activeEntry.id, data.activeEntry);
  for (const entry of replacements.values()) {
    if (!eligible(entry)) continue;
    const key = reportCategoryKey(entry);
    categories.set(key, {
      key,
      categoryId: entry.categoryId ?? null,
      name: entry.categoryId
        ? entry.categoryName || "Unknown category"
        : "Uncategorized",
      color: entry.categoryColor ?? null,
      seconds: 0,
    });
    range.buckets.forEach((window, index) => {
      const seconds = entryOverlapMs(entry, window, nowMs) / 1000;
      buckets[index].byCategory.set(
        key,
        (buckets[index].byCategory.get(key) ?? 0) + seconds,
      );
    });
  }
  // Sum the same unrounded pieces for every view; round only duration labels.
  const allCategorySegments: ReportCategoryDuration[] = [...categories.values()]
    .map((c) => ({
      key: c.key,
      categoryName: c.name,
      durationMs:
        buckets.reduce((sum, b) => sum + (b.byCategory.get(c.key) ?? 0), 0) *
        1000,
      color: paletteColorFor(c.color ?? c.key, c.name, themeMode),
      isUncategorized: c.key === "uncategorized",
      selected: reportSelectionIncludes(selection, c.key),
    }))
    .filter((c) => Number.isFinite(c.durationMs) && c.durationMs > 0);
  const filterOptions = new Map<string, ReportCategoryOption>();
  for (const c of data.categories ?? [])
    filterOptions.set(c.id, {
      key: c.id,
      name: c.name,
      color: paletteColorFor(c.color ?? c.id, c.name, themeMode),
      isUncategorized: false,
      isUnavailable: false,
    });
  for (const c of categories.values())
    if (!filterOptions.has(c.key))
      filterOptions.set(c.key, {
        key: c.key,
        name: c.name,
        color: paletteColorFor(c.color ?? c.key, c.name, themeMode),
        isUncategorized: c.key === "uncategorized",
        isUnavailable: false,
      });
  filterOptions.set("uncategorized", {
    key: "uncategorized",
    name: "Uncategorized",
    color: paletteColorFor("uncategorized", "Uncategorized", themeMode),
    isUncategorized: true,
    isUnavailable: false,
  });
  if (selection.mode === "include")
    for (const key of selection.keys)
      if (!filterOptions.has(key))
        filterOptions.set(key, {
          key,
          name: "Unavailable category",
          color: paletteColorFor(key, key, themeMode),
          isUncategorized: false,
          isUnavailable: true,
        });
  allCategorySegments.sort(compareReportCategoryDuration);
  const visibleCategorySegments = allCategorySegments
    .filter((c) => c.selected)
    .sort(compareReportCategoryDuration);
  const selectedDurationMs = visibleCategorySegments.reduce(
    (sum, c) => sum + c.durationMs,
    0,
  );
  return {
    allCategorySegments,
    visibleCategorySegments,
    selectedDurationMs,
    selectedLoggedSeconds: selectedDurationMs / 1000,
    contextDurationMs: allCategorySegments.reduce(
      (sum, c) => sum + c.durationMs,
      0,
    ),
    buckets: buckets.map((b, index) => ({
      ...range.buckets[index],
      seconds: [...b.byCategory].reduce(
        (sum, [key, seconds]) =>
          sum + (reportSelectionIncludes(selection, key) ? seconds : 0),
        0,
      ),
    })),
    filterOptions: [...filterOptions.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    ),
  };
}
export function formatReportDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "Unavailable";
  const whole = Math.floor(Math.max(0, seconds));
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
export function spokenReportDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "Duration unavailable";
  const whole = Math.floor(Math.max(0, seconds));
  const values = [
    Math.floor(whole / 3600),
    Math.floor(whole / 60) % 60,
    whole % 60,
  ];
  return values
    .flatMap((value, i) =>
      value || (whole === 0 && i === 2)
        ? [
            `${value} ${["hour", "minute", "second"][i]}${value === 1 ? "" : "s"}`,
          ]
        : [],
    )
    .join(", ");
}
export function formatReportPercent(value: number, total: number) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
export function reportAxis(maxSeconds: number) {
  const max = Number.isFinite(maxSeconds) ? Math.max(0, maxSeconds) : 0;
  const unit = max > 3600 ? 3600 : max > 60 ? 60 : 1;
  const raw = max / unit;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const ceiling =
    [1, 2, 3, 4, 5, 6, 8, 10].find((n) => n * power >= raw)! * power;
  const maximum = max === 0 ? 60 : ceiling * unit;
  const tickUnit = maximum > 3600 ? 3600 : maximum >= 60 ? 60 : 1;
  return {
    maximum,
    ticks: [1, 0.5, 0].map((n) => ({
      seconds: n * maximum,
      label: `${Number(((n * maximum) / tickUnit).toFixed(2))}${tickUnit === 3600 ? "h" : tickUnit === 60 ? "m" : "s"}`,
    })),
  };
}
