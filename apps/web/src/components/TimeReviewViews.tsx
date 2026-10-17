"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { analyzeTimeIntervals, calendarBlockContinuationEdges, formatClockHour, formatClockParts, type ClockFormat } from "@dayframe/shared";
import { useClockFormat } from "@/components/ClockFormat";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { CalendarEntryCompactEditor } from "@/components/CalendarEntryCompactEditor";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { deletedToastLabel } from "@/lib/blocks-toast-copy";
import { useTripOptOut } from "@/components/blocks/useTripOptOut";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { OverlapNotice } from "@/components/OverlapNotice";
import { EntriesTable } from "@/components/EntriesTable";
import { useTimelineDeleteUndo } from "@/components/useTimelineDeleteUndo";
import { IconButton, SegmentedControl } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
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
  calendarBlockLaneInsets,
  calendarBlockPrimaryParts,
  calendarBlockPrimaryLine,
  calendarBlockSecondaryLine,
  calendarBlockVisualGeometry,
  canShowTimeBlockInlineAction,
  getTimeBlockDensity,
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

type CalendarHoursMode = "fullDay";

/** Half the now pill's height (11 px text + 2 px padding each side), for clamping it inside the axis. */
const NOW_PILL_HALF_HEIGHT = 10;
// Owner decision 12 Oct 2026 (option B): Calendar creates past time only, and says so.
const CALENDAR_FUTURE_CREATE_NOTICE = "Blocks can't start in the future";
const CALENDAR_CREATE_NOTICE_MS = 3_000;
const CALENDAR_CREATE_NOTICE_EXIT_MS = 160;

const viewItems: Array<{ id: TimelineView; label: string; icon: ReactNode }> = [
  { id: "calendar", label: "Calendar", icon: <DayframeIcon glyph="calendar-days" size={16}/> },
  { id: "list", label: "List", icon: <DayframeIcon glyph="list" size={16}/> }
];

const scopeItems: Array<{ id: TimelineScope; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" }
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
  const timelineEntryIds = new Set([...dayEntries, ...weekEntries].map((entry) => entry.id));
  const {
    error: deleteError,
    hiddenEntryIds,
    pendingNotice,
    requestDelete,
    retryFailedDelete,
    dismissDeleteError,
    undoPendingDelete
  } = useTimelineDeleteUndo({ entryIds: timelineEntryIds, onSynced: refreshData });
  const [deletedEntrySwatch, setDeletedEntrySwatch] = useState<CSSProperties | undefined>(undefined);
  // One automatic Move deleted: offer "Don't log trips like this" (PRD D19, A4).
  const [deletedMoveEventId, setDeletedMoveEventId] = useState<string | null>(null);
  const tripOptOut = useTripOptOut(deletedMoveEventId, pendingNotice?.token);
  const requestTimelineDelete = useCallback((entries: readonly TimeEntryRow[]) => {
    const first = entries[0];
    setDeletedEntrySwatch(first?.categoryId ? activityBlockStyle(first.categoryColor, first.categoryName ?? "") : undefined);
    setDeletedMoveEventId(entries.length === 1 ? first?.automaticMoveEventId ?? null : null);
    requestDelete({ entries, label: timelineDeleteNoticeLabel(entries) });
  }, [requestDelete]);
  const visibleDayEntries = dayEntries.filter((entry) => !hiddenEntryIds.has(entry.id));
  const visibleWeekEntries = weekEntries.filter((entry) => !hiddenEntryIds.has(entry.id));
  const activeEntries = state.scope === "day" ? visibleDayEntries : visibleWeekEntries;
  const dayAnalysis = analyzeTimeIntervals(
    visibleDayEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    { range: ranges.day, now: capturedNow }
  );
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
  const dayReportFrom = toTimelineDateKey(ranges.day.start);
  const dayReportTo = toTimelineDateKey(addDays(ranges.day.end, -1));
  const weekReportFrom = toTimelineDateKey(ranges.week.start);
  const weekReportTo = toTimelineDateKey(addDays(ranges.week.end, -1));

  const headModel = calendarHeadModel({
    dayLoggedSeconds: dayAnalysis.totalLoggedSeconds,
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
      <CalendarHead
        dayReportHref={reportsHrefForCustomRange(dayReportFrom, dayReportTo)}
        disabled={isDateLoading}
        model={headModel}
        onSelectDay={(date) => void navigate({ date })}
        weekReportHref={reportsHrefForCustomRange(weekReportFrom, weekReportTo)}
      />
      <section
        className="timeline-range-toolbar"
        aria-busy={isDateLoading}
        aria-label="Calendar period and view controls"
      >
        <div className="timeline-range-navigation">
          <IconButton
            disabled={isDateLoading}
            label={`Previous ${state.scope}`}
            onClick={() => navigate(shiftTimelineState(state, "previous"))}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <DatePickerPopover
            disabled={isDateLoading}
            label={periodLabel}
            onChange={(date) => void navigate({ date })}
            portal
            portalAlign="center"
            today={todayKey ?? state.date}
            value={state.date}
          />
          <IconButton
            disabled={isDateLoading}
            label={`Next ${state.scope}`}
            onClick={() => navigate(shiftTimelineState(state, "next"))}
          >
            <ChevronRight size={18} />
          </IconButton>
          {showsToday ? null : (
            <button
              className="timeline-today-button"
              disabled={isDateLoading}
              onClick={() => void navigate({ date: todayKey })}
              type="button"
            >
              Today
            </button>
          )}
        </div>

        <div className="timeline-range-controls">
          <SegmentedControl
            ariaLabel="Calendar view"
            onChange={updateView}
            options={viewItems.map((item) => ({
              value: item.id,
              label: item.label,
              icon: item.icon,
              disabled: isDateLoading
            }))}
            value={state.view}
          />
          <SegmentedControl
            ariaLabel="Calendar scope"
            onChange={updateScope}
            options={scopeItems.map((item) => ({
              value: item.id,
              label: item.label,
              disabled: isDateLoading
            }))}
            value={state.scope}
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
            reviewItems={data.reviewItems}
            scrollContainerRef={registerScrollContainer}
            tags={data.tags}
            todayKeyHint={initialTodayKey}
            undoToastVisible={Boolean(pendingNotice)}
            visibleDays={state.scope === "day" ? [ranges.day.start] : ranges.weekDays}
          />
        ) : null}
        {state.view === "list" ? (
          <EntriesTable
            capturedNow={capturedNow}
            entries={activeEntries}
            categories={data.categories}
            displayRange={ranges.active}
            onDeleteEntries={requestTimelineDelete}
            groupByDay
            onChanged={refreshData}
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
        // A refused delete is the toast's error variant, with Try again (WUI-027).
        <BlocksToast
          actionLabel="Try again"
          message={deleteError}
          onAction={retryFailedDelete}
          secondary={{ label: "Dismiss", onAction: dismissDeleteError }}
          tone="error"
        />
      ) : null}
    </section>
  );
}


function timelineDeleteNoticeLabel(entries: readonly TimeEntryRow[]) {
  return deletedToastLabel(entries.length, entries[0] ? timeEntryTitle(entries[0]) : null);
}

type TimelineScrollPosition = { left: number; top: number };

export function CalendarReview({
  calendarHoursMode,
  capturedNow,
  categories,
  entries,
  hasRememberedScroll,
  onDeleteEntries,
  onScroll,
  onSynced,
  reviewItems = [],
  scrollContainerRef,
  tags,
  todayKeyHint = null,
  undoToastVisible = false,
  visibleDays
}: {
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
  /** Open Review items; suggestions with a full window show as hatched blocks in a right-hand lane. */
  reviewItems?: readonly ReviewItemRow[];
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  tags: BootstrapData["tags"];
  /** Before hydration, today's date key as the server saw it in the viewer's zone (null: none). */
  todayKeyHint?: string | null;
  /** The Timeline's Delete Undo toast is up: it keeps the toast place, so Calendar notices are only announced. */
  undoToastVisible?: boolean;
  visibleDays: Date[];
}) {
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
  const gridReviewItems = localTimeReady ? reviewItems : NO_REVIEW_ITEMS;
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

  async function continueCalendarEntry(entry: TimeEntryRow, surface: "editor" | "inline" = "editor") {
    if (continuingEntryId || isTimerBusy || !entry.stoppedAt) {
      const outcome = { ok: false, error: "A block update is already in progress." } as const;
      if (surface === "inline") setActionError(outcome.error);
      return outcome;
    }
    setContinuingEntryId(entry.id);
    if (surface === "inline") setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) {
        clearTimerError();
        if (surface === "inline") setActionError(outcome.error);
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
          target.anchor.querySelector<HTMLButtonElement>(".calendar-entry-primary")?.focus({ preventScroll: true });
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
      body: JSON.stringify({
        categoryId: entry.categoryId,
        placeId: entry.placeId,
        description: entry.description,
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

  return (
    <section className="timeline-calendar-workspace">
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
          style={{ gridTemplateColumns: `104px repeat(${visibleDays.length}, minmax(130px, 1fr))` }}
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

          <div className="calendar-time-axis" style={{ height: calendarHeight }}>
            {localTimeReady && visibleDays.some(isToday) ? (
              <span
                aria-hidden="true"
                className="calendar-now-pill"
                // Clamped so the pill stays inside the axis at midnight and at the day's end; the
                // line keeps the exact time.
                style={{ top: Math.min(calendarHeight - NOW_PILL_HALF_HEIGHT, Math.max(NOW_PILL_HALF_HEIGHT, Math.round(((minutesFromDate(capturedNow) - calendarHours.startHour * 60) / 60) * rowHeight))) }}
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
                  className="tabular absolute left-0 right-0 px-2 pt-1 text-xs text-[var(--muted)]"
                  style={{ top: mark.labelTop }}
                >
                  {mark.label}
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
                  style={{ top: Math.round(((minutesFromDate(capturedNow) - calendarHours.startHour * 60) / 60) * rowHeight) }}
                />
              ) : null}
              {pendingReviewSpans(gridReviewItems, startOfDay(day).getTime(), addDays(startOfDay(day), 1).getTime(), capturedNow.getTime()).map((item) => {
                const geometry = calendarBlockStyle(
                  { startedAt: new Date(item.fromMs).toISOString(), stoppedAt: new Date(item.toMs).toISOString() },
                  null,
                  day,
                  rowHeight,
                  calendarHeight,
                  calendarHours,
                  capturedNow
                );
                if (!geometry) return null;
                const range = `${formatTime(new Date(item.fromMs), clock)} to ${formatTime(new Date(item.toMs), clock)}`;
                return (
                  <Link
                    aria-label={`${item.title}, needs review, ${range}. Open Review.`}
                    className={`calendar-review-block${item.color ? " df-block" : ""}`}
                    href={`/review#review-${item.id}`}
                    key={`review:${item.id}`}
                    tabIndex={visibleSelectedTarget ? -1 : undefined}
                    onClick={(event) => {
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
                      ...(item.color ? activityBlockStyle(item.color, item.name) : {}),
                      top: geometry.top,
                      height: Math.max(14, geometry.height - 2)
                    }}
                  >
                    {geometry.height >= 30 ? <b>{item.title}</b> : null}
                  </Link>
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
                    style={geometry}
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
                      height: geometry.height,
                      top: geometry.top,
                      zIndex: 1
                    }}
                  />
                );
              })() : null}
              {(() => {
                const blocks = gridEntries
                  .filter((entry) => entryOverlapsDay(entry, day, capturedNow))
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
                      height: semanticBlockPositionStyle.height
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
                const lanes = layoutTimeBlockLanes(blocks.map((block) => ({
                  key: block.blockKey,
                  top: block.semanticBlockPositionStyle.top,
                  height: block.semanticBlockPositionStyle.height
                })));

                return blocks.map((block) => {
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
                  const detailsLabel = calendarBlockDetailsLabel(entry, activeDraft, durationSeconds, day, capturedNow, clock);
                  const lane = lanes.get(blockKey) ?? {
                    laneCount: 1,
                    laneIndex: 0,
                    mode: "full",
                    offsetFraction: 0,
                    widthFraction: 1,
                    zIndex: 0,
                    textDensity: "full"
                  } satisfies TimeBlockLane;
                  const selected = visibleSelectedTarget?.kind === "entry" && visibleSelectedTarget.blockKey === blockKey;
                  const isResizing = resizingId === entry.id;
                  const isContinuing = continuingEntryId === entry.id;
                  const accent = timeEntryAccentColor(entry);
                  const displayEntry = {
                    ...entry,
                    startedAt: activeDraft?.startedAt ?? entry.startedAt,
                    stoppedAt: activeDraft?.stoppedAt ?? entry.stoppedAt
                  };
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
                        entry.categoryId ? "df-block" : "is-uncategorized",
                        lane.textDensity === "none" ? "has-no-text is-compact-overlap" : "",
                        hasInlineActionSlot ? "has-inline-action-slot" : "",
                        ...timeBlockDensityClassNames(density)
                      ].join(" ")}
                      style={{
                        ...blockPositionStyle,
                        ...calendarBlockLaneStyle(lane),
                        // Blocks: a solid activity fill with its measured on-block text colour.
                        ...(entry.categoryId ? activityBlockStyle(entry.categoryColor, entry.categoryName ?? "") : {}),
                        "--calendar-block-accent": accent,
                        "--calendar-block-fill": entry.categoryId ? "var(--block)" : `color-mix(in srgb, ${accent} 18%, var(--surface))`,
                        "--calendar-block-selected-fill": entry.categoryId ? "var(--block)" : `color-mix(in srgb, ${accent} 26%, var(--surface-inset))`,
                        "--calendar-block-border": entry.categoryId ? "transparent" : `color-mix(in srgb, ${accent} 42%, var(--line))`,
                        color: entry.categoryId ? "var(--on-block)" : "var(--foreground)"
                      } as CSSProperties}
                      data-entry-id={entry.id}
                      data-calendar-block-key={blockKey}
                      data-calendar-semantic-height={block.semanticBlockPositionStyle.height}
                      data-calendar-semantic-top={block.semanticBlockPositionStyle.top}
                      data-overlap-layout={lane.mode}
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
                        {density.showCombinedPrimary && lane.textDensity !== "none" ? (
                          <CalendarBlockPrimaryLine entry={displayEntry} />
                        ) : null}
                        {density.showSecondary && lane.textDensity !== "none" ? (
                          <span className="calendar-entry-secondary-line tabular">
                            {calendarBlockSecondaryLine(displayEntry, capturedNow, clock)}
                          </span>
                        ) : null}
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
                    </article>
                  );
                });
              })()}
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
          isTimerBusy={isTimerBusy}
          mode="entry"
          onCreateCategory={createCategory}
          onDelete={() => deleteCalendarEntry(selectedEntry)}
          onDismiss={({ restoreFocus }) => dismissCalendarEditor(visibleSelectedTarget, restoreFocus)}
          onOutsidePointerDown={(pointer) => consumeCalendarEditorPointer(visibleSelectedTarget, pointer)}
          onSave={(plan) => saveCalendarEditor(selectedEntry, plan)}
          onStartAgain={() => continueCalendarEntry(selectedEntry)}
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
        <div className="border-t border-[var(--line)] px-4 py-2">
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
        <p className="border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--danger-text)]" role="alert">
          {resizeError}
        </p>
      ) : null}
      {actionError ? (
        <BlocksToast actionLabel="Dismiss" message={actionError} onAction={() => setActionError(null)} tone="error" />
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

function CalendarBlockPrimaryLine({
  entry
}: {
  entry: Parameters<typeof calendarBlockPrimaryParts>[0];
}) {
  const { category, description, firstTag, hiddenTagCount } = calendarBlockPrimaryParts(entry);
  return (
    <span className="calendar-entry-primary-line">
      <span className="calendar-entry-description">{description}</span>
      {category || firstTag ? (
        <span className="calendar-entry-primary-metadata">
          {category ? (
            <>
              <span className="calendar-entry-separator"> · </span>
              <span className="calendar-entry-category">{category}</span>
            </>
          ) : null}
          {firstTag ? (
            <>
              <span className="calendar-entry-separator"> · </span>
              <span className="calendar-entry-tag">#{firstTag}</span>
              {hiddenTagCount ? <span className="calendar-entry-tag-count"> +{hiddenTagCount}</span> : null}
            </>
          ) : null}
        </span>
      ) : null}
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
  const minimumHeight = minimumTimeBlockHeight(rowHeight);
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

function calendarBlockKey(entryId: string, day: Date) {
  return `${entryId}:${formatCalendarDateKey(day)}`;
}

function calendarBlockLaneStyle({
  offsetFraction,
  widthFraction,
  zIndex
}: TimeBlockLane): CSSProperties {
  return {
    ...calendarBlockLaneInsets({ offsetFraction, widthFraction }),
    zIndex: 2 + zIndex
  };
}

function calendarBlockDetailsLabel(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  _durationSeconds: number,
  day: Date,
  capturedNow: Date,
  clock: ClockFormat
) {
  const details = calendarEntrySliceDetails(entry, draft, day, capturedNow);
  const displayEntry = {
    ...entry,
    startedAt: draft?.startedAt ?? entry.startedAt,
    stoppedAt: draft?.stoppedAt ?? entry.stoppedAt
  };
  const tags = entry.tagNames.length ? ` All tags: ${entry.tagNames.join(", ")}.` : "";
  return `${calendarBlockPrimaryLine(displayEntry)}. ${calendarBlockSecondaryLine(displayEntry, capturedNow, clock)}.${tags}${details.continuation ? ` ${details.continuation}` : ""}`;
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
