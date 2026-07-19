import { calendarBlockContinuationEdges, paletteColorFor } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  isCalendarPreviewReviewItem,
  isOpenReviewItem,
  isReviewNeededEntry
} from "./review";
import { displayTimerDescription } from "./timerPresentation";

export type NativeCalendarActionKind = "active" | "completed" | "review";

export type NativeCalendarEntry = MobileTimeEntry & {
  isActive: boolean;
  isReviewSuggestion?: boolean;
  reviewItemId?: string;
};

export type NativeCalendarTheme = Pick<
  MobileTheme,
  | "accent"
  | "accentSoft"
  | "accentText"
  | "background"
  | "border"
  | "borderStrong"
  | "shadow"
  | "surface"
  | "surfaceMuted"
  | "surfaceRaised"
  | "textPrimary"
  | "textSecondary"
> & { mode: MobileTheme["mode"] };

export type NativeCalendarPresentationEntry = {
  actionId: string;
  actionKind: NativeCalendarActionKind;
  accessibilityLabel: string;
  color: string;
  continuesIntoNextDay: boolean;
  entryId: string;
  isActive: boolean;
  isReview: boolean;
  isUncategorized: boolean;
  meta: string;
  startedAtMs: number;
  startsBeforeDay: boolean;
  stoppedAtMs: number | null;
  tagText: string | null;
  title: string;
};

export type NativeCalendarPresentation = {
  dayEndMs: number;
  dayStartMs: number;
  emptyState: string;
  entries: NativeCalendarPresentationEntry[];
  modelVersion: 2;
  nowMs: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  refreshing: boolean;
  selectedDayKey: string;
  selectedDayTitle: string;
  theme: NativeCalendarTheme;
  todayKey: string;
  totalLabel: string;
  totalSeconds: number;
  transitionDirection: -1 | 1;
  weekDays: Array<{
    accessibilityLabel: string;
    dayKey: string;
    dayNumber: string;
    isSelected: boolean;
    isToday: boolean;
    weekdayLabel: string;
  }>;
};

export type NativeCalendarBridgeState = {
  actionEntries: NativeCalendarEntry[];
  model: NativeCalendarPresentation;
};

export type NativeCalendarOpenEvent = {
  actionId: string;
  kind: NativeCalendarActionKind;
};

export type NativeCalendarOpenHandlers = {
  onOpenActive: (entryId: string) => void;
  onOpenCompleted: (entry: NativeCalendarEntry) => void;
  onOpenReview: (reviewItemId: string) => void;
};

export function buildNativeCalendarBridgeState({
  data,
  now,
  reduceMotion,
  reduceTransparency,
  refreshing,
  selectedDayKey,
  theme,
  transitionDirection
}: {
  data: MobileBootstrap | null;
  now: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  refreshing: boolean;
  selectedDayKey: string;
  theme: MobileTheme;
  transitionDirection: number;
}): NativeCalendarBridgeState {
  const selectedDate = dateFromKey(selectedDayKey);
  const dayStart = startOfLocalDay(selectedDate);
  const dayEnd = addDays(dayStart, 1);
  const todayKey = formatDateKey(new Date(now));
  const entries = buildCalendarEntries(data, selectedDayKey, now);
  const totalSeconds = entries
    .filter((entry) => !isCalendarReviewNeeded(entry))
    .reduce((sum, entry) => sum + overlapSeconds(entry, dayStart, dayEnd, now), 0);

  return {
    actionEntries: entries,
    model: {
      dayEndMs: dayEnd.getTime(),
      dayStartMs: dayStart.getTime(),
      emptyState: "No tracked time for this day.",
      entries: entries.map((entry) => serializeCalendarEntry(entry, dayStart, dayEnd, now, theme)),
      modelVersion: 2,
      nowMs: now,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      selectedDayTitle: formatSelectedDayTitle(selectedDate, todayKey),
      theme: nativeCalendarTheme(theme),
      todayKey,
      totalLabel: formatDuration(totalSeconds),
      totalSeconds,
      transitionDirection: transitionDirection < 0 ? -1 : 1,
      weekDays: buildWeekStripDays(selectedDayKey).map(({ date, key }) => ({
        accessibilityLabel: `Show ${formatSelectedDayTitle(date, todayKey)}`,
        dayKey: key,
        dayNumber: String(date.getDate()),
        isSelected: key === selectedDayKey,
        isToday: key === todayKey,
        weekdayLabel: formatWeekday(date)
      }))
    }
  };
}

export function routeNativeCalendarOpenEvent(
  event: NativeCalendarOpenEvent,
  actionEntries: NativeCalendarEntry[],
  handlers: NativeCalendarOpenHandlers
) {
  if (event.kind === "review") {
    handlers.onOpenReview(event.actionId);
    return true;
  }

  const entry = actionEntries.find((candidate) => candidate.id === event.actionId);
  if (!entry) return false;

  if (event.kind === "active") {
    handlers.onOpenActive(entry.id);
    return true;
  }

  handlers.onOpenCompleted(entry);
  return true;
}

export function routeNativeCalendarRefresh(onRequestRefresh: () => void) {
  onRequestRefresh();
}

function serializeCalendarEntry(
  entry: NativeCalendarEntry,
  dayStart: Date,
  dayEnd: Date,
  now: number,
  theme: MobileTheme
): NativeCalendarPresentationEntry {
  const reviewNeeded = isCalendarReviewNeeded(entry);
  const startedAtMs = Date.parse(entry.startedAt);
  const stoppedAtMs = entry.stoppedAt ? Date.parse(entry.stoppedAt) : null;
  const effectiveStoppedAtMs = stoppedAtMs ?? now;
  const continuation = calendarBlockContinuationEdges({
    dayEnd,
    dayStart,
    startedAt: startedAtMs,
    stoppedAt: effectiveStoppedAtMs
  });
  const title = displayEntryTitle(entry);
  const actionKind: NativeCalendarActionKind = entry.reviewItemId
    ? "review"
    : entry.isActive ? "active" : "completed";
  const actionId = entry.reviewItemId ?? entry.id;
  const isUncategorized = !entry.categoryId && !entry.categoryName;
  const categoryColor = isUncategorized
    ? uncategorizedFillColor(theme.mode)
    : paletteColorFor(entry.categoryColor ?? entry.categoryId, entry.categoryName ?? "Uncategorized", theme.mode);
  const color = reviewNeeded ? theme.textSecondary : categoryColor;
  const tagText = entry.tags?.map((tag) => tag.name).join(" · ")
    || entry.tagNames?.join(" · ")
    || null;

  return {
    actionId,
    actionKind,
    accessibilityLabel: `${reviewNeeded ? REVIEW_COPY.needsReview : entry.isActive ? "Edit running timer" : "Open time block"}: ${title}${tagText ? `. Tags: ${tagText}` : ""}`,
    color,
    continuesIntoNextDay: continuation.continuesIntoNextDay,
    entryId: entry.id,
    isActive: entry.isActive,
    isReview: reviewNeeded,
    isUncategorized,
    meta: calendarBlockMeta(entry, now, reviewNeeded, continuation.continuesIntoNextDay),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : dayStart.getTime(),
    startsBeforeDay: continuation.startsBeforeDay,
    stoppedAtMs: stoppedAtMs !== null && Number.isFinite(stoppedAtMs) ? stoppedAtMs : null,
    tagText,
    title
  };
}

function buildCalendarEntries(data: MobileBootstrap | null, selectedDayKey: string, now: number) {
  if (!data) return [];
  const mergedEntries = mergeActiveEntry(
    dedupeEntriesById([
      ...(data.historyEntries ?? []),
      ...(data.entries ?? []),
      ...(data.weekEntries ?? []),
      ...(data.dayEntries ?? [])
    ]),
    data.activeEntry
  );
  const timeEntries: NativeCalendarEntry[] = mergedEntries
    .filter((entry) => entryOverlapsDay(entry, selectedDayKey, now))
    .map((entry) => ({
      ...entry,
      isActive: data.activeEntry?.id === entry.id || !entry.stoppedAt
    }));
  const reviewEntries: NativeCalendarEntry[] = [];

  for (const item of data.reviewItems ?? []) {
    if (!isOpenReviewItem(item) || !isCalendarPreviewReviewItem(item)) continue;
    const draft = buildReviewItemDraftEntry(item, data.categories, now);
    if (!draft) continue;
    const entry: NativeCalendarEntry = {
      ...draft,
      id: `review:${item.id}`,
      isActive: false,
      isReviewSuggestion: true,
      reviewItemId: item.id
    };
    if (entryOverlapsDay(entry, selectedDayKey, now)) reviewEntries.push(entry);
  }

  return [...timeEntries, ...reviewEntries]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
}

function buildWeekStripDays(selectedDayKey: string) {
  const start = startOfWeek(dateFromKey(selectedDayKey));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    return { date, key: formatDateKey(date) };
  });
}

function mergeActiveEntry(entries: MobileTimeEntry[], activeEntry: MobileBootstrap["activeEntry"]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (activeEntry) {
    byId.set(activeEntry.id, {
      ...(byId.get(activeEntry.id) ?? {}),
      ...activeEntry,
      stoppedAt: null
    });
  }
  return Array.from(byId.values());
}

function dedupeEntriesById(entries: MobileTimeEntry[]) {
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
}

function entryOverlapsDay(entry: MobileTimeEntry, dayKey: string, now: number) {
  const dayStart = startOfLocalDay(dateFromKey(dayKey));
  const dayEnd = addDays(dayStart, 1);
  const startedAt = Date.parse(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  return Number.isFinite(startedAt) && Number.isFinite(stoppedAt) && startedAt < dayEnd.getTime() && stoppedAt > dayStart.getTime();
}

function overlapSeconds(entry: MobileTimeEntry, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = Date.parse(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt)) return 0;
  const overlapStart = Math.max(startedAt, rangeStart.getTime());
  const overlapEnd = Math.min(stoppedAt, rangeEnd.getTime());
  return overlapEnd > overlapStart ? Math.floor((overlapEnd - overlapStart) / 1000) : 0;
}

function calendarBlockMeta(
  entry: NativeCalendarEntry,
  now: number,
  reviewNeeded: boolean,
  continuesIntoNextDay: boolean
) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  const timeLabel = `${formatTimeOfDay(startedAt)}-${entry.stoppedAt ? formatTimeOfDay(stoppedAt) : "now"}`;
  const suffix = entry.isActive ? "running" : formatDuration(entryDurationSeconds(entry, now));
  return [
    reviewNeeded ? REVIEW_COPY.needsReview : null,
    continuesIntoNextDay ? "Continues next day" : null,
    timeLabel,
    suffix
  ].filter(Boolean).join(" · ");
}

function displayEntryTitle(entry: MobileTimeEntry) {
  return displayTimerDescription(entry) ?? entry.categoryName ?? "Uncategorized";
}

function isCalendarReviewNeeded(entry: NativeCalendarEntry) {
  return Boolean(entry.reviewItemId || entry.isReviewSuggestion || isReviewNeededEntry(entry));
}

function entryDurationSeconds(entry: MobileTimeEntry, now: number) {
  const startedAt = Date.parse(entry.startedAt);
  if (entry.stoppedAt || !Number.isFinite(startedAt)) return Math.max(0, entry.durationSeconds);
  return Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));
}

function nativeCalendarTheme(theme: MobileTheme): NativeCalendarTheme {
  return {
    accent: theme.accent,
    accentSoft: theme.accentSoft,
    accentText: theme.accentText,
    background: theme.background,
    border: theme.border,
    borderStrong: theme.borderStrong,
    mode: theme.mode,
    shadow: theme.shadow,
    surface: theme.surface,
    surfaceMuted: theme.surfaceMuted,
    surfaceRaised: theme.surfaceRaised,
    textPrimary: theme.textPrimary,
    textSecondary: theme.textSecondary
  };
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, Math.max(0, (month || 1) - 1), day || 1);
}

function startOfLocalDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date: Date) {
  const start = startOfLocalDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatSelectedDayTitle(date: Date, todayKey: string) {
  if (formatDateKey(date) === todayKey) return "Today";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "long" });
}

function formatWeekday(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
}

function formatTimeOfDay(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function uncategorizedFillColor(mode: MobileTheme["mode"]) {
  return mode === "dark" ? "#323946" : "#EEF2F6";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
