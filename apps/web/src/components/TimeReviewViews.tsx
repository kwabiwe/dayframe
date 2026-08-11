"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, List, Play, Table2 } from "lucide-react";
import { analyzeTimeIntervals, calendarBlockContinuationEdges } from "@dayframe/shared";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { CalendarEntryCompactEditor } from "@/components/CalendarEntryCompactEditor";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { OverlapNotice } from "@/components/OverlapNotice";
import { EntriesTable } from "@/components/EntriesTable";
import { useTimelineDeleteUndo } from "@/components/useTimelineDeleteUndo";
import { IconButton, SegmentedControl } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  timeEntryAccentColor,
  timeEntryCategoryColor,
  timeEntryCategoryLabel,
  timeEntryTitle
} from "@/lib/display";
import type { BootstrapData, CategoryRow, PlaceRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocalInputToIso,
  formatDate,
  formatCompactHoursMinutes,
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
  buildTimelineTimesheetRows,
  clipTimelineEntries,
  mergeTimelineEntries,
  timelineDailyTotals
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
import type {
  CalendarEntryCompactCreatePlan,
  CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import {
  calculateCalendarClickCreateSlot,
  calculateCalendarDraftAnchorGeometry,
  calendarCreatePointerSequenceAccepted,
  calendarPointHitsSemanticBlock,
  calendarPointerMatchesConsumed,
  isEligibleCalendarCreatePointer,
  type CalendarConsumedPointer,
  type CalendarCreatePointerSequence,
  type CalendarCreateTargetKind
} from "@/lib/calendar-click-create";

type CalendarHoursMode = "fullDay";

const viewItems: Array<{ id: TimelineView; label: string; icon: ReactNode }> = [
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={16} /> },
  { id: "list", label: "List", icon: <List size={16} /> },
  { id: "timesheet", label: "Timesheet", icon: <Table2 size={16} /> }
];

const scopeItems: Array<{ id: TimelineScope; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" }
];

const calendarHourModes: Record<CalendarHoursMode, { label: string; startHour: number; endHour: number }> = {
  fullDay: { label: "24h", startHour: 0, endHour: 24 }
};
const calendarSnapMinutes = 15;
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

export function TimeReviewViews({
  initialData,
  initialPreference
}: {
  initialData: BootstrapData;
  initialPreference: TimelinePreference | null;
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
  const capturedNow = useMemo(() => new Date(presentationNow), [presentationNow]);
  const calendarHoursMode: CalendarHoursMode = "fullDay";
  const preferenceRef = useRef<TimelinePreference | null>(initialPreference);
  const scrollPositionsRef = useRef<Record<TimelineView, TimelineScrollPosition>>({
    calendar: { left: 0, top: 0 },
    list: { left: 0, top: 0 },
    timesheet: { left: 0, top: 0 }
  });
  const activeScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineStateRef = useRef(state);
  const navigateRef = useRef<(overrides: Partial<TimelineState>) => Promise<void>>(async () => undefined);
  const todayKeyRef = useRef(toTimelineDateKey(new Date()));

  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const registerScrollContainer = useCallback((element: HTMLDivElement | null) => {
    activeScrollContainerRef.current = element;
  }, []);

  const rememberScrollPosition = useCallback((view: TimelineView, event: UIEvent<HTMLDivElement>) => {
    scrollPositionsRef.current[view] = {
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop
    };
  }, []);

  const persistPreference = useCallback((nextState: Pick<TimelineState, "scope" | "view">) => {
    const nextPreference = updateTimelinePreference(preferenceRef.current, nextState);
    preferenceRef.current = nextPreference;
    document.cookie = `${TIMELINE_PREFERENCE_COOKIE}=${timelinePreferenceCookieValue(nextPreference)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  useEffect(() => {
    persistPreference(preferenceState);
  }, [persistPreference, preferenceState]);

  useEffect(() => {
    if (!hasRunningEntry) return undefined;
    const interval = window.setInterval(() => setPresentationNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [hasRunningEntry]);

  useLayoutEffect(() => {
    const container = activeScrollContainerRef.current;
    if (!container) return;
    const position = scrollPositionsRef.current[state.view];
    container.scrollLeft = position.left;
    container.scrollTop = position.top;
  }, [state.date, state.scope, state.view]);

  async function navigate(overrides: Partial<typeof state>) {
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
    window.history.pushState(null, "", href);
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

    const reconcileToday = () => {
      if (document.visibilityState !== "visible") {
        scheduleRollover();
        return;
      }
      const now = new Date();
      const previousTodayKey = todayKeyRef.current;
      const currentTodayKey = toTimelineDateKey(now);
      todayKeyRef.current = currentTodayKey;
      writeTimelineTodaySessionKey(currentTodayKey);
      if (currentTodayKey !== previousTodayKey) {
        setPresentationNow(now.getTime());
        const currentState = timelineStateRef.current;
        if (shouldAdvanceStaleTimelineToToday(currentState, previousTodayKey, now)) {
          void navigateRef.current(resetTimelineState(currentState, now));
        }
      }
      scheduleRollover();
    };

    const handleFocus = () => reconcileToday();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileToday();
    };
    const storedTodayKey = readTimelineTodaySessionKey();
    if (storedTodayKey) todayKeyRef.current = storedTodayKey;
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
      scope: view === "timesheet" ? "week" : preferenceRef.current?.preferredScope ?? state.scope
    });
  }

  function updateScope(scope: TimelineScope) {
    if (isDateLoading) return;
    if (state.view === "timesheet" && scope === "day") return;
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
    undoPendingDelete
  } = useTimelineDeleteUndo({ entryIds: timelineEntryIds, onSynced: refreshData });
  const requestTimelineDelete = useCallback((entries: readonly TimeEntryRow[]) => {
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
  const periodLabel = formatTimelinePeriodLabel(state.scope, ranges, capturedNow);
  const todayKey = toTimelineDateKey(capturedNow);
  const dayReportFrom = toTimelineDateKey(ranges.day.start);
  const dayReportTo = toTimelineDateKey(addDays(ranges.day.end, -1));
  const weekReportFrom = toTimelineDateKey(ranges.week.start);
  const weekReportTo = toTimelineDateKey(addDays(ranges.week.end, -1));
  const dayTotalLabel = formatCompactHoursMinutes(dayAnalysis.totalLoggedSeconds);
  const weekTotalLabel = formatCompactHoursMinutes(weekAnalysis.totalLoggedSeconds);

  return (
    <section className="timeline-workspace">
      <section
        className="timeline-range-toolbar"
        aria-busy={isDateLoading}
        aria-label="Timeline period and view controls"
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
            today={todayKey}
            value={state.date}
          />
          <IconButton
            disabled={isDateLoading}
            label={`Next ${state.scope}`}
            onClick={() => navigate(shiftTimelineState(state, "next"))}
          >
            <ChevronRight size={18} />
          </IconButton>
        </div>

        <nav className="timeline-range-totals" aria-label="Open Timeline totals in Reports">
          <Link
            aria-label={`Open Day report for ${dayReportFrom}, total ${dayTotalLabel}`}
            href={reportsHrefForCustomRange(dayReportFrom, dayReportTo)}
          >
            <span>Day</span>
            <strong className="tabular">{dayTotalLabel}</strong>
          </Link>
          <Link
            aria-label={`Open Week report for ${weekReportFrom} to ${weekReportTo}, total ${weekTotalLabel}`}
            href={reportsHrefForCustomRange(weekReportFrom, weekReportTo)}
          >
            <span>Week</span>
            <strong className="tabular">{weekTotalLabel}</strong>
          </Link>
        </nav>

        <div className="timeline-range-controls">
          <SegmentedControl
            ariaLabel="Timeline view"
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
            ariaLabel="Timeline scope"
            onChange={updateScope}
            options={scopeItems.map((item) => ({
              value: item.id,
              label: item.label,
              disabled: isDateLoading || (state.view === "timesheet" && item.id === "day")
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
      {deleteError ? (
        <p className="timeline-delete-error" role="alert">
          {deleteError}
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
            onSynced={refreshData}
            scrollContainerRef={registerScrollContainer}
            tags={data.tags}
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
        {state.view === "timesheet" ? (
          <TimesheetView
            capturedNow={capturedNow}
            entries={visibleWeekEntries}
            onScroll={(event) => rememberScrollPosition("timesheet", event)}
            scrollContainerRef={registerScrollContainer}
            weekDays={ranges.weekDays}
          />
        ) : null}
      </div>
      {pendingNotice ? (
        <TimelineDeleteUndoNotice
          isExiting={pendingNotice.isExiting}
          notice={pendingNotice}
          onUndo={undoPendingDelete}
        />
      ) : null}
    </section>
  );
}

function TimelineDeleteUndoNotice({
  isExiting,
  notice,
  onUndo
}: {
  isExiting: boolean;
  notice: { label: string; token: number };
  onUndo: () => void;
}) {
  const undoRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isExiting) return;
    const frame = window.requestAnimationFrame(() => undoRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isExiting, notice.token]);

  return (
    <div
      className={`timeline-delete-undo${isExiting ? " is-exiting" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{notice.label}</span>
      <button ref={undoRef} disabled={isExiting} type="button" onClick={onUndo}>Undo</button>
    </div>
  );
}

function timelineDeleteNoticeLabel(entries: readonly TimeEntryRow[]) {
  const entry = entries[0];
  if (!entry) return "Time entry deleted";
  const title = `“${timeEntryTitle(entry)}”`;
  return entries.length > 1
    ? `${entries.length} ${title} occurrences deleted`
    : `${title} deleted`;
}

type TimelineScrollPosition = { left: number; top: number };

export function CalendarReview({
  calendarHoursMode,
  capturedNow,
  categories,
  entries,
  onDeleteEntries,
  onScroll,
  onSynced,
  scrollContainerRef,
  tags,
  visibleDays
}: {
  calendarHoursMode: CalendarHoursMode;
  capturedNow: Date;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  onDeleteEntries: (entries: readonly TimeEntryRow[]) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onSynced: () => Promise<void>;
  places?: PlaceRow[];
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  tags: BootstrapData["tags"];
  visibleDays: Date[];
}) {
  const router = useRouter();
  const {
    clearTimerError,
    createCategory,
    createManualEntry,
    isTimerBusy,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();
  const [, startTransition] = useTransition();
  const [selectedTarget, setSelectedTarget] = useState<CalendarEditorTarget | null>(null);
  const selectedTargetRef = useRef<CalendarEditorTarget | null>(null);
  const selectionSessionRef = useRef(0);
  const createPointerSequenceRef = useRef<CalendarCreatePointerSequence | null>(null);
  const consumedPointerRef = useRef<CalendarConsumedPointer | null>(null);
  const [resizeDraft, setResizeDraft] = useState<CalendarResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<CalendarZoom>("hour");
  const [calendarScroller, setCalendarScroller] = useState<HTMLDivElement | null>(null);
  const today = capturedNow;
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
        label: formatCalendarAxisMinutes(minutes),
        labelTop: clampAxisLabelTop(top, calendarHeight),
        major: minutes % 60 === 0,
        top
      };
    });
  }, [calendarHeight, calendarHours.endHour, calendarHours.startHour, rowHeight, zoom.intervalMinutes]);
  const visibleDaysKey = visibleDays.map(formatCalendarDateKey).join("|");
  const selectionScopeKey = `${calendarHoursMode}:${visibleDaysKey}`;
  const visibleSelectedTarget = selectedTarget?.scopeKey === selectionScopeKey ? selectedTarget : null;
  const selectedEntry = visibleSelectedTarget?.kind === "entry"
    ? entries.find((entry) => entry.id === visibleSelectedTarget.entryId) ?? null
    : null;
  const registerCalendarScroller = useCallback((element: HTMLDivElement | null) => {
    setCalendarScroller(element);
    scrollContainerRef(element);
  }, [scrollContainerRef]);

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

  function createCalendarDraft(day: Date, slot: NonNullable<ReturnType<typeof calculateCalendarClickCreateSlot>>) {
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
      const outcome = { ok: false, error: "A timer update is already in progress." } as const;
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
        let message = `Unable to save this entry: ${response.status}`;
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
      return { ok: false, error: "Unable to save this entry. Check your connection and try again." } as const;
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

    if (!response.ok) throw new Error(`Unable to resize entry: ${response.status}`);
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

    event.currentTarget.setPointerCapture(event.pointerId);

    const updateDraft = (clientY: number) => {
      const relativeY = clientY - columnRect.top;
      const rawMinutes = timelineStart + (relativeY / rowHeight) * 60;
      const snappedMinutes = clampMinutes(snapCalendarMinutes(rawMinutes), timelineStart, timelineEnd);
      const nextStartMinutes =
        edge === "start" ? clampMinutes(snappedMinutes, timelineStart, originalEnd - 15) : originalStart;
      const nextEndMinutes =
        edge === "end" ? clampMinutes(snappedMinutes, originalStart + 15, timelineEnd) : originalEnd;
      finalDraft = {
        entryId: entry.id,
        startedAt: edge === "start" ? isoForDateMinutes(day, nextStartMinutes) : entry.startedAt,
        stoppedAt: edge === "end" ? isoForDateMinutes(day, nextEndMinutes) : entry.stoppedAt as string
      };
      setResizeDraft(finalDraft);
    };

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
      updateDraft(moveEvent.clientY);
    };
    const cancelResize = () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);
      setResizeDraft(null);
    };
    const stopResize = async () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);

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
    })) {
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
    dayBody.setPointerCapture(event.pointerId);
  }

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
    const semanticBlocks = Array.from(
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
    if (calendarPointHitsSemanticBlock({
      blocks: semanticBlocks,
      clientX: event.clientX,
      clientY: event.clientY,
      dayBodyTop: dayBodyRect.top
    })) {
      return;
    }

    const slot = calculateCalendarClickCreateSlot({
      clientY: event.clientY,
      day,
      dayBodyRect,
      endHour: calendarHours.endHour,
      now: new Date(),
      rowHeight,
      startHour: calendarHours.startHour
    });
    if (slot) createCalendarDraft(day, slot);
  }

  function cancelCalendarCreatePointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (createPointerSequenceRef.current?.pointerId === event.pointerId) {
      createPointerSequenceRef.current = null;
    }
  }

  return (
    <section className="timeline-calendar-workspace">
      <div
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
              entries.map((entry) => ({
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
                  sameDay(day, today) ? "is-today" : ""
                ].join(" ")}
              >
                <div className="calendar-day-date text-sm font-semibold">{formatDate(day)}</div>
                <div
                  aria-label={`${loggedLabel} logged`}
                  className="calendar-day-total tabular text-xs text-[var(--muted)]"
                >
                  {loggedLabel}
                </div>
              </div>
            );
          })}

          <div className="calendar-time-axis" style={{ height: calendarHeight }}>
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
          {visibleDays.map((day) => (
            <div
              key={`${day.toISOString()}-body`}
              data-calendar-day-body
              data-calendar-day-key={formatCalendarDateKey(day)}
              className="calendar-day-body"
              onLostPointerCapture={cancelCalendarCreatePointer}
              onPointerCancel={cancelCalendarCreatePointer}
              onPointerDown={(event) => startCalendarCreatePointer(day, event)}
              onPointerUp={(event) => finishCalendarCreatePointer(day, event)}
              style={{
                height: calendarHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${Math.max(0, gridLineSpacing - 1)}px, var(--line) ${gridLineSpacing}px)`
              }}
            >
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
                const blocks = entries
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
                  const detailsLabel = calendarBlockDetailsLabel(entry, activeDraft, durationSeconds, day, capturedNow);
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
                        entry.categoryId ? "" : "is-uncategorized",
                        lane.textDensity === "none" ? "has-no-text is-compact-overlap" : "",
                        hasInlineActionSlot ? "has-inline-action-slot" : "",
                        ...timeBlockDensityClassNames(density)
                      ].join(" ")}
                      style={{
                        ...blockPositionStyle,
                        ...calendarBlockLaneStyle(lane),
                        "--calendar-block-accent": accent,
                        "--calendar-block-fill": `color-mix(in srgb, ${accent} 18%, var(--surface))`,
                        "--calendar-block-selected-fill": `color-mix(in srgb, ${accent} 26%, var(--surface-inset))`,
                        "--calendar-block-border": `color-mix(in srgb, ${accent} 42%, var(--line))`,
                        color: "var(--foreground)"
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
                            {calendarBlockSecondaryLine(displayEntry, capturedNow)}
                          </span>
                        ) : null}
                      </button>
                      {showInlineAction ? (
                        <button
                          type="button"
                          className="calendar-start-again"
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
                          <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
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
          ))}
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
      {resizeError ? (
        <p className="border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--danger-text)]" role="alert">
          {resizeError}
        </p>
      ) : null}
      {actionError ? (
        <p className="timeline-delete-error" role="alert" aria-atomic="true" aria-live="assertive">
          {actionError}
        </p>
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

function TimesheetView({
  capturedNow,
  entries,
  onScroll,
  scrollContainerRef,
  weekDays
}: {
  capturedNow: Date;
  entries: TimeEntryRow[];
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  weekDays: Date[];
}) {
  const rows = buildTimelineTimesheetRows(entries, weekDays, capturedNow);
  const dailyTotals = timelineDailyTotals(rows, weekDays.length);
  const dailyCoverage = weekDays.map((day) => analyzeTimeIntervals(
    entries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    {
      range: { start: day, end: addDays(day, 1) },
      now: capturedNow
    }
  ));
  return (
    <section className="timeline-timesheet-workspace">
      <div className="timeline-timesheet-scroll" onScroll={onScroll} ref={scrollContainerRef}>
      <table className="timeline-timesheet-table">
        <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="timeline-timesheet-activity-cell">Activity</th>
            {weekDays.map((day) => (
              <th key={day.toISOString()}>
                {formatDate(day)}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-sm text-[var(--muted)]">No time entries for this week.</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--line)] last:border-b-0">
              <td className="timeline-timesheet-activity-cell">
                <span className="flex items-center gap-2 font-semibold">
                  <span
                    className={`category-data-marker${row.categoryName ? "" : " is-uncategorized"}`}
                    style={{ backgroundColor: timeEntryCategoryColor(row) }}
                  />
                  {timeEntryCategoryLabel(row)}
                </span>
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  {row.categoryName ? "Category total" : "Uncategorized time"}
                </span>
              </td>
              {row.days.map((seconds, index) => (
                <td key={`${row.id}-${index}`} className="tabular">
                  {seconds > 0 ? formatDuration(seconds) : "-"}
                </td>
              ))}
              <td className="tabular timeline-timesheet-total">{formatDuration(row.total)}</td>
            </tr>
          ))}
          <tr className="bg-[var(--surface-inset)] font-semibold">
            <td className="timeline-timesheet-activity-cell">Daily total</td>
            {dailyTotals.map((seconds, index) => (
              <td key={weekDays[index].toISOString()} className="tabular">
                {formatDuration(seconds)}
                {dailyCoverage[index]?.hasOverlap ? (
                  <span className="mt-1 block text-xs font-normal text-[var(--warning-text)]">
                    {formatDuration(dailyCoverage[index].timeCoveredSeconds)} covered
                  </span>
                ) : null}
              </td>
            ))}
            <td className="tabular timeline-timesheet-total">
              {formatDuration(dailyTotals.reduce((sum, seconds) => sum + seconds, 0))}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>
  );
}

function calendarBlockStyle(
  entry: TimeEntryRow,
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
  capturedNow: Date
) {
  const details = calendarEntrySliceDetails(entry, draft, day, capturedNow);
  const displayEntry = {
    ...entry,
    startedAt: draft?.startedAt ?? entry.startedAt,
    stoppedAt: draft?.stoppedAt ?? entry.stoppedAt
  };
  const tags = entry.tagNames.length ? ` All tags: ${entry.tagNames.join(", ")}.` : "";
  return `${calendarBlockPrimaryLine(displayEntry)}. ${calendarBlockSecondaryLine(displayEntry, capturedNow)}.${tags}${details.continuation ? ` ${details.continuation}` : ""}`;
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
  const visibleStart = new Date(Math.max(entryStart.getTime(), dayStart.getTime()));
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
    isLiveSlice,
    timeRange: `${formatTime(visibleStart)} - ${isLiveSlice ? "now" : formatTime(visibleEnd)}`
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

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function snapCalendarMinutes(value: number) {
  return Math.round(value / calendarSnapMinutes) * calendarSnapMinutes;
}

function clampMinutes(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatCalendarAxisMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
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
  return target === dayBody ? "day-body" : "other";
}
