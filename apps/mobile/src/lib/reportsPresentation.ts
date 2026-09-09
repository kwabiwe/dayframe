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
    if (replacement) replacements.set(replacement.id, replacement);
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
    .filter((c) => c.durationMs > 0);
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
  return {
    allCategorySegments,
    selectedLoggedSeconds: allCategorySegments
      .filter((c) => c.selected)
      .reduce((sum, c) => sum + c.durationMs / 1000, 0),
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
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (seconds > 0 && minutes === 0) return "<1m";
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${minutes}m`;
}
export function formatReportPercent(value: number, total: number) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
export function reportAxis(maxSeconds: number) {
  const candidates = [
    60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
    172800, 604800, 1209600,
  ];
  const step =
    candidates.find((value) => value * 4 >= maxSeconds) ??
    Math.ceil(maxSeconds / 4 / 604800) * 604800;
  return {
    maximum: step * 4,
    ticks: [4, 3, 2, 1, 0].map((n) => ({
      seconds: n * step,
      label: formatReportDuration(n * step),
    })),
  };
}
