"use client";

import { useLocalDayStartMs } from "@/components/useCalendarClock";
import { askingChecks, checkBlockId, clashBlocksFrom, clashStillAsks } from "@/lib/calendar-checks";
import { CalendarLegStrip, CalendarPlacesLane, placesLaneWidth } from "@/components/location/CalendarPlacesLane";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from "react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tripsByBlockId, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import { useGridCorrection } from "@/components/location/useGridCorrection";
import { blockQuestionWords, useEndedBlocks, useProjectedReviewItems, useSharedCheckDecisions } from "@/components/location/ListChecks";
import { analyzeTimeIntervals, calendarBlockContinuationEdges, calendarDenseLabel, wholeWordsThatFit, formatClockHour, bracketsWithin, formatClockParts, namedPatternBrackets, type ClockFormat, type NamedPatternBracket } from "@dayframe/shared";
import { useClockFormat } from "@/components/ClockFormat";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { CalendarEntryCompactEditor } from "@/components/CalendarEntryCompactEditor";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { ErrorBanner } from "@/components/blocks/ErrorBanner";
import { deletedToastLabel } from "@/lib/blocks-toast-copy";
import { useTripOptOut } from "@/components/blocks/useTripOptOut";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { OverlapNotice } from "@/components/OverlapNotice";
import { EntriesTable } from "@/components/EntriesTable";
import { useTimelineDeleteUndo } from "@/components/useTimelineDeleteUndo";
import { IconButton, SegmentedControl } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { duplicateTimeEntry, splitTimeEntry, type BlockMutationOutcome } from "@/lib/time-entry-split";
import { timeEntryAccentColor, timeEntryTitle } from "@/lib/display";
import { blockStyle as activityBlockStyle } from "@/lib/block-style";
import type { BootstrapData, CategoryRow, PlaceRow, ReviewItemRow, TimeEntryRow } from "@/lib/queries";
import { pendingReviewSpans } from "@/lib/today-view";
import {
  dateTimeLocalInputToIso,
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import {
  calendarBlockDetailLines,
  calendarBlockLaneInsets,
  calendarBlockLanePxInsets,
  calendarBracketDayRailPx,
  calendarBracketRailPx,
  calendarBlockPrimaryParts,
  calendarBlockPrimaryLine,
  calendarBlockSecondaryLine,
  calendarBlockVisualGapPx,
  calendarBlockVisualGeometry,
  canShowTimeBlockInlineAction,
  getTimeBlockDensity,
  calendarLaneWidth,
  layoutTimeBlockHybrid,
  layoutTimeBlockLanes,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames,
  type TimeBlockLane
} from "@/lib/time-block-display";
import {
  clipTimelineEntries,
  mergeTimelineEntries
} from "@/lib/timeline-calculations";
import { entryOverlapSeconds } from "@/lib/time-entry-overlap";
import {
  TIMELINE_PREFERENCE_COOKIE,
  formatTimelinePeriodLabel,
  resetTimelineState,
  resolveTimelineRanges,
  shiftTimelineState,
  shouldAdvanceStaleTimelineToToday,
  timelineHref,
  timelinePreferenceCookieValue,
  updateTimelinePreference,
  timelineStateFromSearchParams,
  toTimelineDateKey,
  type TimelinePreference,
  type TimelineScope,
  type TimelineState,
  type TimelineView
} from "@/lib/timeline-view";
import { reportsHrefForCustomRange } from "@/lib/report-filters";
import { calendarHeadModel } from "@/lib/calendar-head";
import { CalendarHead } from "@/components/calendar/CalendarHead";
import type {
  CalendarEntryCompactCreatePlan,
  CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import {
  calculateCalendarClickCreateSlot,
  calculateCalendarDraftAnchorGeometry,
  calendarCreateGhostGeometry,
  calendarCreateLimitMinutes,
  calendarCreateMinuteIsFuture,
  calendarCreatePointerSequenceAccepted,
  calendarDragCreateRange,
  calendarDragCreateSeconds,
  calendarDragCreateSlot,
  calendarDragMinutesAt,
  calendarPointHitsSemanticBlock,
  calendarPointerMatchesConsumed,
  calendarPointerMinutesAt,
  isEligibleCalendarCreatePointer,
  type CalendarConsumedPointer,
  type CalendarCreatePointerSequence,
  type CalendarCreateTargetKind
} from "@/lib/calendar-click-create";
import { calendarInitialScrollHour } from "@/lib/calendar-initial-scroll";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { useLocationTimelines } from "@/components/location/LocationListRows";
import { useCalendarListWeeks } from "@/components/useCalendarListWeeks";

type CalendarHoursMode = "fullDay";

/** Half the now pill's height (11 px text + 2 px padding each side), for clamping it inside the axis. */
const NOW_PILL_HALF_HEIGHT = 10;
// Owner decision 12 Oct 2026 (option B): Calendar creates past time only, and says so.
const CALENDAR_FUTURE_CREATE_NOTICE = "Blocks can't start in the future";
const CALENDAR_CREATE_NOTICE_MS = 3_000;
const CALENDAR_CREATE_NOTICE_EXIT_MS = 160;

const scopeItems: Array<{ id: TimelineScope; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" }
];
const viewItems: Array<{ id: TimelineView; label: string }> = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List" }
];

const calendarHourModes: Record<CalendarHoursMode, { label: string; startHour: number; endHour: number }> = {
  fullDay: { label: "24h", startHour: 0, endHour: 24 }
};
// Resize and drag-create both move in 5-minute steps (prototype web.html beginResize).
const calendarSnapMinutes = 5;
const calendarZooms = {
  hour: { label: "1h", intervalMinutes: 60, pixelsPerHour: 64 },
  half: { label: "30m", intervalMinutes: 30, pixelsPerHour: 92 },
  quarter: { label: "15m", intervalMinutes: 15, pixelsPerHour: 128 }
} as const;
const calendarAxisLabelHeight = 22;
const TIMELINE_TODAY_SESSION_KEY = "dayframe.timeline.today-key";

function readTimelineTodaySessionKey() {
  try {
    return window.sessionStorage.getItem(TIMELINE_TODAY_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeTimelineTodaySessionKey(todayKey: string) {
  try {
    window.sessionStorage.setItem(TIMELINE_TODAY_SESSION_KEY, todayKey);
  } catch {
    return;
  }
}

type CalendarResizeEdge = "start" | "end";
type CalendarZoom = keyof typeof calendarZooms;

type CalendarResizeDraft = {
  entryId: string;
  startedAt: string;
  stoppedAt: string;
};

type CalendarEntryEditorTarget = {
  kind: "entry";
  anchor: HTMLElement;
  blockKey: string;
  entryId: string;
  focusOnOpen: boolean;
  scopeKey: string;
  sessionId: number;
};

type CalendarCreateEditorTarget = {
  kind: "create";
  anchor: HTMLElement | null;
  dayKey: string;
  draftStartedAt: string;
  draftStoppedAt: string;
  startedAt: string;
  stoppedAt: string;
  scopeKey: string;
  sessionId: number;
};

type CalendarEditorTarget = CalendarEntryEditorTarget | CalendarCreateEditorTarget;


/** Room the resize tip needs to the pointer's right before it flips to the left (W13). */
const RESIZE_TIP_ROOM = 150;
export function TimeReviewViews({
  initialData,
  initialPreference,
  initialTodayKey = null,
  renderedAt
}: {
  initialData: BootstrapData;
  initialPreference: TimelinePreference | null;
  /** Today's date key in the viewer's zone as the server saw it; used until hydration. */
  initialTodayKey?: string | null;
  renderedAt: string;
}) {
  const data = useRuntimePageData(initialData);
  const {
    clearDateLoadError,
    dateLoadError,
    isDateLoading,
    loadDate,
    refresh
  } = useAppShellRuntime();
  const searchParams = useSearchParams();
  const state = timelineStateFromSearchParams(searchParams, { preference: initialPreference });
  const isList = state.view === "list";
  const listOwner = `${data.workspace.id}:${data.user.id}`;
  // Saved places a location row can be corrected to (location v4 step 13): names and roles only.
  const correctionPlaces = useMemo(() => data.places.map(({ id, name, role }) => ({ id, name, role })), [data.places]);
  const preferenceState = useMemo(
    () => ({ scope: state.scope, view: state.view }),
    [state.scope, state.view]
  );
  const ranges = resolveTimelineRanges(state);
  const hasRunningEntry = Boolean(
    data.activeEntry ||
    data.entries.some((entry) => entry.stoppedAt === null) ||
    data.weekEntries.some((entry) => entry.stoppedAt === null)
  );
  const [presentationNow, setPresentationNow] = useState(() => Date.now());
  // Server render and hydration share the server's render time so running durations match.
  const hydrated = useIsHydrated();
  const capturedNow = useMemo(
    () => new Date(hydrated ? presentationNow : Date.parse(renderedAt)),
    [hydrated, presentationNow, renderedAt]
  );
  const calendarHoursMode: CalendarHoursMode = "fullDay";
  const preferenceRef = useRef<TimelinePreference | null>(initialPreference);
  // Calendar starts unset so CalendarReview can open near now; later visits restore where it was left.
  const scrollPositionsRef = useRef<Record<TimelineView, TimelineScrollPosition | null>>({
    calendar: null,
    list: { left: 0, top: 0 }
  });
  const activeScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineStateRef = useRef(state);
  const navigateRef = useRef<(overrides: Partial<TimelineState>, options?: { replace?: boolean }) => Promise<void>>(async () => undefined);
  const todayKeyRef = useRef(toTimelineDateKey(new Date()));
  const initialTodayKeyRef = useRef(initialTodayKey);

  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);
  // An edit or delete in the List also reads its loaded weeks (and their places) again.
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const refreshList = useCallback(async () => {
    setListRefreshToken((token) => token + 1);
    await refresh();
  }, [refresh]);

  const registerScrollContainer = useCallback((element: HTMLDivElement | null) => {
    activeScrollContainerRef.current = element;
  }, []);

  const hasRememberedCalendarScroll = useCallback(() => scrollPositionsRef.current.calendar !== null, []);

  const rememberScrollPosition = useCallback((view: TimelineView, event: UIEvent<HTMLDivElement>) => {
    scrollPositionsRef.current[view] = {
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop
    };
  }, []);

  const persistPreference = useCallback((nextState: Pick<TimelineState, "scope" | "view">) => {
    const nextPreference = updateTimelinePreference(nextState);
    preferenceRef.current = nextPreference;
    document.cookie = `${TIMELINE_PREFERENCE_COOKIE}=${timelinePreferenceCookieValue(nextPreference)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  useEffect(() => {
    persistPreference(preferenceState);
  }, [persistPreference, preferenceState]);

  useEffect(() => {
    // Each second while a block runs; otherwise each 30 s so Calendar's now line keeps moving.
    const interval = window.setInterval(() => setPresentationNow(Date.now()), hasRunningEntry ? 1_000 : 30_000);
    return () => window.clearInterval(interval);
  }, [hasRunningEntry]);

  useLayoutEffect(() => {
    const container = activeScrollContainerRef.current;
    if (!container) return;
    // The List positions itself (continuous days: the selected day at the top), so only the Calendar
    // restores where it was left (Codex r1 on #584).
    if (state.view === "list") return;
    const position = scrollPositionsRef.current[state.view];
    if (!position) return;
    container.scrollLeft = position.left;
    container.scrollTop = position.top;
  }, [state.date, state.scope, state.view]);

  async function navigate(overrides: Partial<typeof state>, options: { replace?: boolean } = {}) {
    const nextState = { ...state, ...overrides };
    const href = timelineHref(searchParams.toString(), state, nextState);
    const originSearch = searchParams.toString();

    if (
      nextState.date === state.date &&
      nextState.scope === state.scope &&
      nextState.view === state.view
    ) {
      clearDateLoadError();
      return;
    }

    if (nextState.date === state.date) {
      clearDateLoadError();
      window.history.pushState(null, "", href);
      persistPreference(nextState);
      return;
    }

    const outcome = await loadDate(nextState.date);
    if (!outcome.ok) return;
    if (window.location.search.slice(1) !== originSearch) return;
    if (options.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    persistPreference(nextState);
  }

  useLayoutEffect(() => {
    timelineStateRef.current = state;
    navigateRef.current = navigate;
  });

  useEffect(() => {
    let rolloverTimeout: number | null = null;

    const scheduleRollover = () => {
      if (rolloverTimeout !== null) window.clearTimeout(rolloverTimeout);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      rolloverTimeout = window.setTimeout(reconcileToday, Math.max(250, nextMidnight.getTime() - now.getTime() + 100));
    };

    // The first visible check after the page loads corrects the date the server picked with a
    // replacement, so Back never returns to it; later ones (midnight) add a history entry.
    let landed = false;
    const reconcileToday = () => {
      if (document.visibilityState !== "visible") {
        scheduleRollover();
        return;
      }
      const landing = !landed;
      landed = true;
      const now = new Date();
      const previousTodayKey = todayKeyRef.current;
      const currentTodayKey = toTimelineDateKey(now);
      todayKeyRef.current = currentTodayKey;
      writeTimelineTodaySessionKey(currentTodayKey);
      if (currentTodayKey !== previousTodayKey) {
        setPresentationNow(now.getTime());
        const currentState = timelineStateRef.current;
        if (shouldAdvanceStaleTimelineToToday(currentState, previousTodayKey, now)) {
          void navigateRef.current(resetTimelineState(currentState, now), { replace: landing });
        }
      }
      scheduleRollover();
    };

    const handleFocus = () => reconcileToday();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileToday();
    };
    // The day this page last treated as today: this tab's own record, otherwise the server's guess
    // in the viewer's zone. A first visit without the zone cookie (or with a stale one) can open
    // the server's "today" (UTC on Vercel) just after local midnight; a page showing that day then
    // moves to the browser's today, as it does when midnight passes (Codex r1 on #367).
    const storedTodayKey = readTimelineTodaySessionKey();
    const landingTodayKey = storedTodayKey ?? initialTodayKeyRef.current;
    if (landingTodayKey) todayKeyRef.current = landingTodayKey;
    reconcileToday();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (rolloverTimeout !== null) window.clearTimeout(rolloverTimeout);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function updateView(view: TimelineView) {
    if (isDateLoading) return;
    navigate({
      view,
      scope: preferenceRef.current?.preferredScope ?? state.scope
    });
  }

  function updateScope(scope: TimelineScope) {
    if (isDateLoading) return;
    navigate({ scope });
  }

  // Calendar › List shows continuous days (owner, 24 Oct 2026): the selected week from the shell's data,
  // and whole weeks before and after it, loaded as the List scrolls. The period controls don't apply.
  const listTodayKey = hydrated ? toTimelineDateKey(capturedNow) : initialTodayKey;
  const listWeeks = useCalendarListWeeks({
    anchorWeekStart: ranges.week.start,
    currentWeekStart: listTodayKey ? resolveTimelineRanges({ ...state, date: listTodayKey }).week.start : null,
    enabled: isList && hydrated,
    owner: listOwner,
    refreshToken: listRefreshToken
  });
  const listRange = { start: listWeeks.rangeStart, end: listWeeks.rangeEnd };
  const listDays = isList ? timelineDayKeys(listRange, listTodayKey) : NO_DAY_KEYS;
  // Per owner and selected week: another week (or workspace) starts a new lifetime, so a return to a week
  // reads its days again rather than showing an earlier visit's (Codex r2 on #584).
  const listTimelines = useLocationTimelines(listDays, isList ? [state.date, ...(listTodayKey ? [listTodayKey] : [])] : NO_DAY_KEYS,
    data, listRefreshToken, `${listOwner}|${toTimelineDateKey(ranges.week.start)}`, isList);
  // Location v4 steps 16–17: the Grid's days' places and trips, for trip leg strips and the Places lane.
  const gridDayKeys = isList ? NO_DAY_KEYS
    : (state.scope === "day" ? [ranges.day.start] : ranges.weekDays).map((day) => toTimelineDateKey(day));
  const gridTimelines = useLocationTimelines(gridDayKeys, gridDayKeys, data, listRefreshToken,
    `${listOwner}|grid|${toTimelineDateKey(ranges.week.start)}`, !isList);
  const todayStartMs = useLocalDayStartMs();
  // The Grid's "?" (blocks, Places lane, dialogs) as the List shows them, from the one decisions owner: an answer
  // held, saving or saved in the List is not answerable here too (Codex r5 on #609).
  const gridReviewItems = useProjectedReviewItems(data.reviewItems);
  // Owner item A: a Grid item opens its dialog, its "?" asked at the top (fenced to its owner and item).
  const gridClock = useClockFormat();
  // A block's "?" on the Grid goes through the shared owner: held for Undo, hidden everywhere, sent once (Codex r1 on #618).
  const sharedDecisions = useSharedCheckDecisions();
  const sharedAnswer = sharedDecisions?.answer;
  const gridCorrection = useGridCorrection({ activities: data.categories, clock: gridClock, owner: listOwner, places: correctionPlaces,
    refresh: refreshData, reviewItems: gridReviewItems, timelines: gridTimelines, todayStartMs });
  const fallbackGridAnswer = gridCorrection.answerBlock;
  const answerGridBlock = useCallback((item: ReviewItemRow, yes: boolean, label: string) => {
    if (sharedAnswer) {
      sharedAnswer(item.id, yes ? "log" : "skip", label);
      return;
    }
    return fallbackGridAnswer(item, yes);
  }, [fallbackGridAnswer, sharedAnswer]);
  const dayEntries = clipTimelineEntries(mergeTimelineEntries(
    data.dayEntries,
    data.entries,
    data.activeEntry ? [data.activeEntry] : []
  ), ranges.day, capturedNow);
  const weekEntries = clipTimelineEntries(mergeTimelineEntries(
    data.weekEntries,
    data.entries,
    data.activeEntry ? [data.activeEntry] : []
  ), ranges.week, capturedNow);
  const timelineEntryIds = new Set([...dayEntries, ...weekEntries, ...listWeeks.entries].map((entry) => entry.id));
  const {
    error: deleteError,
    hiddenEntryIds,
    pendingNotice,
    requestDelete,
    failedDelete,
    dismissDeleteError,
    undoPendingDelete
  } = useTimelineDeleteUndo({ entryIds: timelineEntryIds, onSynced: refreshList });
  const [deletedEntrySwatch, setDeletedEntrySwatch] = useState<CSSProperties | undefined>(undefined);
  // One automatic Move deleted: offer "Don't log trips like this" (PRD D19, A4).
  const [deletedMoveEventId, setDeletedMoveEventId] = useState<string | null>(null);
  const tripOptOut = useTripOptOut(deletedMoveEventId, pendingNotice?.token);
  // A delete's toast holds the bottom place: a "?" answer's Undo then sits above it (Codex r2 on #618).
  const toastStackedAbove = pendingNotice ? tripOptOut ? "above-tall" as const : "above" as const : deleteError ? "above" as const : null;
  const requestTimelineDelete = useCallback((entries: readonly TimeEntryRow[]) => {
    const first = entries[0];
    setDeletedEntrySwatch(first?.categoryId ? activityBlockStyle(first.categoryColor, first.categoryName ?? "") : undefined);
    setDeletedMoveEventId(entries.length === 1 ? first?.automaticMoveEventId ?? null : null);
    requestDelete({ entries, label: timelineDeleteNoticeLabel(entries) });
  }, [requestDelete]);
  const visibleDayEntries = dayEntries.filter((entry) => !hiddenEntryIds.has(entry.id));
  const visibleWeekEntries = weekEntries.filter((entry) => !hiddenEntryIds.has(entry.id));
  const activeEntries = state.scope === "day" ? visibleDayEntries : visibleWeekEntries;
  // The shell's data last, so the selected week (and any block it knows newer) wins over a loaded copy.
  const listEntries = isList
    ? clipTimelineEntries(mergeTimelineEntries(
      listWeeks.entries,
      data.weekEntries,
      data.dayEntries,
      data.entries,
      data.activeEntry ? [data.activeEntry] : []
    ), listRange, capturedNow).filter((entry) => !hiddenEntryIds.has(entry.id))
    : [];
  const weekAnalysis = analyzeTimeIntervals(
    visibleWeekEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    { range: ranges.week, now: capturedNow }
  );
  // Which day is today depends on the browser's time zone. The server render and the hydration
  // pass use the server's guess for the viewer's zone (null: none), then the browser's clock.
  const todayKey = hydrated ? toTimelineDateKey(capturedNow) : initialTodayKey;
  const periodLabel = formatTimelinePeriodLabel(state.scope, ranges, todayKey);
  const showsToday = todayKey === null
    || (todayKey >= toTimelineDateKey(ranges.active.start) && todayKey < toTimelineDateKey(ranges.active.end));
  const weekReportFrom = toTimelineDateKey(ranges.week.start);
  const weekReportTo = toTimelineDateKey(addDays(ranges.week.end, -1));

  const headModel = calendarHeadModel({
    entries: visibleWeekEntries,
    hydrated,
    nowMs: capturedNow.getTime(),
    selectedDay: ranges.day.start,
    todayKeyHint: initialTodayKey,
    weekDays: ranges.weekDays,
    weekLoggedSeconds: weekAnalysis.totalLoggedSeconds
  });

  return (
    <section className="timeline-workspace">
      {/* #259 (owner, 27 Oct 2026): one compact row — ‹ date › Today, the week strip with its day and
          week totals, Day | Week and Calendar | List — wrapping only where the screen is too narrow.
          The month stays the page's heading for assistive tech; the period label shows the date. */}
      <h1 className="sr-only">{headModel.month}</h1>
      <section
        className="timeline-range-toolbar df-cal-toolbar"
        aria-busy={isDateLoading}
        aria-label="Calendar period and view controls"
      >
        {/* In List the period controls don't apply (continuous days): shown, greyed and inert. */}
        <div aria-disabled={isList || undefined} className="timeline-range-navigation" data-unused-in-list={isList || undefined}>
          {isList ? <span className="sr-only" id="timeline-period-not-used">Not used in List</span> : null}
          <IconButton
            aria-describedby={isList ? "timeline-period-not-used" : undefined}
            aria-disabled={isList || undefined}
            disabled={isDateLoading}
            label={isList ? `Previous ${state.scope}: not used in List` : `Previous ${state.scope}`}
            onClick={() => {
              if (!isList) void navigate(shiftTimelineState(state, "previous"));
            }}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <DatePickerPopover
            disabled={isDateLoading}
            label={periodLabel}
            unavailable={isList ? "Not used in List" : undefined}
            onChange={(date) => void navigate({ date })}
            portal
            portalAlign="center"
            today={todayKey ?? state.date}
            value={state.date}
          />
          <IconButton
            aria-describedby={isList ? "timeline-period-not-used" : undefined}
            aria-disabled={isList || undefined}
            disabled={isDateLoading}
            label={isList ? `Next ${state.scope}: not used in List` : `Next ${state.scope}`}
            onClick={() => {
              if (!isList) void navigate(shiftTimelineState(state, "next"));
            }}
          >
            <ChevronRight size={18} />
          </IconButton>
          {/* List has its own way back to today (it scrolls there), so only the grid shows this one. */}
          {showsToday || isList ? null : (
            <button
              className="timeline-today-button"
              disabled={isDateLoading}
              onClick={() => {
                if (todayKey) void navigate({ date: todayKey });
              }}
              type="button"
            >
              Today
            </button>
          )}
        </div>

        <CalendarHead
          disabled={isDateLoading}
          model={headModel}
          onSelectDay={(date) => void navigate({ date })}
          weekReportHref={reportsHrefForCustomRange(weekReportFrom, weekReportTo)}
        />

        <div className="timeline-range-controls">
          <SegmentedControl
            ariaLabel={isList ? "Calendar scope, not used in List" : "Calendar scope"}
            className={isList ? "is-unused-in-list" : undefined}
            onChange={(scope) => {
              if (!isList) updateScope(scope);
            }}
            options={scopeItems.map((item) => ({
              value: item.id,
              label: item.label,
              disabled: isDateLoading,
              unavailable: isList ? "Not used in List" : undefined
            }))}
            value={state.scope}
          />
          {/* Card C item 5 (owner, 25 Oct 2026): a visible Calendar | List switch like Day | Week; the
              round view-icon menu is the iPhone's only. */}
          <SegmentedControl
            ariaLabel="Calendar view"
            onChange={updateView}
            options={viewItems.map((item) => ({ value: item.id, label: item.label, disabled: isDateLoading }))}
            value={state.view}
          />
        </div>
      </section>
      {dateLoadError || isDateLoading ? (
        <p
          aria-atomic="true"
          aria-live={dateLoadError ? "assertive" : "polite"}
          className={`timeline-range-feedback${dateLoadError ? " is-error" : ""}`}
          role={dateLoadError ? "alert" : "status"}
        >
          {dateLoadError ?? "Loading period…"}
        </p>
      ) : null}

      <div className="timeline-view-stage">
        {state.view === "calendar" ? (
          <CalendarReview
            calendarHoursMode={calendarHoursMode}
            capturedNow={capturedNow}
            categories={data.categories}
            entries={activeEntries}
            onDeleteEntries={requestTimelineDelete}
            onScroll={(event) => rememberScrollPosition("calendar", event)}
            hasRememberedScroll={hasRememberedCalendarScroll}
            onSynced={refreshData}
            answerBlockCheck={answerGridBlock}
            reviewItems={gridReviewItems}
            scrollContainerRef={registerScrollContainer}
            tags={data.tags}
            todayKeyHint={initialTodayKey}
            // Any toast of this view (Undo, a refused delete) outranks the Calendar's own.
            undoToastVisible={Boolean(pendingNotice) || Boolean(deleteError)}
            visibleDays={state.scope === "day" ? [ranges.day.start] : ranges.weekDays}
            locations={{ timelines: gridTimelines, asking: gridCorrection.askingBySegment ?? NO_ASKING, onOpen: gridCorrection.open }}
          />
        ) : null}
        {gridCorrection.dialog}
        {/* A block's "?" answered on the Grid is held for Undo by the shared owner (Codex r1 on #618), as in the List. */}
        {state.view === "calendar" && sharedDecisions?.state.error ? (
          <ErrorBanner message={sharedDecisions.state.error} onDismiss={sharedDecisions.clearError} />
        ) : null}
        {state.view === "calendar" && sharedDecisions?.state.notice ? (
          // A delete's Undo pending too: this one sits above it, so both stay reachable (Codex r2 on #618).
          <BlocksToast actionLabel="Undo" exiting={sharedDecisions.state.notice.isExiting} key={sharedDecisions.state.notice.token}
            message={sharedDecisions.state.notice.label} onAction={sharedDecisions.undo} stacked={toastStackedAbove}
            swatchStyle={sharedDecisions.state.notice.color ? activityBlockStyle(sharedDecisions.state.notice.color, sharedDecisions.state.notice.colorName) : undefined} />
        ) : null}
        {state.view === "list" ? (
          <EntriesTable
            capturedNow={capturedNow}
            entries={listEntries}
            categories={data.categories}
            continuous={{
              error: listWeeks.error,
              focusDayStartMs: ranges.day.start.getTime(),
              focusRequest: state.date,
              loading: listWeeks.loading,
              onLoad: listWeeks.load,
              reachedEarliest: listWeeks.reachedEarliest,
              reachedLatest: listWeeks.reachedLatest
            }}
            displayRange={listRange}
            onDeleteEntries={requestTimelineDelete}
            groupByDay
            // In read order (oldest read first): a trip read on two days shows its freshest copy.
            locationTimelines={[...listTimelines.values()].filter((timeline) => listDays.includes(timeline.date))}
            places={correctionPlaces}
            reviewItems={data.reviewItems}
            checksDays={listDays.map(timelineDayRange)}
            onChanged={refreshList}
            noticeStackedAbove={toastStackedAbove}
            onScroll={(event) => rememberScrollPosition("list", event)}
            scrollContainerRef={registerScrollContainer}
            tags={data.tags}
          />
        ) : null}
      </div>
      {pendingNotice ? (
        <BlocksToast
          actionLabel="Undo"
          autoFocusAction
          exiting={pendingNotice.isExiting}
          key={pendingNotice.token}
          message={pendingNotice.label}
          onAction={undoPendingDelete}
          secondary={tripOptOut}
          swatchStyle={deletedEntrySwatch}
        />
      ) : deleteError ? (
        // A refused delete is the toast's error variant (WUI-027). Try again goes through this
        // view's own delete, so the swatch and the trip opt-out are the retried blocks' own (Codex
        // r1 on #491); it is offered only while some of those blocks are still there.
        <BlocksToast
          actionLabel={failedDelete ? "Try again" : "Dismiss"}
          focusActionIfLost
          message={deleteError}
          onAction={failedDelete ? () => requestTimelineDelete(failedDelete.entries) : () => {
            dismissDeleteError();
            focusTimelineAfterToast();
          }}
          secondary={failedDelete ? { label: "Dismiss", onAction: () => {
            dismissDeleteError();
            focusTimelineAfterToast();
          } } : null}
          tone="error"
        />
      ) : null}
    </section>
  );
}


/** After a toast's last action, a lost focus lands on the Calendar grid, or the chosen view. */
function focusTimelineAfterToast() {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = document.querySelector<HTMLElement>(".calendar-grid-scroller")
      ?? document.querySelector<HTMLElement>('.timeline-range-controls button[aria-pressed="true"]');
    target?.focus({ preventScroll: true });
  });
}

function timelineDeleteNoticeLabel(entries: readonly TimeEntryRow[]) {
  return deletedToastLabel(entries.length, entries[0] ? timeEntryTitle(entries[0]) : null);
}

type TimelineScrollPosition = { left: number; top: number };

export function CalendarReview({
  calendarHoursMode,
  capturedNow,
  answerBlockCheck,
  categories,
  entries: givenEntries,
  hasRememberedScroll,
  onDeleteEntries,
  onScroll,
  onSynced,
  reviewItems = [],
  scrollContainerRef,
  tags,
  todayKeyHint = null,
  undoToastVisible = false,
  visibleDays,
  locations
}: {
  /**
   * A block's "?" (a block that ran into a trip, location v4 design §7) answered from its editor: through the shared
   * decisions owner, held for Undo (void); without one, saved at once (null once saved, else why not).
   */
  answerBlockCheck?: (item: ReviewItemRow, yes: boolean, label: string) => void | Promise<string | null>;
  calendarHoursMode: CalendarHoursMode;
  capturedNow: Date;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  /** True once the user has a calendar position to return to; the opening position then defers to it. */
  hasRememberedScroll?: () => boolean;
  onDeleteEntries: (entries: readonly TimeEntryRow[]) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onSynced: () => Promise<void>;
  places?: PlaceRow[];
  /** Open Review items; suggestions with a full window show as hatched blocks in the grid, in its columns. */
  reviewItems?: readonly ReviewItemRow[];
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  tags: BootstrapData["tags"];
  /** Before hydration, today's date key as the server saw it in the viewer's zone (null: none). */
  todayKeyHint?: string | null;
  /** The Timeline's Delete Undo toast is up: it keeps the toast place, so Calendar notices are only announced. */
  undoToastVisible?: boolean;
  visibleDays: Date[];
  /** Location v4 steps 16–17: each shown day's places and trips, and the "?" still asking by segment. */
  locations?: { timelines: ReadonlyMap<string, LocationTimeline>; asking: ReadonlyMap<string, string>;
    /** Owner item A: a Grid item (a lane item, or a "?") opens its own dialog. */
    onOpen: (item: TimelinePlace | TimelineTrip, timeline: LocationTimeline, checkId: string | null) => void };
}) {
  // Step 16: every shown day's trips by the blocks made from them, for the leg strip.
  const tripsByBlock = useMemo(() => new Map([...(locations?.timelines.values() ?? [])].flatMap((timeline) => [...tripsByBlockId(timeline)])),
    [locations]);
  // End it held, saving or saved in the List: the block shows ended at its trip's start here too (design §7).
  const endedBlocks = useEndedBlocks();
  const entries = useMemo(() => endedBlocks.size ? givenEntries.map((entry) => {
    const endsAt = endedBlocks.get(entry.id);
    return endsAt && (entry.stoppedAt === null || Date.parse(entry.stoppedAt) > Date.parse(endsAt)) ? { ...entry, stoppedAt: endsAt } : entry;
  }) : givenEntries, [endedBlocks, givenEntries]);
  const clock = useClockFormat();
  const router = useRouter();
  const {
    clearTimerError,
    createCategory,
    createManualEntry,
    isTimerBusy,
    shellData,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();
  const [, startTransition] = useTransition();
  const [selectedTarget, setSelectedTarget] = useState<CalendarEditorTarget | null>(null);
  const selectedTargetRef = useRef<CalendarEditorTarget | null>(null);
  const selectionSessionRef = useRef(0);
  const createPointerSequenceRef = useRef<CalendarCreatePointerSequence | null>(null);
  const consumedPointerRef = useRef<CalendarConsumedPointer | null>(null);
  // The last press anywhere, seen in the window's capture phase: before an open editor's own
  // document listener, which may stop the event from reaching the suggestion link.
  // Whether that press was taken is read at its pointerup, again in the window's capture phase,
  // before the document listener above forgets the consumed pointer; the click comes after both.
  const reviewLinkPointerRef = useRef<{ pointerId: number; pointerDownTimeStamp: number } | null>(null);
  const pressConsumedByEditorRef = useRef(false);
  useEffect(() => {
    const remember = (event: PointerEvent) => {
      reviewLinkPointerRef.current = { pointerId: event.pointerId, pointerDownTimeStamp: event.timeStamp };
      pressConsumedByEditorRef.current = false;
    };
    const settle = (event: PointerEvent) => {
      const pointer = reviewLinkPointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      pressConsumedByEditorRef.current = calendarPointerMatchesConsumed(consumedPointerRef.current, pointer);
    };
    window.addEventListener("pointerdown", remember, true);
    window.addEventListener("pointerup", settle, true);
    return () => {
      window.removeEventListener("pointerdown", remember, true);
      window.removeEventListener("pointerup", settle, true);
    };
  }, []);
  const [resizeDraft, setResizeDraft] = useState<CalendarResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [resizeTip, setResizeTip] = useState<{ flip: boolean; label: string; x: number; y: number } | null>(null);
  // Drag on empty time: the day body owns the pointer (capture) from press to release.
  // `nowMs`: the displayed now the range was clamped against; `heldAtLimit`: it ends at that now.
  const [createGhost, setCreateGhost] = useState<{
    dayKey: string;
    endMinutes: number;
    heldAtLimit: boolean;
    nowMs: number;
    startMinutes: number;
  } | null>(null);
  // Decided once at pointerdown against the layout at that moment: whether the press may become a
  // drag (it is outside every block's semantic time) and the 5-minute anchor it pressed on.
  // `future`: the press is at or after now, where no block can start — no ghost, a not-allowed
  // cursor, and a notice on release.
  const createPressRef = useRef<{
    anchorMinutes: number;
    dragAllowed: boolean;
    future: boolean;
    pointerId: number;
  } | null>(null);
  const [futurePressDayKey, setFuturePressDayKey] = useState<string | null>(null);
  // "Blocks can't start in the future": one notice at a time, keyed by a rising token so a
  // replacing notice re-mounts and a stale timer never hides a newer one. While the Timeline's
  // Delete Undo toast is up it keeps the place and this notice is only announced.
  const [createNotice, setCreateNotice] = useState<{ announcedOnly: boolean; exiting: boolean; token: number } | null>(null);
  const createNoticeSequenceRef = useRef(0);
  useEffect(() => {
    if (!createNotice || createNotice.exiting) return;
    const token = createNotice.token;
    const timer = window.setTimeout(() => {
      setCreateNotice((current) => (current?.token === token ? { ...current, exiting: true } : current));
    }, CALENDAR_CREATE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [createNotice]);
  useEffect(() => {
    if (!createNotice?.exiting) return;
    const token = createNotice.token;
    const timer = window.setTimeout(() => {
      setCreateNotice((current) => (current?.token === token ? null : current));
    }, CALENDAR_CREATE_NOTICE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [createNotice]);
  // A delete's Undo toast replaces a visible notice (one toast at a time), so the notice never
  // pops back in when the Undo toast leaves. Adjusted during render, as React recommends.
  const [undoToastSeen, setUndoToastSeen] = useState(undoToastVisible);
  if (undoToastSeen !== undoToastVisible) {
    setUndoToastSeen(undoToastVisible);
    if (undoToastVisible && createNotice && !createNotice.announcedOnly) setCreateNotice(null);
  }
  function showFutureCreateNotice() {
    setCreateNotice({ announcedOnly: undoToastVisible, exiting: false, token: ++createNoticeSequenceRef.current });
  }
  const createDragRef = useRef<{
    anchorMinutes: number;
    dayKey: string;
    endMinutes: number;
    nowMs: number;
    pointerId: number;
    startMinutes: number;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<CalendarZoom>("hour");
  const [calendarScroller, setCalendarScroller] = useState<HTMLDivElement | null>(null);
  // Where a block sits, the now line and pill, the Review spans and each day's total all depend on
  // the browser's time zone, which the server render can't know (Vercel renders in UTC). The server
  // render and the hydration pass draw the same frame (the axis, day headings and an empty grid);
  // the blocks appear once the page has hydrated, without motion (React #418, Codex r1 on #303).
  const localTimeReady = useIsHydrated();
  const todayKey = localTimeReady ? formatCalendarDateKey(capturedNow) : todayKeyHint;
  const isToday = (day: Date) => formatCalendarDateKey(day) === todayKey;
  const gridEntries = localTimeReady ? entries : NO_TIMELINE_ENTRIES;
  // Only the "?" that still ask (today and the 6 days before), an outing once on its stay: the badge's and the
  // List's own list, so an expired or folded one is never an amber block here (Codex r1 on #609).
  const askingTodayStartMs = useLocalDayStartMs();
  const gridReviewItems = useMemo(() => {
    if (!localTimeReady || askingTodayStartMs === null) return NO_REVIEW_ITEMS;
    const ids = new Set(askingChecks(reviewItems, askingTodayStartMs).map((check) => check.id));
    return reviewItems.filter((item) => ids.has(item.id));
  }, [askingTodayStartMs, localTimeReady, reviewItems]);
  // A block that ran into a trip asks on its block (design §7), while its block as drawn still runs into the trip.
  const askingByBlock = useMemo(() => {
    const blocks = clashBlocksFrom(entries, categories);
    const nowMs = capturedNow.getTime();
    return new Map(gridReviewItems.flatMap((item) => {
      const blockId = checkBlockId(item);
      return blockId && clashStillAsks(item, blocks, nowMs, "asks") ? [[blockId, item] as const] : [];
    }));
  }, [capturedNow, categories, entries, gridReviewItems]);
  // Named patterns (location v3 PR 14b): a bracket beside each complete trip that lies wholly inside
  // one shown day (none across midnight), and each part's place in it for its block's name. Drawn
  // from the stored blocks, so a resize draft moves its block but not the bracket until it is saved.
  const calendarBrackets = useMemo(() => {
    const byDay = new Map<string, NamedPatternBracket[]>();
    const parts = new Map<string, string>();
    const members = new Map(gridEntries.map((entry) => [entry.id, entry]));
    // The trips are found once for the shown period (Codex r1 on #511), then given to their days.
    const trips = namedPatternBrackets(gridEntries);
    for (const day of visibleDays) {
      const dayStart = startOfDay(day);
      const brackets = bracketsWithin(trips, { startMs: dayStart.getTime(), endMs: addDays(dayStart, 1).getTime() });
      byDay.set(formatCalendarDateKey(day), brackets);
      for (const bracket of brackets) {
        bracket.memberIds.forEach((id, index) => parts.set(id, `Part ${index + 1} of ${bracket.memberIds.length} of ${bracket.name}.`));
      }
    }
    return { byDay, members, parts };
  }, [gridEntries, visibleDays]);
  // Calendar v3: the hybrid overlap indents nested blocks 14 px, so it lays out in px across the day
  // column as measured (every shown day's column is as wide as the first). Before it is measured the
  // blocks keep the side-by-side columns.
  const [dayBodyWidth, setDayBodyWidth] = useState(0);
  // The shown days' bodies are keyed by date, so a new period mounts new ones: observe the current first
  // body again whenever the days change, and ignore a detached body's zero width (Codex r2 on #583).
  const observedDaysKey = visibleDays.map(formatCalendarDateKey).join("|");
  useEffect(() => {
    const body = calendarScroller?.querySelector<HTMLElement>("[data-calendar-day-body]");
    if (!body || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!body.isConnected || body.clientWidth <= 0) return;
      setDayBodyWidth(Math.round(body.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [calendarScroller, observedDaysKey]);
  const zoom = calendarZooms[zoomLevel];
  const calendarHours = calendarHourModes[calendarHoursMode];
  const zoomKeys = Object.keys(calendarZooms) as CalendarZoom[];
  const zoomIndex = zoomKeys.indexOf(zoomLevel);
  const rowHeight = zoom.pixelsPerHour;
  const gridLineSpacing = (zoom.intervalMinutes / 60) * rowHeight;
  const calendarHeight = (calendarHours.endHour - calendarHours.startHour) * rowHeight;
  const axisMarks = useMemo(() => {
    const startMinutes = calendarHours.startHour * 60;
    const totalMinutes = (calendarHours.endHour - calendarHours.startHour) * 60;
    const markCount = Math.floor(totalMinutes / zoom.intervalMinutes);
    return Array.from({ length: markCount + 1 }, (_, index) => {
      const minutes = startMinutes + index * zoom.intervalMinutes;
      const top = ((minutes - startMinutes) / 60) * rowHeight;
      return {
        key: `${minutes}`,
        label: formatCalendarAxisMinutes(minutes, clock),
        labelTop: clampAxisLabelTop(top, calendarHeight),
        major: minutes % 60 === 0,
        top
      };
    });
  }, [calendarHeight, calendarHours.endHour, calendarHours.startHour, clock, rowHeight, zoom.intervalMinutes]);
  const visibleDaysKey = visibleDays.map(formatCalendarDateKey).join("|");
  const selectionScopeKey = `${calendarHoursMode}:${visibleDaysKey}`;
  const visibleSelectedTarget = selectedTarget?.scopeKey === selectionScopeKey ? selectedTarget : null;
  const selectedEntry = visibleSelectedTarget?.kind === "entry"
    ? entries.find((entry) => entry.id === visibleSelectedTarget.entryId) ?? null
    : null;
  const calendarScrollerRef = useRef<HTMLDivElement | null>(null);
  const registerCalendarScroller = useCallback((element: HTMLDivElement | null) => {
    calendarScrollerRef.current = element;
    setCalendarScroller(element);
    scrollContainerRef(element);
  }, [scrollContainerRef]);

  // Open near now (or the first entry) once per mount unless TimeReviewViews has a position to restore.
  const initialScrollAppliedRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = calendarScrollerRef.current;
    // The opening position is a local hour, so it waits for the browser's clock (hydration).
    if (!localTimeReady || !calendarScroller || !scroller || initialScrollAppliedRef.current) return;
    initialScrollAppliedRef.current = true;
    if (hasRememberedScroll?.()) return;
    const hour = calendarInitialScrollHour({ entries, now: capturedNow, visibleDays });
    scroller.scrollTop = Math.max(0, (hour - calendarHours.startHour) * rowHeight);
  }, [calendarHours.startHour, calendarScroller, capturedNow, entries, hasRememberedScroll, localTimeReady, rowHeight, visibleDays]);

  useEffect(() => {
    const clearConsumedPointer = (event: PointerEvent) => {
      if (consumedPointerRef.current?.pointerId === event.pointerId) {
        consumedPointerRef.current = null;
      }
    };
    document.addEventListener("pointerup", clearConsumedPointer);
    document.addEventListener("pointercancel", clearConsumedPointer);
    return () => {
      document.removeEventListener("pointerup", clearConsumedPointer);
      document.removeEventListener("pointercancel", clearConsumedPointer);
    };
  }, []);

  function selectCalendarEntry(target: Omit<CalendarEntryEditorTarget, "kind" | "scopeKey" | "sessionId">) {
    const current = selectedTargetRef.current;
    if (
      current?.kind === "entry" &&
      current.scopeKey === selectionScopeKey &&
      current.entryId === target.entryId &&
      current.blockKey === target.blockKey
    ) return;
    const nextTarget: CalendarEntryEditorTarget = {
      ...target,
      kind: "entry",
      scopeKey: selectionScopeKey,
      sessionId: ++selectionSessionRef.current
    };
    selectedTargetRef.current = nextTarget;
    setActionError(null);
    setSelectedTarget(nextTarget);
  }

  function clearCalendarSelection() {
    createPointerSequenceRef.current = null;
    selectedTargetRef.current = null;
    setSelectedTarget(null);
  }

  function createCalendarDraft(day: Date, slot: { startedAt: string; stoppedAt: string }) {
    const nextTarget: CalendarCreateEditorTarget = {
      anchor: null,
      dayKey: formatCalendarDateKey(day),
      draftStartedAt: slot.startedAt,
      draftStoppedAt: slot.stoppedAt,
      kind: "create",
      scopeKey: selectionScopeKey,
      sessionId: ++selectionSessionRef.current,
      startedAt: slot.startedAt,
      stoppedAt: slot.stoppedAt
    };
    selectedTargetRef.current = nextTarget;
    setActionError(null);
    setSelectedTarget(nextTarget);
  }

  const registerCalendarDraftAnchor = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const sessionId = Number(element.dataset.calendarDraftSession);
    const current = selectedTargetRef.current;
    if (current?.kind !== "create" || current.sessionId !== sessionId || current.anchor === element) return;
    const nextTarget = { ...current, anchor: element };
    selectedTargetRef.current = nextTarget;
    setSelectedTarget(nextTarget);
  }, []);

  // An error replaces a visible notice for good (it is not shown again after Dismiss).
  function showActionError(message: string) {
    setCreateNotice(null);
    setActionError(message);
  }

  async function continueCalendarEntry(entry: TimeEntryRow, surface: "editor" | "inline" = "editor") {
    if (continuingEntryId || isTimerBusy || !entry.stoppedAt) {
      const outcome = { ok: false, error: "A block update is already in progress." } as const;
      if (surface === "inline") showActionError(outcome.error);
      return outcome;
    }
    setContinuingEntryId(entry.id);
    if (surface === "inline") setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) {
        clearTimerError();
        if (surface === "inline") showActionError(outcome.error);
      }
      return outcome;
    } finally {
      setContinuingEntryId(null);
    }
  }

  function deleteCalendarEntry(entry: TimeEntryRow) {
    clearCalendarSelection();
    setActionError(null);
    onDeleteEntries([entry]);
  }

  function dismissCalendarEditor(target: CalendarEditorTarget, restoreFocus: boolean) {
    if (selectedTargetRef.current?.sessionId !== target.sessionId) return;
    clearCalendarSelection();
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        if (target.kind === "entry") {
          // A moment is its own button; a block's is inside it.
          const button = target.anchor.matches(".calendar-moment")
            ? target.anchor
            : target.anchor.querySelector<HTMLButtonElement>(".calendar-entry-primary");
          button?.focus({ preventScroll: true });
          return;
        }
        calendarScroller?.focus({ preventScroll: true });
      });
    }
  }

  function consumeCalendarEditorPointer(
    target: CalendarEditorTarget,
    pointer: { pointerId: number; pointerDownTimeStamp: number }
  ) {
    consumedPointerRef.current = {
      ...pointer,
      sessionId: target.sessionId
    };
  }

  function updateCalendarCreateDraft(
    target: CalendarCreateEditorTarget,
    plan: CalendarEntryCompactCreatePlan | null
  ) {
    if (!plan) return;
    const current = selectedTargetRef.current;
    if (
      current?.kind !== "create" ||
      current.sessionId !== target.sessionId ||
      (current.draftStartedAt === plan.resolved.startedAt && current.draftStoppedAt === plan.resolved.stoppedAt)
    ) {
      return;
    }
    const nextTarget = {
      ...current,
      draftStartedAt: plan.resolved.startedAt,
      draftStoppedAt: plan.resolved.stoppedAt
    };
    selectedTargetRef.current = nextTarget;
    setSelectedTarget(nextTarget);
  }

  async function saveCalendarCreate(plan: CalendarEntryCompactCreatePlan) {
    return createManualEntry(plan.input);
  }

  /** Card G: a split or duplicate written through the entry endpoints, then the Calendar refreshed. */
  async function changeCalendarBlocks(change: () => Promise<BlockMutationOutcome>) {
    try {
      const outcome = await change();
      // A failure that may have changed the day (changed elsewhere, or unknown) shows it again too.
      if (outcome.ok || outcome.changed) {
        await onSynced();
        startTransition(() => router.refresh());
      }
      return outcome;
    } catch {
      return { ok: false, error: "Unable to change this block. Check your connection and try again." } as const;
    }
  }

  async function saveCalendarEditor(
    entry: TimeEntryRow,
    plan: CalendarEntryCompactSavePlan
  ) {
    if (!entry.stoppedAt) {
      return updateActiveEntryFromCalendar({ plan });
    }
    try {
      const response = await clientFetch(`/api/time-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.payload)
      });
      if (!response.ok) {
        let message = `Unable to save this block: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error ?? message;
        } catch {
          // Preserve the status fallback when the response is not JSON.
        }
        return { ok: false, error: message } as const;
      }
      await onSynced();
      startTransition(() => router.refresh());
      return { ok: true } as const;
    } catch {
      return { ok: false, error: "Unable to save this block. Check your connection and try again." } as const;
    }
  }

  async function saveCalendarResize(entry: TimeEntryRow, draft: CalendarResizeDraft) {
    const response = await clientFetch(`/api/time-entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Only the times: the PATCH applies every field present, and this tab's copy of the activity,
      // place and description can predate an edit made on another device (stability audit WEB-UI-1).
      body: JSON.stringify({
        startedAt: draft.startedAt,
        stoppedAt: draft.stoppedAt
      })
    });

    if (!response.ok) throw new Error(`Unable to resize the block: ${response.status}`);
    await onSynced();
    startTransition(() => router.refresh());
  }

  function startCalendarResize(
    entry: TimeEntryRow,
    day: Date,
    edge: CalendarResizeEdge,
    event: ReactPointerEvent<HTMLElement>
  ) {
    if (!entry.stoppedAt) return;
    const dayColumn = event.currentTarget.closest("[data-calendar-day-body]") as HTMLElement | null;
    if (!dayColumn) return;

    event.preventDefault();
    event.stopPropagation();

    const columnRect = dayColumn.getBoundingClientRect();
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const timelineStart = calendarHours.startHour * 60;
    const timelineEnd = calendarHours.endHour * 60;
    const entryStart = new Date(entry.startedAt);
    const entryEnd = new Date(entry.stoppedAt);
    const originalStart = entryStart < dayStart ? timelineStart : minutesFromDate(entryStart);
    const originalEnd = entryEnd > dayEnd ? timelineEnd : minutesFromDate(entryEnd);
    const startClientY = event.clientY;
    let finalDraft: CalendarResizeDraft | null = null;
    let hasStartedResize = false;

    const handle = event.currentTarget;
    const resizePointerId = event.pointerId;
    handle.setPointerCapture(resizePointerId);

    const updateDraft = (clientY: number) => {
      const relativeY = clientY - columnRect.top;
      const rawMinutes = timelineStart + (relativeY / rowHeight) * 60;
      const snappedMinutes = clampMinutes(snapCalendarMinutes(rawMinutes), timelineStart, timelineEnd);
      const nextStartMinutes =
        edge === "start" ? clampMinutes(snappedMinutes, timelineStart, originalEnd - calendarSnapMinutes) : originalStart;
      const nextEndMinutes =
        edge === "end" ? clampMinutes(snappedMinutes, originalStart + calendarSnapMinutes, timelineEnd) : originalEnd;
      finalDraft = {
        entryId: entry.id,
        startedAt: edge === "start" ? isoForDateMinutes(day, nextStartMinutes) : entry.startedAt,
        stoppedAt: edge === "end" ? isoForDateMinutes(day, nextEndMinutes) : entry.stoppedAt as string
      };
      setResizeDraft(finalDraft);
      const edgeMinutes = edge === "start" ? nextStartMinutes : nextEndMinutes;
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(finalDraft.stoppedAt).getTime() - new Date(finalDraft.startedAt).getTime()) / 1_000)
      );
      setResizeTip({
        label: `${formatCalendarAxisMinutes(edgeMinutes, clock, true)} · ${formatDuration(durationSeconds)}`,
        // Near the right edge (a phone, a narrow window) the tip flips to the pointer's left.
        flip: lastClientX + 14 + RESIZE_TIP_ROOM > window.innerWidth,
        x: lastClientX + 14 + RESIZE_TIP_ROOM > window.innerWidth ? lastClientX - 14 : lastClientX + 14,
        y: clientY + 10
      });
    };
    let lastClientX = event.clientX;

    const beginResize = () => {
      if (hasStartedResize) return;
      hasStartedResize = true;
      clearCalendarSelection();
      setResizingId(entry.id);
      setResizeError(null);
    };

    const moveResize = (moveEvent: PointerEvent) => {
      if (!hasStartedResize) {
        if (Math.abs(moveEvent.clientY - startClientY) < resizeDragThresholdPx) return;
        beginResize();
      }
      lastClientX = moveEvent.clientX;
      updateDraft(moveEvent.clientY);
    };
    const cancelResize = () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      window.removeEventListener("keydown", escapeResize, true);
      handle.removeEventListener("lostpointercapture", lostResize);
      if (handle.hasPointerCapture?.(resizePointerId)) handle.releasePointerCapture(resizePointerId);
      setResizingId(null);
      setResizeDraft(null);
      setResizeTip(null);
    };
    const lostResize = (lostEvent: PointerEvent) => {
      if (lostEvent.pointerId === resizePointerId) cancelResize();
    };
    const escapeResize = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cancelResize();
    };
    const stopResize = async () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      window.removeEventListener("keydown", escapeResize, true);
      handle.removeEventListener("lostpointercapture", lostResize);
      setResizingId(null);
      setResizeTip(null);

      if (!hasStartedResize || !finalDraft) {
        setResizeDraft(null);
        return;
      }

      try {
        await saveCalendarResize(entry, finalDraft);
      } catch {
        setResizeError("Unable to save the resized time block.");
      } finally {
        setResizeDraft(null);
      }
    };

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", cancelResize, { once: true });
    window.addEventListener("keydown", escapeResize, true);
    handle.addEventListener("lostpointercapture", lostResize);
  }

  function startCalendarCreatePointer(
    day: Date,
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    const dayBody = event.currentTarget;
    const pointer = { pointerId: event.pointerId, pointerDownTimeStamp: event.timeStamp };
    const consumed = calendarPointerMatchesConsumed(consumedPointerRef.current, pointer);
    const targetKind = calendarCreateTargetKind(event.target, dayBody);
    if (!isEligibleCalendarCreatePointer({
      button: event.button,
      consumed,
      ctrlKey: event.ctrlKey,
      defaultPrevented: event.defaultPrevented,
      isPrimary: event.isPrimary,
      pointerType: event.pointerType,
      resizeActive: Boolean(resizingId),
      targetKind
    }) || !localTimeReady) {
      // Until hydration the grid draws no blocks, now line or future zone (#367), so there is
      // nothing a press could be judged against.
      createPointerSequenceRef.current = null;
      return;
    }

    createPointerSequenceRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      dayKey: formatCalendarDateKey(day),
      pointerId: event.pointerId,
      pointerDownTimeStamp: event.timeStamp,
      scrollLeft: calendarScroller?.scrollLeft ?? 0,
      scrollTop: calendarScroller?.scrollTop ?? 0
    };
    const axis = {
      clientY: event.clientY,
      dayBodyTop: dayBody.getBoundingClientRect().top,
      endHour: calendarHours.endHour,
      rowHeight,
      startHour: calendarHours.startHour
    };
    const dragAllowed = !dayBodyPointHitsSemanticBlock(dayBody, event.clientX, event.clientY);
    // Decided against the now the Calendar shows (`capturedNow`: the now line and the
    // not-allowed zone), never a fresher clock, so what the user sees and what release does agree.
    // `capturedNow` never runs ahead of the real clock, so anything allowed here is in the past.
    const future = calendarCreateMinuteIsFuture({ day, minutes: calendarPointerMinutesAt(axis), now: capturedNow });
    createPressRef.current = {
      anchorMinutes: calendarDragMinutesAt(axis),
      dragAllowed,
      future,
      pointerId: event.pointerId
    };
    if (future && dragAllowed) setFuturePressDayKey(formatCalendarDateKey(day));
    dayBody.setPointerCapture(event.pointerId);
  }

  function moveCalendarCreatePointer(day: Date, event: ReactPointerEvent<HTMLDivElement>) {
    const sequence = createPointerSequenceRef.current;
    if (!sequence || sequence.pointerId !== event.pointerId) return;
    const dayBodyTop = event.currentTarget.getBoundingClientRect().top;
    const press = createPressRef.current;
    // A press inside a block's semantic time (including its visual gap) never becomes a drag, and
    // a press in the future never draws a ghost.
    if (!press || press.pointerId !== event.pointerId || !press.dragAllowed || press.future) return;
    const axis = { endHour: calendarHours.endHour, rowHeight, startHour: calendarHours.startHour };
    let drag = createDragRef.current;
    if (!drag) {
      if (Math.hypot(event.clientX - sequence.clientX, event.clientY - sequence.clientY) < resizeDragThresholdPx) return;
      const anchorMinutes = press.anchorMinutes;
      drag = {
        anchorMinutes,
        dayKey: sequence.dayKey,
        endMinutes: anchorMinutes,
        nowMs: capturedNow.getTime(),
        pointerId: event.pointerId,
        startMinutes: anchorMinutes
      };
      createDragRef.current = drag;
    }
    // Held at the displayed now: the ghost stops at the now line, exactly where release will
    // finish the block.
    const range = calendarDragCreateRange({
      ...axis,
      anchorMinutes: drag.anchorMinutes,
      currentMinutes: calendarDragMinutesAt({ ...axis, clientY: event.clientY, dayBodyTop }),
      limitMinutes: calendarCreateLimitMinutes(day, capturedNow)
    });
    // Same range means the same now minute when held, so the ghost and the block still agree.
    drag.nowMs = capturedNow.getTime();
    if (range.startMinutes === drag.startMinutes && range.endMinutes === drag.endMinutes && createGhost) return;
    drag.startMinutes = range.startMinutes;
    drag.endMinutes = range.endMinutes;
    setCreateGhost({ dayKey: formatCalendarDateKey(day), nowMs: drag.nowMs, ...range });
  }

  function abortCalendarCreateDrag() {
    createPressRef.current = null;
    createDragRef.current = null;
    createPointerSequenceRef.current = null;
    setCreateGhost(null);
    setFuturePressDayKey(null);
  }

  const createGestureActive = Boolean(createGhost) || futurePressDayKey !== null;
  useEffect(() => {
    if (!createGestureActive) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      abortCalendarCreateDrag();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [createGestureActive]);

  function finishCalendarCreatePointer(
    day: Date,
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    const dayBody = event.currentTarget;
    const sequence = createPointerSequenceRef.current;
    createPointerSequenceRef.current = null;
    if (dayBody.hasPointerCapture(event.pointerId)) {
      dayBody.releasePointerCapture(event.pointerId);
    }
    const press = createPressRef.current;
    createPressRef.current = null;
    if (press?.future && press.pointerId === event.pointerId) {
      setFuturePressDayKey(null);
      // Released anywhere, after a click or a drag: say why nothing opened — unless the press was
      // an open editor's dismissal, which only dismisses.
      if (
        press.dragAllowed &&
        sequence &&
        !calendarPointerMatchesConsumed(consumedPointerRef.current, sequence)
      ) {
        showFutureCreateNotice();
      }
      return;
    }
    const drag = createDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      createDragRef.current = null;
      setCreateGhost(null);
      if (!sequence || drag.dayKey !== formatCalendarDateKey(day)) return;
      const slot = calendarDragCreateSlot({
        day,
        endMinutes: drag.endMinutes,
        now: new Date(drag.nowMs),
        startMinutes: drag.startMinutes
      });
      if (slot) createCalendarDraft(day, slot);
      return;
    }

    const underlyingTarget = document.elementFromPoint(event.clientX, event.clientY);
    const targetKind = calendarCreateTargetKind(underlyingTarget, dayBody);
    const accepted = calendarCreatePointerSequenceAccepted({
      clientX: event.clientX,
      clientY: event.clientY,
      consumed: sequence
        ? calendarPointerMatchesConsumed(consumedPointerRef.current, sequence)
        : false,
      dayKey: formatCalendarDateKey(day),
      movementThresholdPx: resizeDragThresholdPx,
      pointerId: event.pointerId,
      scrollLeft: calendarScroller?.scrollLeft ?? 0,
      scrollTop: calendarScroller?.scrollTop ?? 0,
      sequence,
      targetEligible: targetKind === "day-body"
    });
    if (!accepted) return;

    const dayBodyRect = dayBody.getBoundingClientRect();
    if (dayBodyPointHitsSemanticBlock(dayBody, event.clientX, event.clientY)) return;

    const slot = calculateCalendarClickCreateSlot({
      clientY: event.clientY,
      day,
      dayBodyRect,
      endHour: calendarHours.endHour,
      now: capturedNow,
      rowHeight,
      startHour: calendarHours.startHour
    });
    if (slot) createCalendarDraft(day, slot);
  }

  function cancelCalendarCreatePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (createPointerSequenceRef.current?.pointerId === event.pointerId) {
      createPointerSequenceRef.current = null;
    }
    if (createPressRef.current?.future && createPressRef.current.pointerId === event.pointerId) {
      createPressRef.current = null;
      setFuturePressDayKey(null);
    }
    if (createDragRef.current?.pointerId === event.pointerId) abortCalendarCreateDrag();
  }

  // Today's now line, on the minute (the line, the pill and the hidden hour label share it).
  const nowTop = localTimeReady && visibleDays.some(isToday)
    ? Math.round(((minutesFromDate(capturedNow) - calendarHours.startHour * 60) / 60) * rowHeight)
    : null;
  // #255 (owner, 27 Oct 2026): an hour label hides only where the now pill actually covers its text,
  // measured as drawn (a wide gutter fits "06:00" beside a 05:57 pill; a phone's narrow one doesn't).
  // Measured once per minute, zoom step or gutter resize, never per frame.
  const timeAxisRef = useRef<HTMLDivElement | null>(null);
  const [coveredAxisLabel, setCoveredAxisLabel] = useState<string | null>(null);
  useLayoutEffect(() => {
    const axis = timeAxisRef.current;
    if (!axis || nowTop === null) {
      setCoveredAxisLabel(null);
      return undefined;
    }
    const measure = () => setCoveredAxisLabel(axisLabelUnderNowPill(axis));
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(axis);
    return () => observer.disconnect();
  }, [axisMarks, clock, nowTop]);

  return (
    <section className="timeline-calendar-workspace">
      {/* Phones: the narrow time gutter has no room for the corner's zoom, so it floats over the
          grid's lower right corner instead (CSS shows one or the other). */}
      <span className="calendar-phone-zoom" role="group" aria-label="Calendar zoom">
        <button
          type="button"
          disabled={zoomIndex === 0}
          aria-label="Zoom calendar out"
          onClick={() => setZoomLevel(zoomKeys[Math.max(0, zoomIndex - 1)])}
        >
          −
        </button>
        <button
          type="button"
          disabled={zoomIndex === zoomKeys.length - 1}
          aria-label="Zoom calendar in"
          onClick={() => setZoomLevel(zoomKeys[Math.min(zoomKeys.length - 1, zoomIndex + 1)])}
        >
          +
        </button>
      </span>
      <div
        aria-busy={localTimeReady ? undefined : true}
        aria-label="Calendar time grid"
        className="calendar-grid-scroller"
        onScroll={onScroll}
        ref={registerCalendarScroller}
        tabIndex={0}
      >
        <div
          className="timeline-calendar-grid"
          // The time gutter and the narrowest day column come from CSS (--calendar-axis-width,
          // --calendar-day-min-width), so phones get a narrow gutter (Calendar phone layout).
          style={{ gridTemplateColumns: `var(--calendar-axis-width) repeat(${visibleDays.length}, minmax(var(--calendar-day-min-width), 1fr))` }}
        >
          <div className="calendar-grid-corner">
            <span className="calendar-corner-zoom" role="group" aria-label="Calendar zoom">
              <button
                type="button"
                disabled={zoomIndex === 0}
                aria-label="Zoom calendar out"
                onClick={() => setZoomLevel(zoomKeys[Math.max(0, zoomIndex - 1)])}
              >
                −
              </button>
              <button
                type="button"
                disabled={zoomIndex === zoomKeys.length - 1}
                aria-label="Zoom calendar in"
                onClick={() => setZoomLevel(zoomKeys[Math.min(zoomKeys.length - 1, zoomIndex + 1)])}
              >
                +
              </button>
            </span>
          </div>
          {visibleDays.map((day) => {
            const dayStart = startOfDay(day);
            const total = analyzeTimeIntervals(
              gridEntries.map((entry) => ({
                id: entry.id,
                startedAt: entry.startedAt,
                stoppedAt: entry.stoppedAt
              })),
              {
                range: { start: dayStart, end: addDays(dayStart, 1) },
                now: capturedNow
              }
            );
            const loggedLabel = formatDuration(total.loggedSeconds);
            return (
              <div
                key={day.toISOString()}
                className={[
                  "calendar-day-heading",
                  isToday(day) ? "is-today" : ""
                ].join(" ")}
              >
                <div className="calendar-day-date" aria-label={formatDate(day)}>
                  <small aria-hidden="true">{formatCalendarWeekday(day)}</small>
                  <b aria-hidden="true">{day.getDate()}</b>
                </div>
                <div
                  aria-hidden={localTimeReady ? undefined : true}
                  aria-label={localTimeReady ? `${loggedLabel} logged` : undefined}
                  className="calendar-day-total tabular"
                >
                  {total.loggedSeconds > 0 ? loggedLabel : "–"}
                </div>
              </div>
            );
          })}

          <div className="calendar-time-axis" ref={timeAxisRef} style={{ height: calendarHeight }}>
            {nowTop !== null ? (
              <span
                aria-hidden="true"
                className="calendar-now-pill"
                // Clamped so the pill stays inside the axis at midnight and at the day's end; the
                // line keeps the exact time.
                style={{ top: Math.min(calendarHeight - NOW_PILL_HALF_HEIGHT, Math.max(NOW_PILL_HALF_HEIGHT, nowTop)) }}
              >
                {formatTime(capturedNow, clock)}
              </span>
            ) : null}
            {axisMarks.map((mark) => (
              <div key={mark.key}>
                <span
                  aria-hidden="true"
                  className={[
                    "absolute left-0 right-0 border-t border-[var(--line)]",
                    mark.major ? "" : "border-dotted opacity-70"
                  ].join(" ")}
                  style={{ top: mark.top }}
                />
                <span
                  className={`tabular absolute left-0 right-0 px-2 pt-1 text-xs text-[var(--muted)]${
                    // Calendar v3: the now pill takes the place of the hour label it covers (#255: only then).
                    nowTop !== null && coveredAxisLabel === mark.key ? " calendar-axis-label-under-now" : ""}`}
                  data-axis-label={mark.key}
                  style={{ top: mark.labelTop }}
                >
                  <span>{mark.label}</span>
                </span>
              </div>
            ))}
          </div>
          {visibleDays.map((day) => {
            const dayKey = formatCalendarDateKey(day);
            // Where a block can't start: a whole later day, or today below the now line. CSS gives
            // both the not-allowed cursor, so hovering costs no render. Local-time dependent, so it
            // follows the same post-hydration now as the now line, blocks and "today" (#367), and
            // the server render and the hydration pass draw none of it.
            const createLimitMinutes = localTimeReady
              ? calendarCreateLimitMinutes(day, capturedNow)
              : 24 * 60;
            const dayIsFuture = createLimitMinutes <= calendarHours.startHour * 60;
            const futureZoneTop = createLimitMinutes < calendarHours.endHour * 60 && !dayIsFuture
              ? Math.round(((createLimitMinutes - calendarHours.startHour * 60) / 60) * rowHeight)
              : null;
            const dayBrackets = calendarBrackets.byDay.get(dayKey) ?? [];
            // Day view's rail holds the pattern's name written level; Week view's keeps the bare bracket.
            const dayView = visibleDays.length === 1;
            // Step 17: a Places lane on the left of a day with any place besides Home, about a fifth of it.
            const dayPlaces = locations?.timelines.get(dayKey) ?? null;
            const lanePx = dayPlaces ? placesLaneWidth(dayPlaces, dayBodyWidth) : 0;
            const railPx = lanePx + (dayBrackets.length ? (dayView ? calendarBracketDayRailPx : calendarBracketRailPx) : 0);
            // The drag ghost and the draft slot start where a full-width block does, right of any
            // bracket rail (CSS keeps its 8 px inset on a day without one).
            const draftInsets = railPx ? { left: calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 1 }, railPx).left } : {};
            return (
            <div
              key={`${day.toISOString()}-body`}
              data-calendar-day-body
              data-calendar-day-key={dayKey}
              className={[
                "calendar-day-body",
                dayIsFuture ? "is-future" : "",
                futurePressDayKey === dayKey ? "is-future-press" : ""
              ].filter(Boolean).join(" ")}
              onLostPointerCapture={cancelCalendarCreatePointer}
              onPointerCancel={cancelCalendarCreatePointer}
              onPointerDown={(event) => startCalendarCreatePointer(day, event)}
              onPointerMove={(event) => moveCalendarCreatePointer(day, event)}
              onPointerUp={(event) => finishCalendarCreatePointer(day, event)}
              style={{
                height: calendarHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${Math.max(0, gridLineSpacing - 1)}px, var(--line) ${gridLineSpacing}px)`
              }}
            >
              {futureZoneTop !== null ? (
                <span
                  aria-hidden="true"
                  className="calendar-future-zone"
                  data-calendar-future-zone
                  style={{ top: futureZoneTop }}
                />
              ) : null}
              {localTimeReady && isToday(day) ? (
                <span
                  aria-hidden="true"
                  className="calendar-now-line"
                  style={{ top: nowTop ?? 0 }}
                />
              ) : null}
              {dayBrackets.map((bracket) => {
                // From the first part's drawn top to the last part's drawn bottom (the blocks' own
                // maths, minimum heights included), so it stays beside them at every zoom.
                const parts = bracket.memberIds.flatMap((id) => {
                  const member = calendarBrackets.members.get(id);
                  const geometry = member
                    ? calendarBlockStyle(member, null, day, rowHeight, calendarHeight, calendarHours, capturedNow)
                    : null;
                  return geometry ? [geometry] : [];
                });
                if (!parts.length) return null;
                const top = Math.min(...parts.map((part) => part.top));
                const height = Math.max(...parts.map((part) => part.top + part.height)) - top;
                // Decorative: the parts' own names say which trip they belong to.
                return (
                  <span
                    aria-hidden="true"
                    className={`df-cal-bracket${dayView ? " is-day" : ""}`}
                    data-calendar-bracket={bracket.key}
                    key={`bracket:${bracket.key}`}
                    style={{ top, height }}
                  >
                    {dayView && height >= 14 ? (
                      <span className="df-cal-bracket-label" style={{ maxHeight: height }}>{bracket.name}</span>
                    ) : null}
                  </span>
                );
              })}
              {createGhost?.dayKey === formatCalendarDateKey(day) ? (() => {
                const ghostLimitMinutes = calendarCreateLimitMinutes(day, new Date(createGhost.nowMs));
                const geometry = calendarCreateGhostGeometry({
                  endMinutes: createGhost.endMinutes,
                  limitMinutes: ghostLimitMinutes < 24 * 60 ? ghostLimitMinutes : undefined,
                  rowHeight,
                  startHour: calendarHours.startHour,
                  startMinutes: createGhost.startMinutes
                });
                // The label's duration is the block release creates (DST-safe, ending at the
                // displayed now when held there).
                const seconds = calendarDragCreateSeconds({
                  day,
                  endMinutes: createGhost.endMinutes,
                  now: new Date(createGhost.nowMs),
                  startMinutes: createGhost.startMinutes
                });
                return (
                  <div
                    aria-hidden="true"
                    className="calendar-create-ghost tabular"
                    data-calendar-create-ghost
                    style={{ ...geometry, ...draftInsets }}
                  >
                    {`${formatCalendarAxisMinutes(createGhost.startMinutes, clock, true)}–${formatCalendarAxisMinutes(createGhost.endMinutes, clock, true)} · ${formatDuration(seconds)}`}
                  </div>
                );
              })() : null}
              {visibleSelectedTarget?.kind === "create" && visibleSelectedTarget.dayKey === formatCalendarDateKey(day) ? (() => {
                const geometry = calculateCalendarDraftAnchorGeometry({
                  day,
                  endHour: calendarHours.endHour,
                  rowHeight,
                  startedAt: visibleSelectedTarget.draftStartedAt,
                  startHour: calendarHours.startHour,
                  stoppedAt: visibleSelectedTarget.draftStoppedAt
                });
                if (!geometry) return null;
                return (
                  <div
                    aria-hidden="true"
                    className={[
                      "calendar-draft-slot-anchor",
                      geometry.continuesIntoNextDay ? "is-continuation-to-next" : ""
                    ].join(" ")}
                    data-calendar-draft
                    data-calendar-draft-session={visibleSelectedTarget.sessionId}
                    ref={registerCalendarDraftAnchor}
                    style={{
                      ...draftInsets,
                      height: geometry.height,
                      top: geometry.top,
                      zIndex: 1
                    }}
                  />
                );
              })() : null}
              {(() => {
                // Dense-day rules (owner, 24 Oct 2026): a finished block of a minute or less is a short line at
                // the column's edge, never a block that crowds the grid.
                const isMoment = (entry: TimeEntryRow) => Boolean(entry.stoppedAt) &&
                  Date.parse(entry.stoppedAt!) - Date.parse(entry.startedAt) <= 60_000 && resizeDraft?.entryId !== entry.id;
                const dayEntries = gridEntries.filter((entry) => entryOverlapsDay(entry, day, capturedNow));
                const moments = dayEntries.filter(isMoment);
                const blocks = dayEntries
                  .filter((entry) => !isMoment(entry))
                  .map((entry) => {
                    const activeDraft = resizeDraft?.entryId === entry.id ? resizeDraft : null;
                    const blockStyle = calendarBlockStyle(
                      entry,
                      activeDraft,
                      day,
                      rowHeight,
                      calendarHeight,
                      calendarHours,
                      capturedNow
                    );
                    if (!blockStyle) return null;
                    const { startsBeforeDay, continuesIntoNextDay, ...semanticBlockPositionStyle } = blockStyle;
                    const visualBlockGeometry = calendarBlockVisualGeometry({
                      ...semanticBlockPositionStyle,
                      continuesIntoNextDay
                    });
                    const blockPositionStyle = {
                      top: visualBlockGeometry.top,
                      height: visualBlockGeometry.height
                    };
                    const durationSeconds = calendarDurationSeconds(entry, activeDraft, day, capturedNow);
                    const density = getTimeBlockDensity({
                      durationSeconds,
                      height: visualBlockGeometry.height
                    });
                    const blockKey = calendarBlockKey(entry.id, day);
                    return {
                      activeDraft,
                      blockKey,
                      blockPositionStyle,
                      continuesIntoNextDay,
                      density,
                      durationSeconds,
                      entry,
                      semanticBlockPositionStyle,
                      startsBeforeDay
                    };
                  })
                  .filter((block): block is NonNullable<typeof block> => Boolean(block));
                // Suggestions are hatched blocks in the same grid, under the same column rules (no lane).
                const suggestions = pendingReviewSpans(gridReviewItems, startOfDay(day).getTime(), addDays(startOfDay(day), 1).getTime(), capturedNow.getTime())
                  .flatMap((item) => {
                    const geometry = calendarBlockStyle(
                      { startedAt: new Date(item.fromMs).toISOString(), stoppedAt: new Date(item.toMs).toISOString() },
                      null, day, rowHeight, calendarHeight, calendarHours, capturedNow
                    );
                    if (!geometry) return [];
                    const visual = calendarBlockVisualGeometry({ top: geometry.top, height: geometry.height, continuesIntoNextDay: geometry.continuesIntoNextDay });
                    return [{ item, key: `review:${item.id}`, top: visual.top, height: visual.height }];
                  });
                // Columns over everything drawn plus its 2 px gap below, so blocks whose drawn extents only
                // touch stay full width (location v4 C6, Codex r2 on #545) and every pair keeps the whole
                // gap (Codex r2 on #579); nothing is ever drawn on top of another.
                const laneBlocks = [
                  ...blocks.map((block) => ({
                    key: block.blockKey,
                    top: block.blockPositionStyle.top,
                    height: block.blockPositionStyle.height + calendarBlockVisualGapPx
                  })),
                  ...suggestions.map((suggestion) => ({ key: suggestion.key, top: suggestion.top, height: suggestion.height + calendarBlockVisualGapPx }))
                ];
                // Calendar v3 (owner, 24 Oct 2026): Apple's hybrid overlap once the column is measured —
                // close starts side by side, later starts nested 14 px in and drawn on top.
                const laneWidth = calendarLaneWidth(dayBodyWidth, railPx);
                const lanes = laneWidth > 0
                  ? layoutTimeBlockHybrid(laneBlocks, { laneWidth, pixelsPerHour: rowHeight })
                  : layoutTimeBlockLanes(laneBlocks);
                const fullLane: TimeBlockLane = { laneCount: 1, laneIndex: 0, mode: "full", offsetFraction: 0, widthFraction: 1, zIndex: 0 };

                const momentLines = moments.map((entry) => {
                  // The day's own clipped start (a moment across midnight sits at the top of its second day).
                  const geometry = calendarBlockStyle(entry, null, day, rowHeight, calendarHeight, calendarHours, capturedNow);
                  if (!geometry) return null;
                  const top = Math.round(geometry.top);
                  const blockKey = calendarBlockKey(entry.id, day);
                  const selected = visibleSelectedTarget?.kind === "entry" && visibleSelectedTarget.blockKey === blockKey;
                  const label = calendarBlockDetailsLabel(entry, null, 0, day, capturedNow, clock, calendarBrackets.parts.get(entry.id));
                  return (
                    <button
                      aria-label={label}
                      aria-pressed={selected}
                      className={`calendar-moment${selected ? " is-selected" : ""}`}
                      data-calendar-block-key={blockKey}
                      data-tip={label}
                      key={`moment:${blockKey}`}
                      onClick={(event) => selectCalendarEntry({ anchor: event.currentTarget, blockKey, entryId: entry.id, focusOnOpen: event.detail === 0 })}
                      onPointerDown={(event) => event.stopPropagation()}
                      // The hit area fills the clear strip left of the blocks (the rail and its 8 px inset), so it
                      // never covers a block while staying easy to reach (Codex r2 on #579).
                      style={{ top, "--calendar-block-accent": timeEntryAccentColor(entry), "--calendar-moment-room": `${railPx + 8}px` } as CSSProperties}
                      type="button"
                    />
                  );
                });

                const suggestionBlocks = suggestions.map(({ item, key, top, height }) => {
                  const range = `${formatTime(new Date(item.fromMs), clock)} to ${formatTime(new Date(item.toMs), clock)}`;
                  const lane = lanes.get(key) ?? fullLane;
                  const label = denseBlockLabel(height, false, 0);
                  return (
                    <Link
                      aria-label={`${item.title}, needs a look, ${range}.`}
                      className={["calendar-review-block", "is-v4", label.compact ? "is-dense-compact" : "", label.detail ? "has-detail-room" : ""].filter(Boolean).join(" ")}
                      data-calendar-block-key={key}
                      data-depth={lane.px?.depth ? Math.min(lane.px.depth, 9) : undefined}
                      // Step 15: a "?" on the grid opens its dialog (below), or its question in the List, never Review.
                      href={`/timeline?view=list&scope=day&date=${toTimelineDateKey(new Date(item.fromMs))}&check=${encodeURIComponent(item.id)}`}
                      key={key}
                      tabIndex={visibleSelectedTarget ? -1 : undefined}
                      onClick={(event) => {
                        // Owner item A: a "?" whose place or trip is on the Grid opens its dialog.
                        if (locations && !visibleSelectedTarget) {
                          const payload = reviewItems.find((review) => review.id === item.id)?.rawPayload;
                          const segmentId = typeof payload?.clientSegmentId === "string" ? payload.clientSegmentId : null;
                          for (const timeline of locations.timelines.values()) {
                            const found = segmentId ? timeline.items.find((each) => each.id === segmentId) : undefined;
                            if (found) {
                              event.preventDefault();
                              locations.onOpen(found, timeline, item.id);
                              return;
                            }
                          }
                        }
                        // A press an open editor took for its own dismissal (and any discard
                        // prompt) only dismisses, as on blank time: it never also leaves Calendar.
                        const pointer = reviewLinkPointerRef.current;
                        // While an editor is open its draft owns the page: a keyboard activation
                        // (no pointer to consume) never leaves for Review either.
                        if (
                          (event.detail === 0 && visibleSelectedTarget) ||
                          // Only a pointer click can be the press the editor consumed; a keyboard
                          // Enter after a clean outside-click dismissal must still open Review.
                          (event.detail > 0 && pressConsumedByEditorRef.current) ||
                          (pointer && calendarPointerMatchesConsumed(consumedPointerRef.current, pointer))
                        ) {
                          event.preventDefault();
                        }
                        pressConsumedByEditorRef.current = false;
                      }}
                      style={{
                        ...calendarBlockLaneStyle(lane, railPx),
                        top,
                        height,
                        ...label.vars,
                        // The suggested activity's palette colour in both themes, as blocks have it.
                        ...(item.color ? activityBlockStyle(item.color, item.name) : {}),
                        "--calendar-block-accent": item.color ? "var(--block)" : "var(--text-muted)"
                      } as CSSProperties}
                    >
                      {/* Padding inside the query container, so its width thresholds match a block's. */}
                      <span className="calendar-review-content">
                        <span className="calendar-entry-title"><CalendarTitleWords text={item.title} /></span>
                      </span>
                    </Link>
                  );
                });

                const blockElements = blocks.map((block) => {
                  const {
                    activeDraft,
                    blockKey,
                    blockPositionStyle,
                    continuesIntoNextDay,
                    density,
                    durationSeconds,
                    entry,
                    startsBeforeDay
                  } = block;
                  const asking = askingByBlock.get(entry.id);
                  const detailsLabel = `${calendarBlockDetailsLabel(entry, activeDraft, durationSeconds, day, capturedNow, clock, calendarBrackets.parts.get(entry.id))}${asking ? ", Needs a look" : ""}`;
                  const lane = lanes.get(blockKey) ?? fullLane;
                  const label = denseBlockLabel(blockPositionStyle.height, density.canDirectResize,
                    calendarBlockDetailLines(entry, capturedNow, clock).length);
                  const selected = visibleSelectedTarget?.kind === "entry" && visibleSelectedTarget.blockKey === blockKey;
                  const isResizing = resizingId === entry.id;
                  const isContinuing = continuingEntryId === entry.id;
                  const accent = timeEntryAccentColor(entry);
                  const displayEntry = {
                    ...entry,
                    startedAt: activeDraft?.startedAt ?? entry.startedAt,
                    stoppedAt: activeDraft?.stoppedAt ?? entry.stoppedAt
                  };
                  // Step 16: a trip block from 44 px tall shows its legs down its left edge.
                  const legTrip = blockPositionStyle.height >= 44 ? tripsByBlock.get(entry.id) ?? null : null;
                  const hasInlineActionSlot = Boolean(
                    entry.stoppedAt && density.canShowInlineAction
                  );
                  const showInlineAction = canShowTimeBlockInlineAction({
                    density,
                    isCompleted: Boolean(entry.stoppedAt),
                    isResizing,
                    isSelected: selected
                  });
                  return (
                    <article
                      key={blockKey}
                      className={[
                        "calendar-time-block",
                        selected ? "is-selected" : "",
                        isResizing ? "is-resizing" : "",
                        entry.stoppedAt ? "" : "is-running",
                        startsBeforeDay ? "is-continuation-from-previous" : "",
                        continuesIntoNextDay ? "is-continuation-to-next" : "",
                        entry.categoryId ? "" : "is-uncategorized",
                        label.compact ? "is-dense-compact" : "",
                        label.detail ? "has-detail-room" : "",
                        hasInlineActionSlot ? "has-inline-action-slot" : "",
                        legTrip ? "has-leg-strip" : "",
                        asking ? "is-asking" : "",
                        ...timeBlockDensityClassNames(density)
                      ].join(" ")}
                      style={{
                        ...blockPositionStyle,
                        ...calendarBlockLaneStyle(lane, railPx),
                        ...label.vars,
                        // Calendar v3 (owner, 24 Oct 2026): a translucent tint and a 3 px colour bar; the text a
                        // darker (Daylight) or lighter (Midnight) shade of the block's own hue (CSS).
                        ...(entry.categoryId ? activityBlockStyle(entry.categoryColor, entry.categoryName ?? "") : {}),
                        "--calendar-block-accent": entry.categoryId ? "var(--block)" : accent
                      } as CSSProperties}
                      data-entry-id={entry.id}
                      data-calendar-block-key={blockKey}
                      data-calendar-semantic-height={block.semanticBlockPositionStyle.height}
                      data-calendar-semantic-top={block.semanticBlockPositionStyle.top}
                      data-overlap-layout={lane.mode}
                      data-depth={lane.px?.depth ? Math.min(lane.px.depth, 9) : undefined}
                    >
                      <button
                        type="button"
                        className="calendar-entry-primary"
                        aria-label={detailsLabel}
                        aria-pressed={selected}
                        title={detailsLabel}
                        onClick={(event) => {
                          if (event.detail > 0) event.currentTarget.blur();
                          const anchor = event.currentTarget.closest<HTMLElement>("[data-calendar-block-key]");
                          if (!anchor) return;
                          selectCalendarEntry({
                            anchor,
                            blockKey,
                            entryId: entry.id,
                            focusOnOpen: event.detail === 0
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                            event.preventDefault();
                            const anchor = event.currentTarget.closest<HTMLElement>("[data-calendar-block-key]");
                            if (!anchor) return;
                            selectCalendarEntry({
                              anchor,
                              blockKey,
                              entryId: entry.id,
                              focusOnOpen: true
                            });
                          }
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {/* The title always wins: it wraps to the lines that fit, ending after a whole word. */}
                        <span className="calendar-entry-title"><CalendarTitleWords text={calendarBlockPrimaryParts(displayEntry).description} /></span>
                        {/* Calendar v3: icon lines under the title while they fit (place, trip or Health, tags, times). */}
                        <CalendarDetailLines lines={calendarBlockDetailLines(displayEntry, capturedNow, clock)} />
                        {/* Its one "?" (design §7): the amber dot; the press opens its editor with the question. */}
                        {asking ? <span aria-hidden="true" className="calendar-block-ask-dot" /> : null}
                      </button>
                      {showInlineAction ? (
                        <button
                          type="button"
                          className="calendar-start-again"
                          data-tip="Start again"
                          aria-busy={isContinuing}
                          aria-label={`Start ${timeEntryTitle(entry)} again`}
                          disabled={isTimerBusy || Boolean(continuingEntryId)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (event.detail > 1) return;
                            void continueCalendarEntry(entry, "inline").then((outcome) => {
                              if (outcome.ok) clearCalendarSelection();
                            });
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <DayframeIcon glyph="play" size={13} fill="currentColor" strokeWidth={0}/>
                        </button>
                      ) : null}
                      {entry.stoppedAt && density.canDirectResize && !startsBeforeDay ? (
                        <span
                          className="swiss-resize-handle top"
                          aria-hidden="true"
                          title={`Drag to resize the start of ${timeEntryTitle(entry)}`}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                          }}
                          onPointerDown={(event) => startCalendarResize(entry, day, "start", event)}
                        />
                      ) : null}
                      {entry.stoppedAt && density.canDirectResize && !continuesIntoNextDay ? (
                        <span
                          className="swiss-resize-handle bottom"
                          aria-hidden="true"
                          title={`Drag to resize the end of ${timeEntryTitle(entry)}`}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                          }}
                          onPointerDown={(event) => startCalendarResize(entry, day, "end", event)}
                        />
                      ) : null}
                      {legTrip ? (
                        <CalendarLegStrip fromMs={Date.parse(displayEntry.startedAt)} legs={legTrip.legs}
                          toMs={displayEntry.stoppedAt ? Date.parse(displayEntry.stoppedAt) : capturedNow.getTime()} />
                      ) : null}
                    </article>
                  );
                });
                // Entries keep the day's own order whichever way each is drawn (a moment or a block), so a
                // tab stop never jumps when a block's length changes (Codex r1 on #579).
                const byEntry = new Map<string, ReactNode>();
                moments.forEach((entry, index) => byEntry.set(entry.id, momentLines[index]));
                blocks.forEach((block, index) => byEntry.set(block.entry.id, blockElements[index]));
                return [...suggestionBlocks, ...dayEntries.map((entry) => byEntry.get(entry.id) ?? null)];
              })()}
              {dayPlaces && lanePx ? (
                <CalendarPlacesLane asking={locations?.asking ?? new Map()} clock={clock}
                  onOpen={(item, checkId) => locations?.onOpen(item, dayPlaces, checkId)}
                  geometry={(startedAt, stoppedAt) => {
                    const box = calendarBlockStyle({ startedAt, stoppedAt }, null, day, rowHeight, calendarHeight, calendarHours, capturedNow);
                    return box ? { top: box.top, height: box.height } : null;
                  }}
                  timeline={dayPlaces} widthPx={lanePx} />
              ) : null}
            </div>
            );
          })}
        </div>
      </div>
      {visibleSelectedTarget?.kind === "entry" && selectedEntry ? (
        <CalendarEntryCompactEditor
          key={`${visibleSelectedTarget.blockKey}:${visibleSelectedTarget.sessionId}`}
          anchor={visibleSelectedTarget.anchor}
          capturedNow={capturedNow}
          categories={categories}
          entry={selectedEntry}
          focusOnOpen={visibleSelectedTarget.focusOnOpen}
          question={(() => {
            const item = askingByBlock.get(selectedEntry.id);
            if (!item || !answerBlockCheck) return null;
            const words = blockQuestionWords(item, timeEntryTitle(selectedEntry), clock);
            return { text: words.question, yesLabel: words.yesLabel, noLabel: words.noLabel, onAnswer: (yes: boolean) => answerBlockCheck(item, yes, yes ? words.endedLabel : words.keptLabel) };
          })()}
          isTimerBusy={isTimerBusy}
          mode="entry"
          onCreateCategory={createCategory}
          onDelete={() => deleteCalendarEntry(selectedEntry)}
          onDismiss={({ restoreFocus }) => dismissCalendarEditor(visibleSelectedTarget, restoreFocus)}
          onOutsidePointerDown={(pointer) => consumeCalendarEditorPointer(visibleSelectedTarget, pointer)}
          onSave={(plan) => saveCalendarEditor(selectedEntry, plan)}
          onStartAgain={() => continueCalendarEntry(selectedEntry)}
          onSplit={(atMs) => changeCalendarBlocks(() => splitTimeEntry(clientFetch, selectedEntry, atMs))}
          onDuplicate={() => changeCalendarBlocks(() => duplicateTimeEntry(clientFetch, selectedEntry))}
          peerEntries={entries}
          positionKey={`${zoomLevel}:${rowHeight}:${selectedEntry.startedAt}:${selectedEntry.stoppedAt ?? "running"}`}
          scrollContainer={calendarScroller}
          taskSuggestions={shellData?.taskSuggestions ?? []}
          taskSuggestionCandidates={shellData?.taskSuggestionCandidates}
          tags={tags}
        />
      ) : null}
      {visibleSelectedTarget?.kind === "create" && visibleSelectedTarget.anchor ? (
        <CalendarEntryCompactEditor
          key={`create:${visibleSelectedTarget.sessionId}`}
          anchor={visibleSelectedTarget.anchor}
          capturedNow={capturedNow}
          categories={categories}
          focusOnOpen
          isTimerBusy={isTimerBusy}
          mode="create"
          onCreateCategory={createCategory}
          onDismiss={({ restoreFocus }) => dismissCalendarEditor(visibleSelectedTarget, restoreFocus)}
          onDraftChange={(plan) => updateCalendarCreateDraft(visibleSelectedTarget, plan)}
          onOutsidePointerDown={(pointer) => consumeCalendarEditorPointer(visibleSelectedTarget, pointer)}
          onSave={saveCalendarCreate}
          peerEntries={entries}
          positionKey={`${zoomLevel}:${rowHeight}:${visibleSelectedTarget.draftStartedAt}:${visibleSelectedTarget.draftStoppedAt}`}
          scrollContainer={calendarScroller}
          source={{
            startedAt: visibleSelectedTarget.startedAt,
            stoppedAt: visibleSelectedTarget.stoppedAt
          }}
          taskSuggestions={shellData?.taskSuggestions ?? []}
          taskSuggestionCandidates={shellData?.taskSuggestionCandidates}
          tags={tags}
        />
      ) : null}
      {resizeDraft ? (
        <div className="df-divider-top px-4 py-2">
          <OverlapNotice
            candidate={{
              startedAt: resizeDraft.startedAt,
              stoppedAt: resizeDraft.stoppedAt
            }}
            entries={entries}
            excludeEntryId={resizeDraft.entryId}
          />
        </div>
      ) : null}
      {resizeTip ? (
        <div
          aria-hidden="true"
          className="calendar-resize-tip tabular"
          data-calendar-resize-tip
          style={{ left: resizeTip.x, top: resizeTip.y, transform: resizeTip.flip ? "translateX(-100%)" : undefined }}
        >
          {resizeTip.label}
        </div>
      ) : null}
      {resizeError ? (
        <p className="df-divider-top px-4 py-2 text-sm text-[var(--danger-text)]" role="alert">
          {resizeError}
        </p>
      ) : null}
      {actionError && !undoToastVisible ? (
        <BlocksToast
          actionLabel="Dismiss"
          focusActionIfLost
          message={actionError}
          onAction={() => {
            setActionError(null);
            focusTimelineAfterToast();
          }}
          tone="error"
        />
      ) : null}
      {/* Announces a notice the Delete Undo toast kept off screen; empty otherwise, so a visible
          toast (its own polite status) is never read twice. */}
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {createNotice?.announcedOnly ? CALENDAR_FUTURE_CREATE_NOTICE : ""}
      </p>
      {createNotice && !createNotice.announcedOnly && !actionError ? (
        <BlocksToast
          exiting={createNotice.exiting}
          key={createNotice.token}
          message={CALENDAR_FUTURE_CREATE_NOTICE}
        />
      ) : null}
    </section>
  );
}

/**
 * Every block's one label line (location v4 C6): its title and its real length, "Coffee 4m",
 * whatever its drawn height. The full description, activity, tags and times are in its name.
 */
/** Line heights of the Calendar v3 label (CSS keeps the same: 17 px title, 14 px compact, 15 px icon lines). */
const CALENDAR_DENSE_LINES = { lineHeight: 17, compactLineHeight: 14, detailLineHeight: 15 } as const;
/**
 * The label's top padding as CSS draws it: 2 px (1 px in compact type), and 6 px on a block tall enough
 * for direct resize, which keeps its title clear of the handle. The last line may use the bottom padding
 * (calendar-v3-mockup's room).
 */
const CALENDAR_DENSE_PADDING = { regular: 2, compact: 1, resizeTop: 6, regularTop: 2, compactTop: 1 } as const;

/**
 * A block's label from its drawn height (Calendar v3): compact type under 34 px; with room (and, by CSS,
 * from 120 px wide) icon lines under the title — the title keeps room for as many of `detailCount` as fit
 * under one title line and takes every whole line left; the icon lines then fill what remains. Counted
 * from the same content height CSS lays out. Width rules stay in CSS.
 */
function denseBlockLabel(height: number, canDirectResize = false, detailCount = 0) {
  const { lineHeight, compactLineHeight, detailLineHeight } = CALENDAR_DENSE_LINES;
  const { compact } = calendarDenseLabel({ height, width: Number.POSITIVE_INFINITY, ...CALENDAR_DENSE_LINES });
  const room = Math.max(0, height - CALENDAR_DENSE_PADDING.regular -
    (canDirectResize ? CALENDAR_DENSE_PADDING.resizeTop - CALENDAR_DENSE_PADDING.regularTop : 0));
  const compactRoom = Math.max(0, height - CALENDAR_DENSE_PADDING.compact -
    (canDirectResize ? CALENDAR_DENSE_PADDING.resizeTop - CALENDAR_DENSE_PADDING.compactTop : 0));
  const available = compact ? 0 : Math.max(0, Math.floor((room - lineHeight) / detailLineHeight));
  const titleLines = Math.max(1, Math.floor((room - Math.min(available, detailCount) * detailLineHeight) / lineHeight));
  const detailLines = available > 0 ? Math.max(0, Math.floor((room - titleLines * lineHeight) / detailLineHeight)) : 0;
  return {
    compact,
    detail: detailLines > 0 && detailCount > 0,
    vars: {
      "--title-lines": String(titleLines),
      "--detail-lines": String(detailLines),
      "--title-lines-detailless": String(Math.max(1, Math.floor(room / lineHeight))),
      "--title-lines-compact": String(Math.max(1, Math.floor(compactRoom / compactLineHeight)))
    } as CSSProperties
  };
}

/**
 * Calendar v3: the icon lines under a block's title (registry glyphs). They share `--detail-lines` whole
 * lines: each wraps after whole words and the ones that no longer fit are cut off (CSS).
 */
function CalendarDetailLines({ lines }: { lines: ReturnType<typeof calendarBlockDetailLines> }) {
  return (
    <span aria-hidden="true" className="calendar-entry-details">
      {lines.map((line) => (
        <span className={`calendar-entry-detail${line.glyph === "clock" ? " tabular" : ""}`} key={line.glyph}>
          <DayframeIcon glyph={line.glyph} size={11} />
          <span className="calendar-entry-detail-text">{line.text}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A title as unbreakable words (dense-day rules): a line that runs out of room ends with the
 * ellipsis after the last whole word that fits, never part-way through one. A word wider than
 * the title itself is left out with every word after it (an ellipsis follows the words before
 * it; none fit, colour only), measured whenever the title's width changes.
 */
function CalendarTitleWords({ text }: { text: string }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const wordsRef = useRef<HTMLSpanElement>(null);
  const [fitCount, setFitCount] = useState<number>(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const title = wordsRef.current?.parentElement;
    if (!title || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const spans = [...(wordsRef.current?.querySelectorAll<HTMLElement>(".calendar-entry-word") ?? [])];
      setFitCount(wholeWordsThatFit(spans.map((span) => span.offsetWidth), title.clientWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    // A web font arriving changes word widths without resizing the title, so measure again then too.
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    fonts?.addEventListener?.("loadingdone", measure);
    void fonts?.ready?.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [words]);
  const shown = Math.min(fitCount, words.length);
  return (
    // Calendar v3 (owner OK, 24 Oct 2026): when not even the first word fits, it is cut with "…" as
    // Apple does ("Quart…"), by CSS; a column under 22 px is colour only.
    <span className={`calendar-entry-words${shown === 0 && words.length > 0 ? " is-cut-first" : ""}`} ref={wordsRef}>
      {words.map((word, index) => (
        <Fragment key={index}>
          {index > 0 && index < shown ? " " : null}
          {/* Words past the cut stay measurable (out of flow, unseen) for when the title widens. */}
          <span className={`calendar-entry-word${index >= shown ? " is-beyond" : ""}`}>{word}</span>
          {/* The first word, cut to the title's width with an ellipsis, when no whole word fits. */}
          {index === 0 && shown === 0 ? <span className="calendar-entry-word-cut">{word}</span> : null}
        </Fragment>
      ))}
      {shown > 0 && shown < words.length ? <span className="calendar-entry-word">{"\u2026"}</span> : null}
    </span>
  );
}

function calendarBlockStyle(
  entry: Pick<TimeEntryRow, "startedAt" | "stoppedAt">,
  draft: CalendarResizeDraft | null,
  day: Date,
  rowHeight: number,
  calendarHeight: number,
  calendarHours: { startHour: number; endHour: number },
  capturedNow: Date
) {
  const start = new Date(draft?.startedAt ?? entry.startedAt);
  const stoppedAt = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : capturedNow;
  if (Number.isNaN(start.getTime()) || Number.isNaN(stoppedAt.getTime())) return null;
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  const axisStart = new Date(dayStart);
  axisStart.setHours(calendarHours.startHour, 0, 0, 0);
  const axisEnd = new Date(dayStart);
  axisEnd.setHours(calendarHours.endHour, 0, 0, 0);
  const visibleStart = new Date(Math.max(start.getTime(), axisStart.getTime()));
  const visibleEnd = new Date(Math.min(stoppedAt.getTime(), axisEnd.getTime()));
  if (visibleEnd <= axisStart || visibleStart >= axisEnd || visibleEnd <= visibleStart) return null;
  const startMinutes = visibleStart <= axisStart
    ? 0
    : minutesFromDate(visibleStart) - calendarHours.startHour * 60;
  let endMinutes = visibleEnd >= axisEnd
    ? (calendarHours.endHour - calendarHours.startHour) * 60
    : minutesFromDate(visibleEnd) - calendarHours.startHour * 60;
  if (
    endMinutes <= startMinutes &&
    visibleEnd > visibleStart &&
    sameDay(visibleStart, visibleEnd)
  ) {
    endMinutes = Math.min(
      (calendarHours.endHour - calendarHours.startHour) * 60,
      startMinutes + Math.max(1, (visibleEnd.getTime() - visibleStart.getTime()) / 60_000)
    );
  }
  const durationMinutes = Math.max(1, endMinutes - startMinutes);
  const minimumHeight = minimumTimeBlockHeight();
  const top = Math.min(calendarHeight - minimumHeight, Math.max(0, (startMinutes / 60) * rowHeight));
  const height = Math.min(calendarHeight - top, Math.max(minimumHeight, (durationMinutes / 60) * rowHeight));
  const continuation = calendarBlockContinuationEdges({
    startedAt: start,
    stoppedAt,
    dayStart,
    dayEnd
  });
  return {
    top: Math.round(top),
    height: Math.round(height),
    startsBeforeDay: continuation.startsBeforeDay,
    continuesIntoNextDay: continuation.continuesIntoNextDay
  };
}

const NO_TIMELINE_ENTRIES: TimeEntryRow[] = [];
const NO_REVIEW_ITEMS: readonly ReviewItemRow[] = [];
const NO_ASKING: ReadonlyMap<string, string> = new Map();

function calendarBlockKey(entryId: string, day: Date) {
  return `${entryId}:${formatCalendarDateKey(day)}`;
}

function calendarBlockLaneStyle({
  offsetFraction,
  widthFraction,
  zIndex,
  px
}: TimeBlockLane, railPx = 0): CSSProperties {
  return {
    ...(px ? calendarBlockLanePxInsets(px, railPx) : calendarBlockLaneInsets({ offsetFraction, widthFraction }, railPx)),
    zIndex: 2 + zIndex
  };
}

function calendarBlockDetailsLabel(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  _durationSeconds: number,
  day: Date,
  capturedNow: Date,
  clock: ClockFormat,
  /** "Part 2 of 3 of School run.": a named pattern's part (location v3 PR 14b). */
  partOf?: string
) {
  const details = calendarEntrySliceDetails(entry, draft, day, capturedNow);
  const displayEntry = {
    ...entry,
    startedAt: draft?.startedAt ?? entry.startedAt,
    stoppedAt: draft?.stoppedAt ?? entry.stoppedAt
  };
  const tags = entry.tagNames.length ? ` All tags: ${entry.tagNames.join(", ")}.` : "";
  return `${calendarBlockPrimaryLine(displayEntry)}. ${calendarBlockSecondaryLine(displayEntry, capturedNow, clock)}.${tags}${partOf ? ` ${partOf}` : ""}${details.continuation ? ` ${details.continuation}` : ""}`;
}

function calendarEntrySliceDetails(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  day: Date,
  capturedNow: Date
) {
  const entryStart = new Date(draft?.startedAt ?? entry.startedAt);
  const entryEnd = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : capturedNow;
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const visibleEnd = new Date(Math.min(entryEnd.getTime(), dayEnd.getTime()));
  const isLiveSlice = !entry.stoppedAt && visibleEnd.getTime() >= capturedNow.getTime();
  return {
    continuation: [
      entryStart < dayStart ? "Continues from the previous day." : "",
      entryEnd > dayEnd ? "Continues into the next day." : ""
    ].filter(Boolean).join(" "),
    durationSeconds: entryOverlapSeconds({
      startedAt: entryStart.toISOString(),
      stoppedAt: entryEnd.toISOString()
    }, { start: dayStart, end: dayEnd }, capturedNow),
    isLiveSlice
  };
}

function calendarDurationSeconds(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  day: Date,
  capturedNow: Date
) {
  return calendarEntrySliceDetails(entry, draft, day, capturedNow).durationSeconds;
}

function formatCalendarWeekday(day: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day);
}

function dayBodyPointHitsSemanticBlock(dayBody: HTMLElement, clientX: number, clientY: number) {
  const blocks = Array.from(
    dayBody.querySelectorAll<HTMLElement>("[data-calendar-block-key]")
  ).map((block) => {
    const rect = block.getBoundingClientRect();
    return {
      height: Number(block.dataset.calendarSemanticHeight),
      left: rect.left,
      right: rect.right,
      top: Number(block.dataset.calendarSemanticTop)
    };
  }).filter((block) => Number.isFinite(block.top) && Number.isFinite(block.height));
  return calendarPointHitsSemanticBlock({
    blocks,
    clientX,
    clientY,
    dayBodyTop: dayBody.getBoundingClientRect().top
  });
}

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function snapCalendarMinutes(value: number) {
  return Math.round(value / calendarSnapMinutes) * calendarSnapMinutes;
}

function clampMinutes(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * An axis mark or a dragged edge in this browser's clock format. In 12-hour mode a whole-hour axis
 * mark is "9 AM" (the day's end reads "12 AM"); `exact` (resize tips, the create ghost) always keeps
 * the minutes.
 */
function formatCalendarAxisMinutes(minutes: number, clock: ClockFormat, exact = false) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  if (clock === "12h" && minute === 0 && !exact) return formatClockHour(hour, clock);
  return formatClockParts(hour, minute, clock);
}

/** The hour label whose text the now pill covers, as drawn (#255), or null when every label is clear. */
function axisLabelUnderNowPill(axis: HTMLElement): string | null {
  const pill = axis.querySelector(".calendar-now-pill")?.getBoundingClientRect();
  if (!pill || pill.width <= 0 || pill.height <= 0) return null;
  for (const label of axis.querySelectorAll<HTMLElement>("[data-axis-label]")) {
    // The text's own (inline) box, not the full-width label row.
    const text = label.firstElementChild?.getBoundingClientRect();
    if (text && text.width > 0 && rectsOverlap(text, pill)) return label.dataset.axisLabel ?? null;
  }
  return null;
}

function rectsOverlap(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function clampAxisLabelTop(top: number, height: number) {
  return Math.min(Math.max(0, height - calendarAxisLabelHeight), Math.max(0, top - calendarAxisLabelHeight / 2));
}

function formatCalendarDateKey(day: Date) {
  return [
    day.getFullYear(),
    (day.getMonth() + 1).toString().padStart(2, "0"),
    day.getDate().toString().padStart(2, "0")
  ].join("-");
}

function isoForDateMinutes(day: Date, minutes: number) {
  const target = new Date(day);
  const clampedMinutes = Math.max(0, Math.round(minutes));
  target.setHours(0, clampedMinutes, 0, 0);
  const localTime = `${target.getHours().toString().padStart(2, "0")}:${target.getMinutes().toString().padStart(2, "0")}`;
  const iso = dateTimeLocalInputToIso(`${formatCalendarDateKey(target)}T${localTime}`);
  if (!iso) throw new Error("Invalid calendar time.");
  return iso;
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfDay(input: Date) {
  return new Date(input.getFullYear(), input.getMonth(), input.getDate());
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function entryOverlapsDay(entry: TimeEntryRow, day: Date, capturedNow: Date) {
  const start = startOfDay(day);
  return entryOverlapSeconds(entry, { start, end: addDays(start, 1) }, capturedNow) > 0;
}

function calendarCreateTargetKind(
  target: EventTarget | null,
  dayBody: HTMLElement
): CalendarCreateTargetKind {
  if (!(target instanceof Element) || target.closest("[data-calendar-day-body]") !== dayBody) {
    return "other";
  }
  if (target.closest("[data-calendar-draft]")) return "draft";
  if (target.closest(".swiss-resize-handle")) return "resize";
  if (target.closest("[data-calendar-block-key]")) return "entry";
  if (target.closest("button, a, input, select, textarea, [role='button']")) return "action";
  // The future zone is empty day-body time that only carries the not-allowed cursor.
  return target === dayBody || (target.parentElement === dayBody && target.hasAttribute("data-calendar-future-zone"))
    ? "day-body"
    : "other";
}

const NO_DAY_KEYS: readonly string[] = [];

/** The List's days, newest first, up to today (none after it). */
function timelineDayKeys(range: { start: Date; end: Date }, todayKey: string | null) {
  const days: string[] = [];
  for (let day = range.start; day < range.end; day = addDays(day, 1)) {
    const key = toTimelineDateKey(day);
    if (todayKey && key > todayKey) break;
    days.push(key);
  }
  return days.reverse();
}

/** A day key's local day. */
function timelineDayRange(key: string) {
  const start = startOfDay(new Date(`${key}T12:00:00`));
  return { start, end: addDays(start, 1) };
}
