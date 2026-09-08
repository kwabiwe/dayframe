import { analyzeTimeIntervals, paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { hasReviewNeededActivityForRange, isReviewNeededEntry } from "./review";
import {
  UNCATEGORIZED_REPORT_KEY,
  reportSelectionIncludes,
  type ReportCategoryOption,
  type ReportCategorySelection
} from "./reportsSelection";
import {
  buildReportsRanges,
  reportWindowQuality,
  type ReportDataQuality,
  type ReportWindow
} from "./reportsRanges";
import type { MobileTheme } from "./mobileTheme";

export type ReportCategoryDuration = {
  key: string;
  categoryName: string;
  durationMs: number;
  color: string;
  isUncategorized: boolean;
  selected: boolean;
};

export type ReportDailyDuration = {
  key: string;
  label: string;
  durationMs: number;
};

export type ReportsPresentation = {
  selectedPeriod: "today" | "week";
  allCategorySegments: ReportCategoryDuration[];
  selectedCategoryBars: ReportCategoryDuration[];
  selectedLoggedSeconds: number;
  selectedCoveredSeconds: number;
  selectedAdditionalOverlapSeconds: number;
  selectedWeekDailyBars: ReportDailyDuration[];
  selectedWeekLoggedSeconds: number;
  contextDurationMs: number;
  filterOptions: ReportCategoryOption[];
  hasSuggestedActivity: boolean;
  dataQuality: {
    selectedPeriod: ReportDataQuality;
    currentWeek: ReportDataQuality;
  };
};

export function buildReportsPresentation(input: {
  data: MobileBootstrap;
  nowMs: number;
  period: "today" | "week";
  selection: ReportCategorySelection;
  themeMode: MobileTheme["mode"];
}): ReportsPresentation {
  const ranges = buildReportsRanges(input.nowMs);
  const selectedWindow = input.period === "today" ? ranges.today : ranges.week;
  const entries = reportEntryUnion(input.data);
  const eligibleEntries = entries
    .filter((entry) => validReportEntry(entry, input.data.activeEntry?.id ?? null))
    .filter((entry) => !isReviewNeededEntry(entry));
  const selectedEntries = eligibleEntries.filter((entry) =>
    reportSelectionIncludes(input.selection, reportCategoryKey(entry))
  );
  const selectedPeriodEntries = entriesOverlapping(selectedEntries, selectedWindow, input.nowMs);
  const selectedWeekEntries = entriesOverlapping(selectedEntries, ranges.week, input.nowMs);
  const allPeriodEntries = entriesOverlapping(eligibleEntries, selectedWindow, input.nowMs);
  const selectedAnalysis = analyze(selectedPeriodEntries, selectedWindow, input.nowMs);
  const selectedWeekAnalysis = analyze(selectedWeekEntries, ranges.week, input.nowMs);
  const allCategorySegments = buildCategoryDurations(
    allPeriodEntries,
    selectedWindow,
    input.nowMs,
    input.selection,
    input.themeMode
  );

  return {
    selectedPeriod: input.period,
    allCategorySegments,
    selectedCategoryBars: allCategorySegments.filter((segment) => segment.selected),
    selectedLoggedSeconds: selectedAnalysis.loggedSeconds,
    selectedCoveredSeconds: selectedAnalysis.coveredSeconds,
    selectedAdditionalOverlapSeconds: selectedAnalysis.additionalOverlappingActivitySeconds,
    selectedWeekDailyBars: ranges.weekDays.map((day) => ({
      key: day.key,
      label: day.label,
      durationMs: selectedWeekEntries.reduce(
        (sum, entry) => sum + entryOverlapMs(entry, day, input.nowMs),
        0
      )
    })),
    selectedWeekLoggedSeconds: selectedWeekAnalysis.loggedSeconds,
    contextDurationMs: allCategorySegments.reduce((sum, segment) => sum + segment.durationMs, 0),
    filterOptions: buildReportCategoryOptions(input.data, entries, input.selection, input.themeMode),
    hasSuggestedActivity: hasReviewNeededActivityForRange({
      entries: entriesOverlapping(entries, selectedWindow, input.nowMs),
      now: input.nowMs,
      rangeStart: selectedWindow.start,
      rangeEnd: selectedWindow.end,
      reviewItems: input.data.reviewItems ?? []
    }),
    dataQuality: {
      selectedPeriod: reportWindowQuality(input.data.entryCoverage, selectedWindow),
      currentWeek: reportWindowQuality(input.data.entryCoverage, ranges.week)
    }
  };
}

export function reportEntryUnion(data: MobileBootstrap) {
  const byId = new Map<string, MobileTimeEntry>();
  for (const entry of [
    ...(data.historyEntries ?? []),
    ...(data.entries ?? []),
    ...(data.weekEntries ?? []),
    ...(data.dayEntries ?? [])
  ]) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  if (data.activeEntry?.id) {
    byId.set(data.activeEntry.id, {
      ...(byId.get(data.activeEntry.id) ?? data.activeEntry),
      ...data.activeEntry,
      stoppedAt: null
    });
  }
  return [...byId.values()];
}

function buildCategoryDurations(
  entries: MobileTimeEntry[],
  range: ReportWindow,
  nowMs: number,
  selection: ReportCategorySelection,
  themeMode: MobileTheme["mode"]
) {
  const totals = new Map<string, ReportCategoryDuration>();
  for (const entry of entries) {
    const durationMs = entryOverlapMs(entry, range, nowMs);
    if (durationMs <= 0) continue;
    const key = reportCategoryKey(entry);
    const current = totals.get(key);
    totals.set(key, {
      key,
      categoryName: reportCategoryName(entry),
      durationMs: (current?.durationMs ?? 0) + durationMs,
      color: current?.color ?? reportCategoryColor(entry, themeMode),
      isUncategorized: key === UNCATEGORIZED_REPORT_KEY,
      selected: reportSelectionIncludes(selection, key)
    });
  }
  return [...totals.values()].sort(
    (left, right) => right.durationMs - left.durationMs || left.key.localeCompare(right.key)
  );
}

function buildReportCategoryOptions(
  data: MobileBootstrap,
  entries: MobileTimeEntry[],
  selection: ReportCategorySelection,
  themeMode: MobileTheme["mode"]
) {
  const options = new Map<string, ReportCategoryOption>();
  for (const category of data.categories ?? []) {
    options.set(category.id, {
      key: category.id,
      name: category.name,
      color: paletteColorFor(category.color ?? category.id, category.name, themeMode),
      isUncategorized: false,
      isUnavailable: false
    });
  }
  for (const entry of entries) {
    const key = reportCategoryKey(entry);
    if (options.has(key)) continue;
    options.set(key, {
      key,
      name: reportCategoryName(entry),
      color: reportCategoryColor(entry, themeMode),
      isUncategorized: key === UNCATEGORIZED_REPORT_KEY,
      isUnavailable: false
    });
  }
  if (selection.mode === "include") {
    for (const key of selection.keys) {
      if (options.has(key)) continue;
      options.set(key, {
        key,
        name: "Unavailable category",
        color: themeMode === "dark" ? "#323946" : "#EEF2F6",
        isUncategorized: key === UNCATEGORIZED_REPORT_KEY,
        isUnavailable: true
      });
    }
  }
  return [...options.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key)
  );
}

function analyze(entries: MobileTimeEntry[], range: ReportWindow, nowMs: number) {
  return analyzeTimeIntervals(
    entries.map((entry) => ({ id: entry.id, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt })),
    { range, now: nowMs }
  );
}

function validReportEntry(entry: MobileTimeEntry, activeEntryId: string | null) {
  if (!entry.id) return false;
  const start = Date.parse(entry.startedAt);
  const end = entry.stoppedAt === null ? null : Date.parse(entry.stoppedAt);
  return Number.isFinite(start) && (
    end === null ? entry.id === activeEntryId : Number.isFinite(end) && end > start
  );
}

function entriesOverlapping(entries: MobileTimeEntry[], range: ReportWindow, nowMs: number) {
  return entries.filter((entry) => entryOverlapMs(entry, range, nowMs) > 0);
}

export function entryOverlapMs(entry: MobileTimeEntry, range: ReportWindow, nowMs: number) {
  const start = Date.parse(entry.startedAt);
  const rawEnd = entry.stoppedAt === null ? nowMs : Date.parse(entry.stoppedAt);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd <= start) return 0;
  return Math.max(0, Math.min(rawEnd, range.end.getTime()) - Math.max(start, range.start.getTime()));
}

export function reportCategoryKey(entry: Pick<MobileTimeEntry, "categoryId">) {
  return entry.categoryId || UNCATEGORIZED_REPORT_KEY;
}

function reportCategoryName(entry: MobileTimeEntry) {
  if (!entry.categoryId) return "Uncategorized";
  return entry.categoryName?.trim() || "Unknown category";
}

function reportCategoryColor(entry: MobileTimeEntry, mode: MobileTheme["mode"]) {
  if (!entry.categoryId) return mode === "dark" ? "#323946" : "#EEF2F6";
  return paletteColorFor(
    entry.categoryColor ?? entry.categoryId,
    reportCategoryName(entry),
    mode
  );
}
