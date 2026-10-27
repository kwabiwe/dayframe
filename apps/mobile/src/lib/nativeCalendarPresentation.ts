import { formatLocaleDate } from "./localeDateFormat";
import {
  analyzeTimeIntervals,
  blockColorsFor,
  calendarBlockInk,
  CALENDAR_BLOCK_LABEL,
  calendarBlockContinuationEdges,
  formatClockTime,
  resolveActivityIcon,
  namedPatternBrackets,
  type ClockFormat,
  type TimeIntervalLayout
} from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { layoutCalendarColumns } from "./calendarColumns";
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
  | "danger"
  | "dangerText"
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

export type NativeCalendarDetailLine = { glyph: "place" | "trip" | "health" | "tag" | "time"; text: string };

export type NativeCalendarPresentationEntry = {
  actionId: string;
  actionKind: NativeCalendarActionKind;
  accessibilityLabel: string;
  color: string;
  /**
   * Location v4 C6 and the dense-day rules: iOS puts logged blocks and Review suggestions together in
   * side-by-side columns over their drawn extents, recomputed at every zoom step. Every entry is sent
   * in the one "logged" group (Codex r1 on #580), so a native build that still lays groups out apart
   * also keeps them side by side; `isReview` says how each is drawn.
   */
  columnGroup: "logged" | "review";
  continuesIntoNextDay: boolean;
  entryId: string;
  /** The activity's registry glyph, drawn alone in a column under 34 points wide. */
  glyph: string;
  isActive: boolean;
  /** A finished block of a minute or less (dense-day rules): a tick at the gutter's edge, not a block. */
  isMoment: boolean;
  isReview: boolean;
  isUncategorized: boolean;
  laneCount: number;
  laneIndex: number;
  layoutMode: TimeIntervalLayout["mode"];
  /** The whole entry's length after the title: "11m", "1h 45m" (a running block's so far). */
  lengthLabel: string;
  /** The time and length line, shown only with room (dense-day rules): "10:45–12:30 · 1h 45m". */
  meta: string;
  /**
   * Calendar v3: the lines under the title, each with its icon, shown while they fit: the place (a pin,
   * or a route for a trip) or Apple Health, the tags, then the times ("09:00–10:20").
   */
  detailLines?: NativeCalendarDetailLine[];
  offsetFraction: number;
  /**
   * Blocks that could share a tap target: drives hit geometry (no 44-pt expansion while > 0).
   * Every Review suggestion it overlaps counts; a logged block counts only while the two share
   * horizontal space. A block in an overlap column also counts every block sharing its horizontal
   * space whose target envelope (at the most zoomed-out Calendar, so at every zoom) meets its own,
   * so a short block keeps its 44-point target in its column only where that space is free.
   */
  overlapCount: number;
  overlapSeconds: number;
  placeText: string | null;
  /** The part of the day column the group draws in: the whole column under the dense-day rules. */
  regionOffsetFraction: number;
  regionWidthFraction: number;
  startedAtMs: number;
  startsBeforeDay: boolean;
  stoppedAtMs: number | null;
  tagText: string | null;
  /** Measured on-block text colour for the solid fill (deep ink or white); theme text for Review. */
  textColor: string;
  /**
   * Calendar v3: the block's text, a darker (light) or lighter (dark) shade of its own hue measured to
   * meet AA on its tint, its Reduce Transparency tint and a nested tint (`calendarBlockInk`); theme text
   * for a suggestion.
   */
  ink?: string;
  textDensity: TimeIntervalLayout["textDensity"];
  title: string;
  /** Overlaps among logged blocks only: the warning dot and the VoiceOver note. */
  warningOverlapCount: number;
  widthFraction: number;
  zIndex: number;
};

/**
 * A named pattern's bracket (location v3 PR 14b): a complete trip wholly inside the day, from its
 * first part's start to its last part's end. Swift draws it beside the blocks, spanning its parts
 * (`memberIds`, oldest first) as they are drawn; its parts stay blocks.
 */
export type NativeCalendarPresentationBracket = {
  key: string;
  memberIds: string[];
  name: string;
  startedAtMs: number;
  stoppedAtMs: number;
};

export type NativeCalendarPresentation = {
  /** Named patterns on this day; while there are any, the day keeps a rail left of its blocks. */
  brackets: NativeCalendarPresentationBracket[];
  dayEndMs: number;
  dayStartMs: number;
  emptyState: string;
  entries: NativeCalendarPresentationEntry[];
  hapticsEnabled: boolean;
  /** Calendar › Grid or List (location v4 step 9): in List the native view draws only its header and week strip. */
  layout?: "grid" | "list";
  /** The phone's 12/24-hour format (PRD D18) for the hour grid, now marker and drag preview. */
  clockFormat: ClockFormat;
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

/**
 * More than this many suggestions at once collapse into one "N suggestions" block (a crowd), so a
 * suggestion's column never gets too narrow to read or tap.
 */
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
/**
 * A short block's drawn height at 48 points an hour ranges from an older native build's 4 points
 * (5 minutes) to a current build's one label line at the largest text size (location v4 C6: 15
 * points × 1.3, DayframeCalendarDayLayout.labelMinimumHeight), so its drawn middle can sit anywhere
 * between. The envelope covers the target wherever it is centred in that range, for either build.
 */
export const REVIEW_LANE_MIN_VISIBLE_MS = 5 * 60_000;
export const REVIEW_LANE_MAX_VISIBLE_MS = ((CALENDAR_BLOCK_LABEL.iosMinimumHeight * CALENDAR_BLOCK_LABEL.iosMaximumTextScale) / 48) * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Where iOS draws a moment: the local wall-clock minute of the day (DayframeCalendarBlockMath's
 * localMinute), as milliseconds after the day's start. On a clock-change day two different moments
 * can share a wall-clock time and are then drawn in the same place.
 */
function wallClockOffsetMs(ms: number, dayStartMs: number, dayEndMs: number) {
  if (ms >= dayEndMs) return DAY_MS;
  // Clipped to the day, then its real local time: a day that starts at 01:00 (a clock change at
  // midnight) is drawn from 01:00, as iOS's localMinute does.
  const date = new Date(Math.max(ms, dayStartMs));
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
}

/**
 * The span a tap target covers at the most zoomed-out Calendar, in drawn (wall-clock) time: the
 * result is on a 24-hour axis starting at `dayStartMs`, so compare envelopes only with each other.
 */
export function reviewTargetEnvelope(startMs: number, endMs: number, dayStartMs: number, dayEndMs: number) {
  const start = dayStartMs + wallClockOffsetMs(startMs, dayStartMs, dayEndMs);
  const end = Math.max(start, dayStartMs + wallClockOffsetMs(endMs, dayStartMs, dayEndMs));
  if (end - start >= REVIEW_LANE_TARGET_MS) return { start, end };
  // Centred on the drawn block, which starts at the real start and is at least one label line tall
  // (shortest and tallest line across text sizes), kept inside the day like iOS keeps its target.
  const lowMiddle = start + Math.max(end - start, REVIEW_LANE_MIN_VISIBLE_MS) / 2;
  const highMiddle = start + Math.max(end - start, REVIEW_LANE_MAX_VISIBLE_MS) / 2;
  const dayLast = dayStartMs + DAY_MS;
  const from = Math.min(Math.max(dayStartMs, lowMiddle - REVIEW_LANE_TARGET_MS / 2), dayLast - REVIEW_LANE_TARGET_MS);
  const to = Math.max(Math.min(dayLast, highMiddle + REVIEW_LANE_TARGET_MS / 2), dayStartMs + REVIEW_LANE_TARGET_MS);
  return { start: from, end: Math.max(to, from + REVIEW_LANE_TARGET_MS) };
}

function targetEnvelopeOf(entry: NativeCalendarEntry, now: number, dayStart: Date, dayEnd: Date) {
  const start = Date.parse(entry.startedAt);
  const end = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return reviewTargetEnvelope(start, end, dayStart.getTime(), dayEnd.getTime());
}



/**
 * Logged blocks: overlap columns side by side (Trello 210, `layoutCalendarColumns`), laid out where
 * iOS draws them (the wall-clock minute, clipped to the day; a running block ends now). Never an
 * inset over a longer block, which covered its title. Text density is left to iOS, which shows the
 * title and the time/place lines only where the measured column width and height allow them.
 */
function layoutLoggedColumns(entries: NativeCalendarEntry[], dayStart: Date, dayEnd: Date, now: number): TimeIntervalLayout[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  return layoutCalendarColumns(entries.flatMap((entry) => {
    const start = Date.parse(entry.startedAt);
    const end = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const drawnStart = dayStartMs + wallClockOffsetMs(start, dayStartMs, dayEndMs);
    return [{ id: entry.id, startMs: drawnStart, endMs: Math.max(drawnStart, dayStartMs + wallClockOffsetMs(end, dayStartMs, dayEndMs)) }];
  })).map((column) => ({
    id: column.id,
    groupId: column.clusterId,
    mode: column.columnCount === 1 ? "full" : "lane",
    laneIndex: column.columnIndex,
    laneCount: column.columnCount,
    offsetFraction: column.offsetFraction,
    widthFraction: column.widthFraction,
    zIndex: column.zIndex,
    textDensity: "full"
  }));
}

/** Two laid-out blocks share horizontal space (a missing layout counts as the full width). */
function sharesHorizontalSpace(left: TimeIntervalLayout | undefined, right: TimeIntervalLayout | undefined) {
  const leftStart = left?.offsetFraction ?? 0;
  const rightStart = right?.offsetFraction ?? 0;
  const epsilon = 1e-9;
  return leftStart < rightStart + (right?.widthFraction ?? 1) - epsilon
    && rightStart < leftStart + (left?.widthFraction ?? 1) - epsilon;
}


export function buildNativeCalendarBridgeState({
  clockFormat = "24h",
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
  clockFormat?: ClockFormat;
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
  const dayEnd = localDayEnd(dayStart);
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
  // Dense-day rules (owner, 24 Oct 2026): logged blocks and Review suggestions share one set of
  // side-by-side columns; nothing is drawn on top of another and suggestions need no lane. iOS lays
  // them out at every zoom; these fractions are the fallback for a native build without that.
  const layoutById = new Map<string, TimeIntervalLayout>(
    layoutLoggedColumns(entries, dayStart, dayEnd, now).map((layout) => [layout.id, layout] as const)
  );

  // Named patterns (location v3 PR 14b): the day's blocks in Calendar's order, as Today groups them;
  // only a trip wholly inside the day gets a bracket (none across midnight). Each part's own label
  // says which trip it is part of; the bracket itself is hidden from VoiceOver.
  const brackets = namedPatternBrackets(
    timeEntries.filter((entry) => entryOverlapsDay(entry, selectedDayKey, now)),
    { startMs: dayStart.getTime(), endMs: dayEnd.getTime() }
  );
  const bracketParts = new Map<string, string>();
  for (const bracket of brackets) {
    bracket.memberIds.forEach((id, index) => bracketParts.set(id, `Part ${index + 1} of ${bracket.memberIds.length} of ${bracket.name}`));
  }

  const envelopeById = new Map(entries.map((entry) => [entry.id, targetEnvelopeOf(entry, now, dayStart, dayEnd)] as const));
  // A logged block's hit geometry counts every Review suggestion it overlaps, and the logged blocks
  // it overlaps only while they share horizontal space: overlap columns put them side by side, so a
  // short block's 44-point target stays inside its own column and never covers its neighbour.
  // Inside an overlap column the target must also stay clear of the blocks above and below it in
  // that column (a reused column, Codex r1 on #357): any block sharing its horizontal space whose
  // target envelope meets its own counts too, so neither grows over the other at any zoom. (The
  // envelope is the target at the most zoomed-out Calendar; closer zooms keep the target inside it.)
  // Full-width blocks keep their earlier rule; a column block draws above them (zIndex).
  const hitAnalysis = (id: string) => {
    const analysis = analysisById.get(id);
    if (!analysis) return undefined;
    const own = layoutById.get(id);
    const counted = new Set(analysis.overlappingEntryIds.filter((otherId) =>
      sharesHorizontalSpace(own, layoutById.get(otherId))
    ));
    const envelope = envelopeById.get(id);
    if ((own?.laneCount ?? 1) > 1 && envelope) {
      for (const other of entries) {
        if (other.id === id || counted.has(other.id)) continue;
        if (!sharesHorizontalSpace(own, layoutById.get(other.id))) continue;
        const otherEnvelope = envelopeById.get(other.id);
        if (otherEnvelope && envelope.start < otherEnvelope.end && otherEnvelope.start < envelope.end) counted.add(other.id);
      }
    }
    return { overlapCount: counted.size, overlapSeconds: analysis.overlapSeconds };
  };

  return {
    actionEntries: entries,
    model: {
      brackets: brackets.map((bracket) => ({
        key: bracket.key,
        memberIds: bracket.memberIds,
        name: bracket.name,
        startedAtMs: bracket.startMs,
        stoppedAtMs: bracket.endMs
      })),
      dayEndMs: dayEnd.getTime(),
      dayStartMs: dayStart.getTime(),
      emptyState: "Nothing framed yet.",
      hapticsEnabled,
      clockFormat,
      entries: entries.map((entry) => serializeCalendarEntry(
        entry,
        dayStart,
        dayEnd,
        now,
        theme,
        clockFormat,
        layoutById.get(entry.id),
        hitAnalysis(entry.id),
        isCalendarReviewNeeded(entry) ? 0 : warningById.get(entry.id) ?? 0,
        bracketParts.get(entry.id),
        { offset: 0, width: 1 },
        resolveActivityIcon({
          icon: data?.categories?.find((category) => category.id === entry.categoryId)?.icon,
          name: entry.categoryName
        }).glyph
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
        // Calendar v3: the strip carries the date ("Friday 23 October"), so it is read in full.
        accessibilityLabel: `${formatFullDate(date)}${key === todayKey ? ", today" : ""}`,
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
  clockFormat: ClockFormat,
  layout?: TimeIntervalLayout,
  analysis?: { overlapCount: number; overlapSeconds: number },
  warningOverlapCount = 0,
  /** "Part 2 of 3 of School run": a named pattern's part (location v3 PR 14b). */
  partOf?: string,
  region: { offset: number; width: number } = { offset: 0, width: 1 },
  glyph: string = resolveActivityIcon({}).glyph
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
  const ink = reviewNeeded ? theme.textPrimary : calendarInk(color, theme);
  const tagText = entry.tags?.map((tag) => tag.name).join(" · ")
    || entry.tagNames?.join(" · ")
    || null;
  const timeRange = `${formatClockTime(new Date(startedAtMs), clockFormat)} to ${stoppedAtMs === null ? "now" : formatClockTime(new Date(stoppedAtMs), clockFormat)}`;
  const length = spokenDuration(entryLengthSeconds(entry, now));

  return {
    actionId,
    actionKind,
    accessibilityLabel: entry.reviewCrowd
      ? reviewCrowdAccessibilityLabel(entry.reviewCrowd, startedAtMs, effectiveStoppedAtMs, clockFormat)
      : `${reviewNeeded ? REVIEW_COPY.needsReview : entry.isActive ? "Edit running timer" : "Open time block"}: ${title}, ${timeRange}, ${length}${entry.placeName ? `. Place: ${entry.placeName}` : ""}${tagText ? `. Tags: ${tagText}` : ""}${partOf ? `. ${partOf}` : ""}${warningOverlapCount ? `. Overlaps ${warningOverlapCount} other ${warningOverlapCount === 1 ? "entry" : "entries"}.` : ""}`,
    color,
    columnGroup: "logged",
    continuesIntoNextDay: continuation.continuesIntoNextDay,
    detailLines: entry.reviewCrowd ? [] : calendarDetailLines(entry, tagText, now, clockFormat),
    entryId: entry.id,
    glyph,
    isActive: entry.isActive,
    // Dense-day rules: a finished block of a minute or less is a moment, drawn as a tick.
    isMoment: !reviewNeeded && stoppedAtMs !== null && Number.isFinite(stoppedAtMs) && stoppedAtMs - startedAtMs <= 60_000,
    isReview: reviewNeeded,
    ink,
    isUncategorized,
    laneCount: layout?.laneCount ?? 1,
    laneIndex: layout?.laneIndex ?? 0,
    layoutMode: layout?.mode ?? "full",
    lengthLabel: formatDuration(entryLengthSeconds(entry, now)),
    meta: calendarBlockTimesAndLength(entry, now, clockFormat),
    offsetFraction: layout?.offsetFraction ?? 0,
    overlapCount: analysis?.overlapCount ?? 0,
    overlapSeconds: analysis?.overlapSeconds ?? 0,
    placeText: entry.placeName,
    regionOffsetFraction: region.offset,
    regionWidthFraction: region.width,
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
  // A crowd's own span can reach further than its members (iOS's minimum height, a clock change),
  // meeting more suggestions: crowds are formed again until nothing changes, so the lane never
  // holds more than REVIEW_LANE_MAX_LANES side by side.
  let laneEntries = [...timeEntries.filter(isCalendarReviewNeeded), ...reviewEntries];
  for (let pass = 0; pass < 8; pass += 1) {
    const next = collapseCrowdedReviewLane(laneEntries, now, dayStartMs, localDayEnd(new Date(dayStartMs)).getTime());
    const settled = next.length === laneEntries.length;
    laneEntries = next;
    if (settled) break;
  }
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
      // Where iOS draws it (wall clock), for the crowd's bounds on a clock-change day.
      const bounded = Number.isFinite(dayStartMs) && Number.isFinite(dayEndMs);
      const drawnStart = bounded ? wallClockOffsetMs(realStart, dayStartMs, dayEndMs) : realStart;
      const rawDrawnEnd = bounded ? wallClockOffsetMs(realEnd, dayStartMs, dayEndMs) : realEnd;
      // iOS draws at least 4 points (5 minutes at the widest zoom; a current build one label line, which
      // only lengthens it) from the drawn start, also when the clock folds back inside the item and its
      // drawn end comes before its start.
      const drawnEnd = drawnStart + Math.max(rawDrawnEnd - drawnStart, REVIEW_LANE_MIN_VISIBLE_MS);
      return { entry, realStart, start: envelope.start, realEnd, end: envelope.end, drawnStart, drawnEnd, rawDrawnEnd };
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
      // The crowd opens its earliest suggestion by real start time, and is drawn from the earliest
      // drawn start to the latest drawn end. On a clock-change day the earliest drawn start can be a
      // later moment than the latest drawn end, so the end then keeps the drawn length instead.
      const first = crowd.reduce((best, item) => item.drawnStart < best.drawnStart ? item : best);
      const last = crowd.reduce((best, item) => item.drawnEnd > best.drawnEnd ? item : best);
      // Anchored to the visible day: a crowd starting the night before starts at midnight.
      const startMs = Number.isFinite(dayStartMs) ? Math.max(first.realStart, dayStartMs) : first.realStart;
      const endMs = last.drawnEnd === last.rawDrawnEnd && last.realEnd > startMs
        ? last.realEnd
        : Number.isFinite(dayStartMs) && Number.isFinite(dayEndMs)
          ? momentAtWallClock(startMs, last.drawnEnd, dayStartMs, dayEndMs)
          : startMs + (last.drawnEnd - first.drawnStart);
      result.push(reviewCrowdEntry(
        [...crowd].sort((left, right) => left.realStart - right.realStart).map((item) => item.entry),
        startMs,
        endMs
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

/**
 * The first moment after `afterMs` that iOS draws at `wallOffsetMs` into the day: elapsed time is
 * corrected by how far the wall clock is off, so the result lands on the intended drawn time even
 * across a clock change.
 */
function momentAtWallClock(afterMs: number, wallOffsetMs: number, dayStartMs: number, dayEndMs: number) {
  const wall = (ms: number) => wallClockOffsetMs(ms, dayStartMs, dayEndMs);
  let moment = afterMs + (wallOffsetMs - wall(afterMs));
  for (let step = 0; step < 3; step += 1) {
    const off = wallOffsetMs - wall(moment);
    if (Math.abs(off) < 1_000) return Math.min(dayEndMs, Math.max(afterMs + 60_000, moment));
    moment += off;
  }
  // No moment shows that time (it falls in the hour skipped when clocks go forward): the earliest
  // moment drawn at or after it, so the crowd still covers every member. Drawn time only moves
  // forward between the start and the day's end apart from a fold, which the corrections handle.
  let low = afterMs;
  let high = dayEndMs;
  while (high - low > 1_000) {
    const middle = low + (high - low) / 2;
    if (wall(middle) >= wallOffsetMs) high = middle;
    else low = middle;
  }
  return Math.min(dayEndMs, Math.max(afterMs + 60_000, high));
}

/** "Needs review: 3 suggestions, 09:00 to 10:20. Opens Gym first." — distinct per crowd. */
function reviewCrowdAccessibilityLabel(
  crowd: NonNullable<NativeCalendarEntry["reviewCrowd"]>,
  startMs: number,
  endMs: number,
  clockFormat: ClockFormat
) {
  const opens = crowd.opensTitle ? `Opens ${crowd.opensTitle} first.` : "Opens the Review list.";
  return `${REVIEW_COPY.needsReview}: ${crowd.count} suggestions, ${formatClockTime(startMs, clockFormat)} to ${formatClockTime(endMs, clockFormat)}. ${opens}`;
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
  // A crowd formed again around an earlier crowd counts that crowd's members.
  const count = entries.reduce((total, entry) => total + (entry.reviewCrowd?.count ?? 1), 0);
  const label = `${count} suggestions`;
  return {
    ...entries[0],
    id: entries[0].id.startsWith("review-crowd:") ? entries[0].id : `review-crowd:${entries[0].id}`,
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
    reviewCrowd: { count, opensTitle: first ? first.reviewCrowd?.opensTitle ?? displayEntryTitle(first) : null },
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
  const dayEnd = localDayEnd(dayStart);
  const startedAt = Date.parse(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  return Number.isFinite(startedAt) && Number.isFinite(stoppedAt) && startedAt < dayEnd.getTime() && stoppedAt > dayStart.getTime();
}

/**
 * The detail line from 34 points (location v4 C6): "Deep work · 10:45–12:30" — the activity unless it
 * is already the title, then the times; a running block ends "now". Review and next-day notes lead.
 */
/**
 * The time and length line (dense-day rules), shown only where a block has room: "07:05–07:40 · 35m",
 * "+1" on a finish the next day, "now" for a running block.
 */
/** `calendarBlockInk` for a block colour, or theme text for a colour that is not #RRGGBB. */
function calendarInk(color: string, theme: MobileTheme) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? calendarBlockInk(color, theme.mode, { background: theme.background, surface: theme.surface })
    : theme.textPrimary;
}

function calendarDetailLines(entry: NativeCalendarEntry, tagText: string | null, now: number, clockFormat: ClockFormat) {
  const lines: NativeCalendarDetailLine[] = [];
  if ((entry.source ?? "").startsWith("health")) lines.push({ glyph: "health", text: "From Apple Health" });
  else if (entry.placeName) lines.push({ glyph: entry.automaticMoveEventId ? "trip" : "place", text: entry.placeName });
  if (tagText) lines.push({ glyph: "tag", text: tagText });
  lines.push({ glyph: "time", text: calendarBlockTimes(entry, now, clockFormat) });
  return lines;
}

/** "09:00–10:20", "22:00–01:30 +1", "16:05–now". */
function calendarBlockTimes(entry: NativeCalendarEntry, now: number, clockFormat: ClockFormat) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  const days = Math.round((startOfLocalDay(stoppedAt).getTime() - startOfLocalDay(startedAt).getTime()) / DAY_MS);
  const finish = entry.stoppedAt ? `${formatClockTime(stoppedAt, clockFormat)}${days > 0 ? ` +${days}` : ""}` : "now";
  return `${formatClockTime(startedAt, clockFormat)}–${finish}`;
}

function calendarBlockTimesAndLength(entry: NativeCalendarEntry, now: number, clockFormat: ClockFormat) {
  return `${calendarBlockTimes(entry, now, clockFormat)} · ${formatDuration(entryLengthSeconds(entry, now))}`;
}

/** The block's real length from its own times (a running one up to now). */
function entryLengthSeconds(entry: NativeCalendarEntry, now: number) {
  const startedAt = Date.parse(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? Date.parse(entry.stoppedAt) : now;
  return Number.isFinite(startedAt) && Number.isFinite(stoppedAt)
    ? Math.max(0, Math.floor((stoppedAt - startedAt) / 1000))
    : entryDurationSeconds(entry, now);
}

/** "1 hour 10 minutes" for VoiceOver. */
function spokenDuration(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes === 0) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const part = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  return [hours ? part(hours, "hour") : null, rest ? part(rest, "minute") : null].filter(Boolean).join(" ");
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
    danger: theme.danger,
    dangerText: theme.dangerText,
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

/**
 * The next local midnight: the day's exclusive end. Not "start + one day", which on a day that
 * starts at 01:00 (a clock change at midnight) would reach 01:00 the next day.
 */
function localDayEnd(dayStart: Date) {
  return startOfLocalDay(addDays(dayStart, 1));
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatSelectedDayTitle(date: Date, todayKey: string) {
  if (formatDateKey(date) === todayKey) return "Today";
  return formatLocaleDate(date, { day: "numeric", month: "short", weekday: "long" });
}

function formatWeekday(date: Date) {
  return formatLocaleDate(date, { weekday: "narrow" });
}

function formatMonthTitle(date: Date, today: Date) {
  return formatLocaleDate(date, date.getFullYear() === today.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" }
  );
}

/** "Friday 23 October", in the phone's own date order. */
function formatFullDate(date: Date) {
  return formatLocaleDate(date, { day: "numeric", month: "long", weekday: "long" });
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
