"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, CircleDot, List, Pencil, Play, Table2, X } from "lucide-react";
import { calendarBlockContinuationEdges } from "@dayframe/shared";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { TagMetadata } from "@/components/TagMetadata";
import { EntriesTable } from "@/components/EntriesTable";
import { Button, Disclosure, IconButton, SegmentedControl } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  timeEntryAccentColor,
  timeEntryCategoryColor,
  timeEntryCategoryLabel,
  timeEntryContextLabel,
  timeEntryTitle
} from "@/lib/display";
import type { BootstrapData, CategoryRow, PlaceRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocalInputToIso,
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import {
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
  resetTimelineState,
  resolveTimelineRanges,
  shiftTimelineState,
  timelineHref,
  timelineStateFromSearchParams,
  toTimelineDateKey,
  type TimelineScope,
  type TimelineView
} from "@/lib/timeline-view";

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

type CalendarResizeEdge = "start" | "end";
type CalendarZoom = keyof typeof calendarZooms;

type CalendarResizeDraft = {
  entryId: string;
  startedAt: string;
  stoppedAt: string;
};

type CalendarDetailsTarget = {
  blockKey: string;
  day: Date;
  entry: TimeEntryRow;
};

type CalendarDetailsPosition = {
  left: number;
  top: number;
};

export function TimeReviewViews({
  initialData
}: {
  initialData: BootstrapData;
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
  const state = timelineStateFromSearchParams(searchParams);
  const ranges = resolveTimelineRanges(state);
  const capturedNow = new Date();
  const calendarHoursMode: CalendarHoursMode = "fullDay";

  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);

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
      return;
    }

    const outcome = await loadDate(nextState.date);
    if (!outcome.ok) return;
    if (window.location.search.slice(1) !== originSearch) return;
    window.history.pushState(null, "", href);
  }

  function updateView(view: TimelineView) {
    if (isDateLoading) return;
    navigate({
      view,
      scope: view === "timesheet" ? "week" : state.scope
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
  const activeEntries = state.scope === "day" ? dayEntries : weekEntries;
  const dayTotal = dayEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const weekTotal = weekEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const periodLabel = formatTimelinePeriodLabel(state.scope, ranges);
  const resetLabel = state.scope === "day" ? "Today" : "This week";
  const todayKey = toTimelineDateKey(new Date());
  const isCurrentPeriod = state.scope === "day"
    ? state.date === todayKey
    : ranges.weekDays.some((day) => toTimelineDateKey(day) === todayKey);

  return (
    <section className="space-y-5">
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
          <div className="timeline-period-label" aria-live="polite" aria-atomic="true">
            <strong>{periodLabel}</strong>
            <span>{state.scope === "day" ? "Selected day" : "Selected week"}</span>
          </div>
          <IconButton
            disabled={isDateLoading}
            label={`Next ${state.scope}`}
            onClick={() => navigate(shiftTimelineState(state, "next"))}
          >
            <ChevronRight size={18} />
          </IconButton>
          {!isCurrentPeriod ? (
            <Button compact disabled={isDateLoading} onClick={() => navigate(resetTimelineState(state))}>
              {resetLabel}
            </Button>
          ) : null}
        </div>

        <dl className="timeline-range-totals">
          <div>
            <dt>Day total</dt>
            <dd className="tabular">{formatDuration(dayTotal)}</dd>
          </div>
          <div>
            <dt>Week total</dt>
            <dd className="tabular">{formatDuration(weekTotal)}</dd>
          </div>
        </dl>

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
      <p
        aria-atomic="true"
        aria-live={dateLoadError ? "assertive" : "polite"}
        className={[
          "timeline-range-feedback",
          dateLoadError ? "is-error" : "",
          !dateLoadError && !isDateLoading ? "is-idle" : ""
        ].join(" ")}
        role={dateLoadError ? "alert" : "status"}
      >
        {dateLoadError ?? (isDateLoading ? "Loading period…" : "\u00a0")}
      </p>

      {state.view === "calendar" ? (
        <CalendarReview
          calendarHoursMode={calendarHoursMode}
          capturedNow={capturedNow}
          categories={data.categories}
          entries={activeEntries}
          onSynced={refreshData}
          places={data.places}
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
          places={data.places}
          groupByDay
          onChanged={refreshData}
          tags={data.tags}
        />
      ) : null}
      {state.view === "timesheet" ? (
        <TimesheetView capturedNow={capturedNow} entries={weekEntries} weekDays={ranges.weekDays} />
      ) : null}
    </section>
  );
}

function CalendarReview({
  calendarHoursMode,
  capturedNow,
  categories,
  entries,
  onSynced,
  places,
  tags,
  visibleDays
}: {
  calendarHoursMode: CalendarHoursMode;
  capturedNow: Date;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  onSynced: () => Promise<void>;
  places: PlaceRow[];
  tags: BootstrapData["tags"];
  visibleDays: Date[];
}) {
  const router = useRouter();
  const { isTimerBusy, startEntryAgain } = useAppShellRuntime();
  const [, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<CalendarDetailsTarget | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<CalendarDetailsTarget | null>(null);
  const [detailsAnchor, setDetailsAnchor] = useState<HTMLElement | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [resizeDraft, setResizeDraft] = useState<CalendarResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<CalendarZoom>("hour");
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const detailsFirstActionRef = useRef<HTMLButtonElement | null>(null);
  const detailsCloseTimerRef = useRef<number | null>(null);
  const detailsExitTimerRef = useRef<number | null>(null);
  const suppressFocusDetailsRef = useRef(false);
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

  useEffect(() => () => {
    if (detailsCloseTimerRef.current !== null) window.clearTimeout(detailsCloseTimerRef.current);
    if (detailsExitTimerRef.current !== null) window.clearTimeout(detailsExitTimerRef.current);
  }, []);

  function clearDetailsTimers() {
    if (detailsCloseTimerRef.current !== null) {
      window.clearTimeout(detailsCloseTimerRef.current);
      detailsCloseTimerRef.current = null;
    }
    if (detailsExitTimerRef.current !== null) {
      window.clearTimeout(detailsExitTimerRef.current);
      detailsExitTimerRef.current = null;
    }
  }

  function showDetails(target: CalendarDetailsTarget, anchor?: HTMLElement | null) {
    clearDetailsTimers();
    setDetailsTarget(target);
    setDetailsAnchor(anchor ?? blockRefs.current.get(target.blockKey) ?? null);
    window.requestAnimationFrame(() => setDetailsVisible(true));
  }

  function hideDetails({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    clearDetailsTimers();
    const target = detailsTarget;
    setDetailsVisible(false);
    const finish = () => {
      setDetailsTarget(null);
      setDetailsAnchor(null);
      detailsExitTimerRef.current = null;
      if (!restoreFocus || !target) return;
      const primaryAction = blockRefs.current
        .get(target.blockKey)
        ?.querySelector<HTMLButtonElement>(".calendar-entry-primary");
      suppressFocusDetailsRef.current = true;
      primaryAction?.focus();
      window.requestAnimationFrame(() => {
        suppressFocusDetailsRef.current = false;
      });
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    detailsExitTimerRef.current = window.setTimeout(finish, 140);
  }

  function scheduleDetailsClose() {
    if (detailsCloseTimerRef.current !== null) window.clearTimeout(detailsCloseTimerRef.current);
    detailsCloseTimerRef.current = window.setTimeout(() => {
      detailsCloseTimerRef.current = null;
      if (selectedTarget) {
        showDetails(selectedTarget);
      } else {
        hideDetails();
      }
    }, 120);
  }

  function selectCalendarEntry(target: CalendarDetailsTarget) {
    setSelectedTarget(target);
    setActionError(null);
    showDetails(target);
  }

  function openCalendarEntryActions(target: CalendarDetailsTarget) {
    selectCalendarEntry(target);
    window.requestAnimationFrame(() => detailsFirstActionRef.current?.focus());
  }

  function closeCalendarEntryDetails({ restoreFocus = true } = {}) {
    setSelectedTarget(null);
    setActionError(null);
    hideDetails({ restoreFocus });
  }

  function editCalendarEntry(entry: TimeEntryRow) {
    setSelectedTarget(null);
    setActionError(null);
    hideDetails();
    setEditingEntry(entry);
  }

  async function continueCalendarEntry(target: CalendarDetailsTarget) {
    if (continuingEntryId || isTimerBusy || !target.entry.stoppedAt) return;
    selectCalendarEntry(target);
    setContinuingEntryId(target.entry.id);
    setActionError(null);
    try {
      const outcome = await startEntryAgain(target.entry);
      if (!outcome.ok) {
        setActionError(outcome.error);
        return;
      }
      setSelectedTarget(null);
      hideDetails();
    } finally {
      setContinuingEntryId(null);
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
    const ranges = entries
      .filter((candidate) => (
        candidate.id !== entry.id &&
        candidate.stoppedAt &&
        entryOverlapsDay(candidate, day, capturedNow)
      ))
      .map((candidate) => {
        const candidateStart = new Date(candidate.startedAt);
        const candidateEnd = new Date(candidate.stoppedAt as string);
        return {
          start: candidateStart < dayStart ? timelineStart : minutesFromDate(candidateStart),
          end: candidateEnd > dayEnd ? timelineEnd : minutesFromDate(candidateEnd)
        };
      })
      .sort((a, b) => a.start - b.start);
    const previousEnd = Math.max(
      timelineStart,
      ...ranges.filter((range) => range.end <= originalStart).map((range) => range.end)
    );
    const nextStart = Math.min(
      timelineEnd,
      ...ranges.filter((range) => range.start >= originalEnd).map((range) => range.start)
    );
    const startClientY = event.clientY;
    let finalDraft: CalendarResizeDraft | null = null;
    let hasStartedResize = false;

    event.currentTarget.setPointerCapture(event.pointerId);

    const updateDraft = (clientY: number) => {
      const relativeY = clientY - columnRect.top;
      const rawMinutes = timelineStart + (relativeY / rowHeight) * 60;
      const snappedMinutes = clampMinutes(snapCalendarMinutes(rawMinutes), timelineStart, timelineEnd);
      const nextStartMinutes =
        edge === "start" ? clampMinutes(snappedMinutes, previousEnd, originalEnd - 15) : originalStart;
      const nextEndMinutes =
        edge === "end" ? clampMinutes(snappedMinutes, originalStart + 15, nextStart) : originalEnd;
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
      setSelectedTarget(null);
      setActionError(null);
      hideDetails();
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

  return (
    <section className="industrial-panel fill-calendar-panel">
      <div className="fill-panel-header flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Select a block for details and actions. Roomy completed blocks can be resized from their edges.
          </p>
        </div>
        <Disclosure className="swiss-view-options" summary="View options">
          <div className="swiss-view-options-controls">
            <span className="swiss-zoom-control" role="group" aria-label="Calendar zoom">
              <button
                type="button"
                disabled={zoomIndex === 0}
                aria-label="Zoom calendar out"
                onClick={() => setZoomLevel(zoomKeys[Math.max(0, zoomIndex - 1)])}
              >
                -
              </button>
              <b>{zoom.label}</b>
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
        </Disclosure>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[980px]"
          style={{ gridTemplateColumns: `72px repeat(${visibleDays.length}, minmax(130px, 1fr))` }}
        >
          <div className="border-b border-r border-[var(--line)] bg-[var(--surface-inset)] px-3 py-3 text-xs text-[var(--muted)]">
            Time
          </div>
          {visibleDays.map((day) => {
            const total = entries
              .reduce(
                (sum, entry) => sum + entryOverlapSeconds(
                  entry,
                  { start: startOfDay(day), end: addDays(startOfDay(day), 1) },
                  capturedNow
                ),
                0
              );
            return (
              <div
                key={day.toISOString()}
                className={[
                  "border-b border-r border-[var(--line)] px-3 py-3 last:border-r-0",
                  sameDay(day, today) ? "bg-[var(--surface-muted)]" : "bg-[var(--surface-inset)]"
                ].join(" ")}
              >
                <div className="text-sm font-semibold">{formatDate(day)}</div>
                <div className="tabular mt-1 text-xs text-[var(--muted)]">{formatDuration(total)}</div>
              </div>
            );
          })}

          <div className="relative border-r border-[var(--line)] bg-[var(--surface-inset)]" style={{ height: calendarHeight }}>
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
              className="relative border-r border-[var(--line)] last:border-r-0"
              style={{
                height: calendarHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${Math.max(0, gridLineSpacing - 1)}px, var(--line) ${gridLineSpacing}px)`
              }}
            >
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
                    const { startsBeforeDay, continuesIntoNextDay, ...blockPositionStyle } = blockStyle;
                    const durationSeconds = calendarDurationSeconds(entry, activeDraft, day, capturedNow);
                    const density = getTimeBlockDensity({
                      durationSeconds,
                      height: blockPositionStyle.height
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
                      startsBeforeDay
                    };
                  })
                  .filter((block): block is NonNullable<typeof block> => Boolean(block));
                const lanes = layoutTimeBlockLanes(blocks.map((block) => ({
                  key: block.blockKey,
                  top: block.blockPositionStyle.top,
                  height: block.blockPositionStyle.height
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
                  const target = { blockKey, day, entry };
                  const lane = lanes.get(blockKey) ?? { laneCount: 1, laneIndex: 0 };
                  const selected = selectedTarget?.blockKey === blockKey;
                  const detailsOpen = detailsTarget?.blockKey === blockKey;
                  const isResizing = resizingId === entry.id;
                  const isContinuing = continuingEntryId === entry.id;
                  const accent = timeEntryAccentColor(entry);
                  return (
                    <article
                      key={blockKey}
                      ref={(node) => {
                        if (node) blockRefs.current.set(blockKey, node);
                        else blockRefs.current.delete(blockKey);
                      }}
                      className={[
                        "calendar-time-block",
                        selected ? "is-selected" : "",
                        isResizing ? "is-resizing" : "",
                        entry.stoppedAt ? "" : "is-running",
                        startsBeforeDay ? "is-continuation-from-previous" : "",
                        continuesIntoNextDay ? "is-continuation-to-next" : "",
                        ...timeBlockDensityClassNames(density)
                      ].join(" ")}
                      style={{
                        ...blockPositionStyle,
                        ...calendarBlockLaneStyle(lane),
                        "--calendar-block-accent": accent,
                        backgroundColor: `color-mix(in srgb, ${accent} 18%, var(--surface))`,
                        borderColor: `color-mix(in srgb, ${accent} 72%, var(--line))`,
                        color: "var(--foreground)"
                      } as CSSProperties}
                      data-entry-id={entry.id}
                      data-calendar-block-key={blockKey}
                      onPointerEnter={() => {
                        if (!isResizing) showDetails(target);
                      }}
                      onPointerLeave={scheduleDetailsClose}
                    >
                      <button
                        type="button"
                        className="calendar-entry-primary"
                        aria-controls={detailsOpen ? "calendar-entry-details" : undefined}
                        aria-expanded={detailsOpen}
                        aria-haspopup="dialog"
                        aria-label={detailsLabel}
                        aria-pressed={selected}
                        title={detailsLabel}
                        onBlur={(event) => {
                          if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
                          scheduleDetailsClose();
                        }}
                        onClick={() => selectCalendarEntry(target)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          editCalendarEntry(entry);
                        }}
                        onFocus={() => {
                          if (!isResizing && !suppressFocusDetailsRef.current) showDetails(target);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            openCalendarEntryActions(target);
                          }
                          if (event.key === "Escape" && detailsOpen) {
                            event.preventDefault();
                            closeCalendarEntryDetails();
                          }
                        }}
                        onMouseDown={(event) => {
                          if (event.detail > 1) event.preventDefault();
                        }}
                      >
                        {density.showTitle ? (
                          <span className="calendar-entry-title">{timeEntryTitle(entry)}</span>
                        ) : null}
                        {density.showDuration ? (
                          entry.stoppedAt ? (
                            <span className="calendar-entry-duration tabular">{formatDuration(durationSeconds)}</span>
                          ) : (
                            <span className="calendar-entry-running-row">
                              <span className="calendar-entry-running-status">
                                <CircleDot size={11} aria-hidden="true" />
                                Running
                              </span>
                              <span className="calendar-entry-duration tabular">{formatDuration(durationSeconds)}</span>
                            </span>
                          )
                        ) : null}
                        {density.showContext ? (
                          <span className="calendar-entry-context">{timeEntryContextLabel(entry)}</span>
                        ) : null}
                        {density.showTags ? <TagMetadata tagNames={entry.tagNames} /> : null}
                      </button>
                      {entry.stoppedAt && density.canShowInlineAction && !isResizing ? (
                        <button
                          type="button"
                          className="calendar-start-again"
                          aria-busy={isContinuing}
                          aria-label={`Start ${timeEntryTitle(entry)} again`}
                          disabled={isTimerBusy || Boolean(continuingEntryId)}
                          onBlur={scheduleDetailsClose}
                          onClick={() => void continueCalendarEntry(target)}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onFocus={() => showDetails(target)}
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
      {resizeError ? <p className="border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--danger-text)]">{resizeError}</p> : null}
      {detailsTarget && typeof document !== "undefined" ? createPortal(
        <CalendarEntryDetails
          actionError={actionError}
          anchor={detailsAnchor}
          busy={isTimerBusy || continuingEntryId === detailsTarget.entry.id}
          firstActionRef={detailsFirstActionRef}
          layoutKey={`${detailsTarget.blockKey}:${zoomLevel}`}
          onClose={() => closeCalendarEntryDetails()}
          onEdit={() => editCalendarEntry(detailsTarget.entry)}
          onFocusSurface={clearDetailsTimers}
          onLeaveSurface={scheduleDetailsClose}
          onStartAgain={() => void continueCalendarEntry(detailsTarget)}
          target={detailsTarget}
          visible={detailsVisible}
          capturedNow={capturedNow}
        />,
        document.body
      ) : null}
      {editingEntry ? (
        <EditTimeEntryDialog
          categories={categories}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await onSynced();
            startTransition(() => router.refresh());
          }}
          places={places}
          tags={tags}
        />
      ) : null}
    </section>
  );
}

function CalendarEntryDetails({
  actionError,
  anchor,
  busy,
  capturedNow,
  firstActionRef,
  layoutKey,
  onClose,
  onEdit,
  onFocusSurface,
  onLeaveSurface,
  onStartAgain,
  target,
  visible
}: {
  actionError: string | null;
  anchor: HTMLElement | null;
  busy: boolean;
  capturedNow: Date;
  firstActionRef: RefObject<HTMLButtonElement | null>;
  layoutKey: string;
  onClose: () => void;
  onEdit: () => void;
  onFocusSurface: () => void;
  onLeaveSurface: () => void;
  onStartAgain: () => void;
  target: CalendarDetailsTarget;
  visible: boolean;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<CalendarDetailsPosition>({ left: 12, top: 12 });
  const titleId = `calendar-entry-details-title-${target.entry.id}`;
  const details = calendarEntrySliceDetails(target.entry, null, target.day, capturedNow);

  useLayoutEffect(() => {
    function updatePosition() {
      const panel = panelRef.current;
      if (!anchor || !panel || window.innerWidth <= 640) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const left = Math.min(
        Math.max(viewportPadding, anchorRect.left),
        Math.max(viewportPadding, window.innerWidth - panelRect.width - viewportPadding)
      );
      const below = anchorRect.bottom + gap;
      const top = below + panelRect.height <= window.innerHeight - viewportPadding
        ? below
        : Math.max(viewportPadding, anchorRect.top - panelRect.height - gap);
      setPosition({ left: Math.round(left), top: Math.round(top) });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, layoutKey]);

  return (
    <aside
      ref={panelRef}
      id="calendar-entry-details"
      role="dialog"
      aria-labelledby={titleId}
      aria-modal={false}
      className={`calendar-entry-details${visible ? " is-visible" : ""}`}
      style={{ left: position.left, top: position.top } as CSSProperties}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onLeaveSurface();
      }}
      onFocusCapture={onFocusSurface}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onPointerEnter={onFocusSurface}
      onPointerLeave={onLeaveSurface}
    >
      <header className="calendar-entry-details-header">
        <div>
          <span className="calendar-entry-details-kicker">
            {target.entry.stoppedAt ? formatDate(target.day) : (
              <>
                <CircleDot size={13} aria-hidden="true" />
                Running
              </>
            )}
          </span>
          <h3 id={titleId}>{timeEntryTitle(target.entry)}</h3>
        </div>
        <IconButton label="Close entry details" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </IconButton>
      </header>

      <dl className="calendar-entry-details-list">
        <div>
          <dt>Time</dt>
          <dd className="tabular">{details.timeRange}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="tabular">{formatDuration(details.durationSeconds)}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{timeEntryCategoryLabel(target.entry)}</dd>
        </div>
        {target.entry.placeName ? (
          <div>
            <dt>Place</dt>
            <dd>{target.entry.placeName}</dd>
          </div>
        ) : null}
        {target.entry.tagNames.length > 0 ? (
          <div className="calendar-entry-details-wide">
            <dt>Tags</dt>
            <dd>{target.entry.tagNames.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      {details.continuation ? <p className="calendar-entry-continuation">{details.continuation}</p> : null}
      {actionError ? <p className="calendar-entry-details-error" role="alert">{actionError}</p> : null}

      <footer className="calendar-entry-details-actions">
        {target.entry.stoppedAt ? (
          <Button
            ref={firstActionRef}
            aria-busy={busy}
            aria-label={`Start ${timeEntryTitle(target.entry)} again`}
            disabled={busy}
            onClick={onStartAgain}
          >
            <Play size={15} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            <span>Start again</span>
          </Button>
        ) : null}
        <Button
          ref={target.entry.stoppedAt ? undefined : firstActionRef}
          onClick={onEdit}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>Edit</span>
        </Button>
      </footer>
    </aside>
  );
}

function TimesheetView({
  capturedNow,
  entries,
  weekDays
}: {
  capturedNow: Date;
  entries: TimeEntryRow[];
  weekDays: Date[];
}) {
  const rows = buildTimelineTimesheetRows(entries, weekDays, capturedNow);
  const dailyTotals = timelineDailyTotals(rows, weekDays.length);

  return (
    <section className="industrial-panel overflow-x-auto">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Timesheet</h2>
      </div>
      <table className="min-w-[980px] w-full border-collapse text-sm">
        <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="border-b border-r border-[var(--line)] px-3 py-3">Activity</th>
            {weekDays.map((day) => (
              <th key={day.toISOString()} className="border-b border-r border-[var(--line)] px-3 py-3 last:border-r-0">
                {formatDate(day)}
              </th>
            ))}
            <th className="border-b border-[var(--line)] px-3 py-3">Total</th>
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
              <td className="border-r border-[var(--line)] px-3 py-3">
                <span className="flex items-center gap-2 font-semibold">
                  <span
                    className={`h-3 w-3 border border-[var(--line-strong)]${row.categoryName ? "" : " is-uncategorized"}`}
                    style={{ backgroundColor: timeEntryCategoryColor(row) }}
                  />
                  {timeEntryCategoryLabel(row)}
                </span>
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  {row.categoryName ? "Category total" : "Uncategorized time"}
                </span>
              </td>
              {row.days.map((seconds, index) => (
                <td key={`${row.id}-${index}`} className="tabular border-r border-[var(--line)] px-3 py-3 text-[var(--muted)] last:border-r-0">
                  {seconds > 0 ? formatDuration(seconds) : "-"}
                </td>
              ))}
              <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">{formatDuration(row.total)}</td>
            </tr>
          ))}
          <tr className="bg-[var(--surface-inset)] font-semibold">
            <td className="border-r border-[var(--line)] px-3 py-3">Daily total</td>
            {dailyTotals.map((seconds, index) => (
              <td key={weekDays[index].toISOString()} className="tabular border-r border-[var(--line)] px-3 py-3">
                {formatDuration(seconds)}
              </td>
            ))}
            <td className="tabular px-3 py-3 text-[var(--accent-text)]">
              {formatDuration(dailyTotals.reduce((sum, seconds) => sum + seconds, 0))}
            </td>
          </tr>
        </tbody>
      </table>
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
  const endMinutes = visibleEnd >= axisEnd
    ? (calendarHours.endHour - calendarHours.startHour) * 60
    : minutesFromDate(visibleEnd) - calendarHours.startHour * 60;
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

function calendarBlockLaneStyle({ laneCount, laneIndex }: TimeBlockLane): CSSProperties {
  if (laneCount <= 1) return { left: 8, right: 8 };
  const laneWidth = 100 / laneCount;
  const before = laneWidth * laneIndex;
  const after = laneWidth * (laneCount - laneIndex - 1);
  return {
    left: laneIndex === 0 ? 8 : `calc(${before}% + 2px)`,
    right: laneIndex === laneCount - 1 ? 8 : `calc(${after}% + 2px)`
  };
}

function calendarBlockDetailsLabel(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  durationSeconds: number,
  day: Date,
  capturedNow: Date
) {
  const details = calendarEntrySliceDetails(entry, draft, day, capturedNow);
  const durationLabel = details.isLiveSlice
    ? `Running, ${formatDuration(durationSeconds)}`
    : formatDuration(durationSeconds);
  return `${timeEntryTitle(entry)}. ${timeEntryContextLabel(entry)}. ${details.timeRange}. ${durationLabel}.${details.continuation ? ` ${details.continuation}` : ""}`;
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

function formatTimelinePeriodLabel(
  scope: TimelineScope,
  ranges: ReturnType<typeof resolveTimelineRanges>
) {
  if (scope === "day") {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(ranges.day.start);
  }

  const start = ranges.weekDays[0];
  const end = ranges.weekDays[6];
  const full = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${full.format(end)}`;
  }
  return `${full.format(start)} – ${full.format(end)}`;
}
