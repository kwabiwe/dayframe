import {
  analyzeTimeIntervals,
  blockColorsFor,
  calendarBlockContinuationEdges,
  layoutTimeIntervals,
  type TimeIntervalLayout
} from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { MobileTheme } from "./mobileTheme";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  isOpenReviewItem,
  isReviewNeededEntry
} from "./review";
import { displayTimerDescription } from "./timerPresentation";

export type NativeCalendarActionKind = "active" | "completed" | "review";

export type NativeCalendarEntry = MobileTimeEntry & {
  isActive: boolean;
  isReviewSuggestion?: boolean;
  reviewItemId?: string;
  /** A crowd of Review items drawn as one block: how many, and the suggestion it opens. */
  reviewCrowd?: { count: number; opensTitle: string | null };
};

export type NativeCalendarTheme = Pick<
  MobileTheme,
  | "accent"
  | "accentSoft"
  | "accentText"
  | "background"
  | "border"
  | "borderStrong"
  | "onAccent"
  | "shadow"
  | "surface"
  | "surfaceMuted"
  | "surfaceRaised"
  | "textPrimary"
  | "textMuted"
  | "textSecondary"
  | "warning"
  | "warningText"
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
  laneCount: number;
  laneIndex: number;
  layoutMode: TimeIntervalLayout["mode"];
  meta: string;
  offsetFraction: number;
  /** Overlaps with any shown block, Review included: drives hit geometry (no 44-pt expansion). */
  overlapCount: number;
  overlapSeconds: number;
  placeText: string | null;
  startedAtMs: number;
  startsBeforeDay: boolean;
  stoppedAtMs: number | null;
  tagText: string | null;
  /** Measured on-block text colour for the solid fill (deep ink or white); theme text for Review. */
  textColor: string;
  textDensity: TimeIntervalLayout["textDensity"];
  title: string;
  /** Overlaps among logged blocks only: the warning dot and the VoiceOver note. */
  warningOverlapCount: number;
  widthFraction: number;
  zIndex: number;
};

export type NativeCalendarPresentation = {
  dayEndMs: number;
  dayStartMs: number;
  emptyState: string;
  entries: NativeCalendarPresentationEntry[];
  /** "5h 20m framed on Friday": confirmed time on the selected day (Review suggestions excluded). */
  framedLabel: string;
  hapticsEnabled: boolean;
  modelVersion: 4;
  /** The selected day's month; the year is added outside the current year. */
  monthTitle: string;
  nowMs: number;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  refreshing: boolean;
  selectedDayKey: string;
  selectedDayTitle: string;
  theme: NativeCalendarTheme;
  todayKey: string;
  additionalOverlapSeconds: number;
  coveredLabel: string;
  coveredSeconds: number;
  loggedLabel: string;
  loggedSeconds: number;
  totalLabel: string;
  totalSeconds: number;
  transitionDirection: -1 | 1;
  weekDays: Array<{
    accessibilityLabel: string;
    /** Up to three activity colours, most time first (confirmed time only). */
    bars: string[];
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

/** Review suggestions take the right 44% of the day column (Blocks prototype). */
export const REVIEW_LANE_WIDTH = 0.44;
/** At most two side by side in the Review lane keeps every target 44 points wide at 320 points. */
export const REVIEW_LANE_MAX_LANES = 2;
/**
 * A short block's tap target is 44 points tall, centred on its drawn block (and kept inside the day
 * at midnight). For the Review lane's lanes and crowds an item counts as covering that whole target
 * at the most zoomed-out Calendar (48 points an hour), where it spans 55 minutes; at every closer
 * zoom the target is inside that span, so two Review items never share one at any zoom. What is
 * drawn keeps the real times. This mirrors DayframeCalendarBlockMath / VerticalMath in
 * DayframeCalendarCore.swift exactly (DayframeCalendarCoreTests checks the same boundary cases).
 */
export const REVIEW_LANE_TARGET_MS = 55 * 60_000;
/** iOS draws a block at least 4 points tall: 5 minutes at 48 points an hour. */
export const REVIEW_LANE_MIN_VISIBLE_MS = 5 * 60_000;

/** The time a Review item's tap target covers at the most zoomed-out Calendar. */
export function reviewTargetEnvelope(startMs: number, endMs: number, dayStartMs: number, dayEndMs: number) {
  const start = Math.max(dayStartMs, startMs);
  const end = Math.min(dayEndMs, Math.max(start, endMs));
  if (end - start >= REVIEW_LANE_TARGET_MS) return { start, end };
  // Centred on the drawn block, which starts at the real start and is at least 4 points tall.
  const middle = start + Math.max(end - start, REVIEW_LANE_MIN_VISIBLE_MS) / 2;
  const envelopeStart = Math.min(Math.max(dayStartMs, middle - REVIEW_LANE_TARGET_MS / 2), dayEndMs - REVIEW_LANE_TARGET_MS);
  return { start: envelopeStart, end: envelopeStart + REVIEW_LANE_TARGET_MS };
}

function withReviewTargetSpan(entry: NativeCalendarEntry, now: number, dayStart: Date, dayEnd: Date): NativeCalendarEntry {
  const start = Date.parse(entry.startedAt);
  const end = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return entry;
  const envelope = reviewTargetEnvelope(start, end, dayStart.getTime(), dayEnd.getTime());
  return { ...entry, startedAt: new Date(envelope.start).toISOString(), stoppedAt: new Date(envelope.end).toISOString() };
}
const REVIEW_LANE_Z_INDEX = 1_000;

function layoutDayEntries(
  entries: NativeCalendarEntry[],
  dayStart: Date,
  dayEnd: Date,
  now: number,
  options?: { insetOverlays?: boolean; minimumOverlapMs?: number }
) {
  return layoutTimeIntervals(
    entries.map((entry) => ({
      id: entry.id,
      startedAt: Math.max(dayStart.getTime(), Date.parse(entry.startedAt)),
      stoppedAt: Math.min(dayEnd.getTime(), entry.stoppedAt ? Date.parse(entry.stoppedAt) : now)
    })),
    now,
    options
  );
}

export function buildNativeCalendarBridgeState({
  data,
  hapticsEnabled = true,
  now,
  reduceMotion,
  reduceTransparency,
  refreshing,
  selectedDayKey,
  theme,
  transitionDirection
}: {
  data: MobileBootstrap | null;
  hapticsEnabled?: boolean;
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
  const timeEntries = buildTimeEntries(data);
  const entries = buildCalendarEntries(data, timeEntries, selectedDayKey, now);
  const confirmedEntries = entries.filter((entry) => !isCalendarReviewNeeded(entry));
  const confirmedAnalysis = analyzeTimeIntervals(
    confirmedEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    { range: { start: dayStart, end: dayEnd }, now }
  );
  // Hit geometry must know about every block a tap could land on, Review suggestions included, so a
  // short block never grows a 44-point target over a neighbour; the warning counts logged time only.
  const allEntryAnalysis = analyzeTimeIntervals(
    entries.map((entry) => ({ id: entry.id, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt })),
    { range: { start: dayStart, end: dayEnd }, now }
  );
  const analysisById = new Map(allEntryAnalysis.entries.map((entry) => [entry.id, entry]));
  const warningById = new Map(confirmedAnalysis.entries.map((entry) => [entry.id, entry.overlapCount]));
  // Confirmed blocks overlap only each other; Review suggestions sit in their own lane on the right
  // (REVIEW_LANE_WIDTH of the day column) above them, so a suggestion never squeezes logged time.
  const reviewEntries = entries.filter((entry) => isCalendarReviewNeeded(entry));
  const layoutById = new Map([
    ...layoutDayEntries(confirmedEntries, dayStart, dayEnd, now).map((layout) => [layout.id, layout] as const),
    // The lane is narrow: overlapping Review items always sit side by side (never an inset over a
    // longer one, which would leave it a strip too thin to tap).
    // Any overlap at all, even under a minute, splits lanes here: two suggestions must never share
    // one tap target.
    ...layoutDayEntries(reviewEntries.map((entry) => withReviewTargetSpan(entry, now, dayStart, dayEnd)), dayStart, dayEnd, now, { insetOverlays: false, minimumOverlapMs: 0 }).map((layout) => [layout.id, {
      ...layout,
      offsetFraction: 1 - REVIEW_LANE_WIDTH + layout.offsetFraction * REVIEW_LANE_WIDTH,
      widthFraction: layout.widthFraction * REVIEW_LANE_WIDTH,
      zIndex: REVIEW_LANE_Z_INDEX + layout.zIndex
    }] as const)
  ]);

  return {
    actionEntries: entries,
    model: {
      dayEndMs: dayEnd.getTime(),
      dayStartMs: dayStart.getTime(),
      emptyState: "Nothing framed yet.",
      framedLabel: formatFramedLabel(confirmedAnalysis.loggedSeconds, selectedDate),
      hapticsEnabled,
      entries: entries.map((entry) => serializeCalendarEntry(
        entry,
        dayStart,
        dayEnd,
        now,
        theme,
        layoutById.get(entry.id),
        // Review-lane items never share a target (their lanes and crowds already use the target
        // envelope), so iOS gives each its full 44-point height even when the times overlap.
        isCalendarReviewNeeded(entry) ? { overlapCount: 0, overlapSeconds: 0 } : analysisById.get(entry.id),
        isCalendarReviewNeeded(entry) ? 0 : warningById.get(entry.id) ?? 0
      )),
      modelVersion: 4,
      monthTitle: formatMonthTitle(selectedDate, new Date(now)),
      nowMs: now,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      selectedDayTitle: formatSelectedDayTitle(selectedDate, todayKey),
      theme: nativeCalendarTheme(theme),
      todayKey,
      additionalOverlapSeconds: confirmedAnalysis.additionalOverlapSeconds,
      coveredLabel: formatDuration(confirmedAnalysis.coveredSeconds),
      coveredSeconds: confirmedAnalysis.coveredSeconds,
      loggedLabel: formatDuration(confirmedAnalysis.loggedSeconds),
      loggedSeconds: confirmedAnalysis.loggedSeconds,
      totalLabel: formatDuration(confirmedAnalysis.loggedSeconds),
      totalSeconds: confirmedAnalysis.loggedSeconds,
      transitionDirection: transitionDirection < 0 ? -1 : 1,
      weekDays: buildWeekStripDays(selectedDayKey).map(({ date, key }) => ({
        accessibilityLabel: `Show ${formatSelectedDayTitle(date, todayKey)}`,
        bars: weekDayBars(timeEntries, date, now, theme),
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
  theme: MobileTheme,
  layout?: TimeIntervalLayout,
  analysis?: { overlapCount: number; overlapSeconds: number },
  warningOverlapCount = 0
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
  const actionKind: NativeCalendarActionKind = entry.reviewItemId !== undefined
    ? "review"
    : entry.isActive ? "active" : "completed";
  const actionId = entry.reviewItemId ?? entry.id;
  const isUncategorized = !entry.categoryId && !entry.categoryName;
  const blockColors = isUncategorized
    ? { fill: uncategorizedFillColor(theme.mode), text: theme.textPrimary }
    : blockColorsFor(entry.categoryColor ?? entry.categoryId, theme.mode, entry.categoryName ?? "No activity");
  // A Review suggestion is hatched in its suggested activity's colour (neutral without one) and
  // keeps theme text, as on Today's ribbon.
  const color = reviewNeeded && isUncategorized ? theme.textMuted : blockColors.fill;
  const textColor = reviewNeeded ? theme.textPrimary : blockColors.text;
  const tagText = entry.tags?.map((tag) => tag.name).join(" · ")
    || entry.tagNames?.join(" · ")
    || null;

  return {
    actionId,
    actionKind,
    accessibilityLabel: entry.reviewCrowd
      ? reviewCrowdAccessibilityLabel(entry.reviewCrowd, startedAtMs, effectiveStoppedAtMs)
      : `${reviewNeeded ? REVIEW_COPY.needsReview : entry.isActive ? "Edit running timer" : "Open time block"}: ${title}${entry.placeName ? `. Place: ${entry.placeName}` : ""}${tagText ? `. Tags: ${tagText}` : ""}${warningOverlapCount ? `. Overlaps ${warningOverlapCount} other ${warningOverlapCount === 1 ? "entry" : "entries"}.` : ""}`,
    color,
    continuesIntoNextDay: continuation.continuesIntoNextDay,
    entryId: entry.id,
    isActive: entry.isActive,
    isReview: reviewNeeded,
    isUncategorized,
    laneCount: layout?.laneCount ?? 1,
    laneIndex: layout?.laneIndex ?? 0,
    layoutMode: layout?.mode ?? "full",
    meta: calendarBlockMeta(entry, now, reviewNeeded, continuation.continuesIntoNextDay),
    offsetFraction: layout?.offsetFraction ?? 0,
    overlapCount: analysis?.overlapCount ?? 0,
    overlapSeconds: analysis?.overlapSeconds ?? 0,
    placeText: entry.placeName,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : dayStart.getTime(),
    startsBeforeDay: continuation.startsBeforeDay,
    stoppedAtMs: stoppedAtMs !== null && Number.isFinite(stoppedAtMs) ? stoppedAtMs : null,
    tagText,
    textColor,
    textDensity: layout?.textDensity ?? "full",
    title,
    warningOverlapCount,
    widthFraction: layout?.widthFraction ?? 1,
    zIndex: layout?.zIndex ?? 0
  };
}

function buildTimeEntries(data: MobileBootstrap | null): NativeCalendarEntry[] {
  if (!data) return [];
  return mergeActiveEntry(
    dedupeEntriesById([
      ...(data.historyEntries ?? []),
      ...(data.entries ?? []),
      ...(data.weekEntries ?? []),
      ...(data.dayEntries ?? [])
    ]),
    data.activeEntry
  ).map((entry) => ({
    ...entry,
    isActive: data.activeEntry?.id === entry.id || !entry.stoppedAt
  }));
}

function buildCalendarEntries(
  data: MobileBootstrap | null,
  allTimeEntries: NativeCalendarEntry[],
  selectedDayKey: string,
  now: number
) {
  if (!data) return [];
  const reviewEntries: NativeCalendarEntry[] = [];
  // A suggestion and the needs-review entry created from it are one moment: the suggestion draws
  // (it opens that Review card) and its linked entry does not. Unlinked entries still draw.
  const linkedEntryIds = new Set<string>();

  for (const item of data.reviewItems ?? []) {
    // UIA-060: every open suggestion with a time window, as Today's ribbon and the web Calendar
    // show them (hatched in the Review lane), not only commutes.
    if (!isOpenReviewItem(item)) continue;
    const draft = buildReviewItemDraftEntry(item, data.categories, now);
    if (!draft) continue;
    const entry: NativeCalendarEntry = {
      ...draft,
      id: `review:${item.id}`,
      isActive: false,
      isReviewSuggestion: true,
      reviewItemId: item.id
    };
      if (!entryOverlapsDay(entry, selectedDayKey, now)) continue;
    for (const entryId of item.linkedEntryIds ?? []) linkedEntryIds.add(entryId);
    reviewEntries.push(entry);
  }
  const timeEntries = allTimeEntries.filter((entry) =>
    entryOverlapsDay(entry, selectedDayKey, now)
    && !(linkedEntryIds.has(entry.id) && isCalendarReviewNeeded(entry))
  );

  const dayStartMs = startOfLocalDay(dateFromKey(selectedDayKey)).getTime();
  const laneEntries = collapseCrowdedReviewLane(
    [...timeEntries.filter(isCalendarReviewNeeded), ...reviewEntries],
    now,
    dayStartMs,
    addDays(new Date(dayStartMs), 1).getTime()
  );
  return [...timeEntries.filter((entry) => !isCalendarReviewNeeded(entry)), ...laneEntries]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
}

/**
 * The Review lane is 44% of the day column, so more than REVIEW_LANE_MAX_LANES side by side would
 * give targets under 44 points with no room for titles. Such a crowd becomes one hatched
 * "N suggestions" block over the whole crowd that opens Review on its earliest suggestion
 * (or the Review list when the crowd holds only older needs-review entries).
 */
export function collapseCrowdedReviewLane(
  entries: NativeCalendarEntry[],
  now: number,
  dayStartMs = Number.NEGATIVE_INFINITY,
  dayEndMs = Number.POSITIVE_INFINITY
): NativeCalendarEntry[] {
  const timed = entries
    .map((entry) => {
      const realStart = Date.parse(entry.startedAt);
      const realEnd = Math.max(realStart, entry.stoppedAt ? Date.parse(entry.stoppedAt) : now);
      // Clustering uses the tap-target envelope; the crowd is drawn over the real times.
      const envelope = Number.isFinite(dayStartMs) && Number.isFinite(dayEndMs)
        ? reviewTargetEnvelope(realStart, realEnd, dayStartMs, dayEndMs)
        : { start: realStart, end: Math.max(realEnd, realStart + REVIEW_LANE_TARGET_MS) };
      return { entry, realStart, start: envelope.start, realEnd, end: envelope.end };
    })
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result: NativeCalendarEntry[] = entries.filter((entry) => !Number.isFinite(Date.parse(entry.startedAt)));
  let crowd: typeof timed = [];
  let crowdEnd = -Infinity;
  const flush = () => {
    if (!crowd.length) return;
    if (maxConcurrent(crowd) <= REVIEW_LANE_MAX_LANES) {
      result.push(...crowd.map((item) => item.entry));
    } else {
      // The crowd opens its earliest suggestion by real start time.
      result.push(reviewCrowdEntry(
        [...crowd].sort((left, right) => left.realStart - right.realStart).map((item) => item.entry),
        Math.min(...crowd.map((item) => item.realStart)),
        Math.max(...crowd.map((item) => item.realEnd))
      ));
    }
    crowd = [];
    crowdEnd = -Infinity;
  };
  for (const item of timed) {
    if (crowd.length && item.start >= crowdEnd) flush();
    crowd.push(item);
    crowdEnd = Math.max(crowdEnd, item.end);
  }
  flush();
  return result;
}

/** "Needs review: 3 suggestions, 09:00 to 10:20. Opens Gym first." — distinct per crowd. */
function reviewCrowdAccessibilityLabel(
  crowd: NonNullable<NativeCalendarEntry["reviewCrowd"]>,
  startMs: number,
  endMs: number
) {
  const opens = crowd.opensTitle ? `Opens ${crowd.opensTitle} first.` : "Opens the Review list.";
  return `${REVIEW_COPY.needsReview}: ${crowd.count} suggestions, ${clockText(startMs)} to ${clockText(endMs)}. ${opens}`;
}

function clockText(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function maxConcurrent(items: { start: number; end: number }[]) {
  const edges = items.flatMap((item) => [
    { at: item.start, delta: 1 },
    { at: Math.max(item.end, item.start + 1), delta: -1 }
  ]).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let max = 0;
  for (const edge of edges) {
    current += edge.delta;
    max = Math.max(max, current);
  }
  return max;
}

function reviewCrowdEntry(entries: NativeCalendarEntry[], startMs: number, endMs: number): NativeCalendarEntry {
  const first = entries.find((entry) => entry.reviewItemId) ?? null;
  const label = `${entries.length} suggestions`;
  return {
    ...entries[0],
    id: `review-crowd:${entries[0].id}`,
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    description: label,
    durationSeconds: Math.max(0, Math.round((endMs - startMs) / 1000)),
    isActive: false,
    isReviewSuggestion: true,
    placeName: null,
    // "" opens the Review list rather than one card.
    reviewItemId: first?.reviewItemId ?? "",
    reviewCrowd: { count: entries.length, opensTitle: first ? displayEntryTitle(first) : null },
    reviewStatus: "needs_review",
    startedAt: new Date(startMs).toISOString(),
    stoppedAt: new Date(endMs).toISOString(),
    tagNames: [],
    tags: []
  };
}

/**
 * The week strip's colour bars: a day's three biggest activities by confirmed time within that day,
 * most first. Entries still waiting for Review do not count; time without an activity is neutral.
 */
function weekDayBars(entries: NativeCalendarEntry[], date: Date, now: number, theme: MobileTheme) {
  const dayStart = startOfLocalDay(date).getTime();
  const dayEnd = addDays(startOfLocalDay(date), 1).getTime();
  const totals = new Map<string, { color: string; seconds: number }>();
  for (const entry of entries) {
    if (isCalendarReviewNeeded(entry)) continue;
    const start = Math.max(dayStart, Date.parse(entry.startedAt));
    const stop = Math.min(dayEnd, entry.stoppedAt ? Date.parse(entry.stoppedAt) : now);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const uncategorized = !entry.categoryId && !entry.categoryName;
    const key = uncategorized ? "" : entry.categoryId ?? `name:${entry.categoryName}`;
    const color = uncategorized
      ? theme.textMuted
      : blockColorsFor(entry.categoryColor ?? entry.categoryId, theme.mode, entry.categoryName ?? "").fill;
    const current = totals.get(key);
    totals.set(key, { color, seconds: (current?.seconds ?? 0) + (stop - start) / 1000 });
  }
  return [...totals.values()]
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 3)
    .map((total) => total.color);
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
  return displayTimerDescription(entry) ?? entry.categoryName ?? "No activity";
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
    onAccent: theme.onAccent,
    shadow: theme.shadow,
    surface: theme.surface,
    surfaceMuted: theme.surfaceMuted,
    surfaceRaised: theme.surfaceRaised,
    textMuted: theme.textMuted,
    textPrimary: theme.textPrimary,
    textSecondary: theme.textSecondary,
    warning: theme.warning,
    warningText: theme.warningText
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
  return date.toLocaleDateString(undefined, { weekday: "narrow" });
}

function formatMonthTitle(date: Date, today: Date) {
  return date.toLocaleDateString(
    undefined,
    date.getFullYear() === today.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" }
  );
}

function formatFramedLabel(seconds: number, date: Date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  return Math.round(seconds / 60) > 0 ? `${formatDuration(seconds)} framed on ${weekday}` : `Nothing framed on ${weekday}`;
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
