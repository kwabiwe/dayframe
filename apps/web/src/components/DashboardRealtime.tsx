"use client";

import Link from "next/link";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppShellRuntime, useRuntimePageData } from "@/components/AppShellRuntime";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { TagMetadata } from "@/components/TagMetadata";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  HelpCircle,
  Laptop,
  MapPin,
  Plus,
  Trash2,
  Users,
  Utensils
} from "lucide-react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  timeEntryAccentColor,
  timeEntryContextLabel,
  timeEntryTitle
} from "@/lib/display";
import {
  dateTimeLocalInputToIso,
  formatDuration,
  formatEventLabel,
  formatSourceLabel,
  formatTime
} from "@/lib/format";
import {
  getTimeBlockDensity,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "@/lib/time-block-display";

const dayStartHour = 0;
const dayEndHour = 24;
const resizeSnapMinutes = 15;
const minEntryMinutes = 15;
const timelineAxisLabelHeight = 22;
const timelineZooms = {
  hour: { label: "1h", intervalMinutes: 60, pixelsPerHour: 64 },
  half: { label: "30m", intervalMinutes: 30, pixelsPerHour: 92 },
  quarter: { label: "15m", intervalMinutes: 15, pixelsPerHour: 128 }
} as const;

type TimelineZoom = keyof typeof timelineZooms;

export function DashboardRealtime({ initialData }: { initialData: BootstrapData }) {
  const data = useRuntimePageData(initialData);
  const { openManualEntry, refresh } = useAppShellRuntime();
  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const selectedDate = useMemo(
    () => parseDateKey(data.dateRange.selectedDate),
    [data.dateRange.selectedDate]
  );
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(selectedDate);
  const totalLogged = data.dayEntries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const dailyGoalSeconds = data.user.dailyGoalMinutes * 60;
  const weeklyGoalSeconds = data.user.weeklyGoalMinutes * 60;

  return (
    <div className="swiss-dashboard">
      <section className="swiss-top-grid">
        <MetricCard
          title="Today"
          value={formatDuration(data.stats.todaySeconds)}
          caption="Total time"
          goalLabel={`Goal ${formatDuration(dailyGoalSeconds)}`}
          progress={data.stats.todaySeconds / dailyGoalSeconds}
          series={data.todaySeries.map((point) => point.seconds)}
        />
        <MetricCard
          title="This week"
          value={formatDuration(data.stats.weekSeconds)}
          caption="Total time"
          goalLabel={`Goal ${formatDuration(weeklyGoalSeconds)}`}
          progress={data.stats.weekSeconds / weeklyGoalSeconds}
          series={data.weekSeries.map((point) => point.seconds)}
        />
        <ReviewSummaryCard items={data.reviewItems} />
        <StreakCard series={data.weekSeries.map((point) => point.seconds)} />
      </section>

      <section className="swiss-dashboard-grid">
        <DayTimeline
          dateLabel={dayLabel}
          data={data}
          entries={data.dayEntries}
          weekEntries={data.weekEntries}
          selectedDate={data.dateRange.selectedDate}
          totalLogged={totalLogged}
          onAddEntry={openManualEntry}
          onEntryUpdated={refreshData}
        />
        <aside className="swiss-side-stack">
          <DashboardReviewInbox items={data.reviewItems} />
          <RecentActivityPanel data={data} />
        </aside>
      </section>

    </div>
  );
}

function MetricCard({
  title,
  value,
  caption,
  goalLabel,
  progress,
  series
}: {
  title: string;
  value: string;
  caption: string;
  goalLabel: string;
  progress: number;
  series: number[];
}) {
  return (
    <section className="swiss-panel swiss-metric-card">
      <div className="swiss-panel-label">{title}</div>
      <div className="swiss-metric-value">{value}</div>
      <p>{caption}</p>
      <MiniBars values={series} />
      <div className="swiss-progress-row">
        <span>{goalLabel}</span>
        <span>{Math.round(Math.min(1, Math.max(0, progress)) * 100)}%</span>
      </div>
    </section>
  );
}

function ReviewSummaryCard({ items }: { items: BootstrapData["reviewItems"] }) {
  const openItems = items.filter((item) => item.status === "open");
  const needsClassification = openItems.filter((item) => !item.categoryName).length;
  const needsDuration = openItems.filter((item) => !item.suggestedStoppedAt).length;
  const overlapDetected = openItems.filter((item) => item.type.includes("overlap")).length;

  return (
    <section className="swiss-panel swiss-review-summary">
      <div className="swiss-panel-label">Review</div>
      <div className="swiss-metric-value">{openItems.length}</div>
      <p>Items</p>
      <div className="swiss-review-breakdown">
        <span>{needsClassification} Needs classification</span>
        <span>{needsDuration} Needs duration</span>
        <span>{overlapDetected} Overlap detected</span>
      </div>
      <Link href="/review">
        Open review inbox <ArrowRight size={15} />
      </Link>
    </section>
  );
}

function StreakCard({ series }: { series: number[] }) {
  const activeDays = series.filter((seconds) => seconds > 0).length;
  const labels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <section className="swiss-panel swiss-streak-card">
      <div className="swiss-panel-label">Streak</div>
      <div className="swiss-metric-value">{activeDays}</div>
      <p>Days</p>
      <div className="swiss-streak-grid" aria-label="Tracked days this week">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className={series[index] > 0 ? "is-active" : ""}>
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="swiss-mini-bars" aria-hidden="true">
      {values.map((value, index) => (
        <span key={`${index}-${value}`} style={{ height: `${Math.max(18, (value / max) * 58)}px` }} />
      ))}
    </div>
  );
}

function DayTimeline({
  dateLabel,
  data,
  entries,
  weekEntries,
  selectedDate,
  totalLogged,
  onAddEntry,
  onEntryUpdated
}: {
  dateLabel: string;
  data: BootstrapData;
  entries: TimeEntryRow[];
  weekEntries: TimeEntryRow[];
  selectedDate: string;
  totalLogged: number;
  onAddEntry: () => void;
  onEntryUpdated: () => Promise<void>;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [zoomLevel, setZoomLevel] = useState<TimelineZoom>("hour");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<EntryContextMenu | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [dateJumpOpen, setDateJumpOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const selectedDay = useMemo(() => parseDateKey(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => getWeekDays(startOfWeek(selectedDay)), [selectedDay]);
  const zoom = timelineZooms[zoomLevel];
  const timelineStartMinutes = dayStartHour * 60;
  const timelineEndMinutes = (dayEndHour + 1) * 60;
  const timelineHeight = ((timelineEndMinutes - timelineStartMinutes) / 60) * zoom.pixelsPerHour;
  const visibleEntries = useMemo(
    () =>
      viewMode === "day"
        ? entries
        : weekEntries.filter((entry) =>
            weekDays.some((day) => dateKey(day) === dateKey(new Date(entry.startedAt)))
          ),
    [entries, viewMode, weekDays, weekEntries]
  );
  const sorted = [...visibleEntries].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  const axisMarks = useMemo(() => {
    const totalMinutes = timelineEndMinutes - timelineStartMinutes;
    const markCount = Math.floor(totalMinutes / zoom.intervalMinutes);
    return Array.from({ length: markCount + 1 }, (_, index) => {
      const minutes = timelineStartMinutes + index * zoom.intervalMinutes;
      const top = ((minutes - timelineStartMinutes) / 60) * zoom.pixelsPerHour;
      return {
        key: `${minutes}`,
        label: formatAxisMinutes(minutes),
        labelTop: clampAxisLabelTop(top, timelineHeight),
        major: minutes % 60 === 0,
        top
      };
    });
  }, [timelineEndMinutes, timelineHeight, timelineStartMinutes, zoom.intervalMinutes, zoom.pixelsPerHour]);
  const isToday = viewMode === "day" && selectedDate === dateKey(new Date());
  const now = new Date();
  const currentTop =
    ((now.getHours() * 60 + now.getMinutes() - dayStartHour * 60) / 60) * zoom.pixelsPerHour;
  const displayedTotal =
    viewMode === "day" ? totalLogged : sorted.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const averageDuration = sorted.length > 0 ? displayedTotal / sorted.length : 0;
  const zoomKeys = Object.keys(timelineZooms) as TimelineZoom[];
  const zoomIndex = zoomKeys.indexOf(zoomLevel);
  const titlePrefix = viewMode === "day" ? "Today" : "Week";
  const headerLabel =
    viewMode === "day"
      ? dateLabel
      : `${formatShortDate(weekDays[0])} - ${formatShortDate(weekDays[6])}`;

  const deleteEntry = useCallback(
    async (entryId: string) => {
      setResizeError(null);
      const response = await clientFetch(`/api/time-entries/${entryId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        setResizeError("Unable to delete the selected time block.");
        return;
      }
      setSelectedEntryId(null);
      setContextMenu(null);
      await onEntryUpdated();
    },
    [onEntryUpdated]
  );

  useEffect(() => {
    function deleteSelected(event: KeyboardEvent) {
      if (!selectedEntryId || isTypingTarget(event.target)) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      event.preventDefault();
      void deleteEntry(selectedEntryId);
    }

    window.addEventListener("keydown", deleteSelected);
    return () => window.removeEventListener("keydown", deleteSelected);
  }, [deleteEntry, selectedEntryId]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  async function saveResize(entry: TimeEntryRow, draft: ResizeDraft) {
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

    if (!response.ok) {
      throw new Error(`Unable to resize entry: ${response.status}`);
    }

    await onEntryUpdated();
  }

  function startResize(
    entry: TimeEntryRow,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    if (!entry.stoppedAt || !canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const originalStart = minutesFromDate(new Date(entry.startedAt));
    const originalEnd = minutesFromDate(new Date(entry.stoppedAt));
    const entryDate = dateKey(new Date(entry.startedAt));
    const ranges = sorted
      .filter(
        (candidate) =>
          candidate.id !== entry.id &&
          candidate.stoppedAt &&
          dateKey(new Date(candidate.startedAt)) === entryDate
      )
      .map((candidate) => ({
        start: minutesFromDate(new Date(candidate.startedAt)),
        end: minutesFromDate(new Date(candidate.stoppedAt as string))
      }))
      .sort((a, b) => a.start - b.start);
    const previousEnd = Math.max(
      timelineStartMinutes,
      ...ranges.filter((range) => range.end <= originalStart).map((range) => range.end)
    );
    const nextStart = Math.min(
      timelineEndMinutes,
      ...ranges.filter((range) => range.start >= originalEnd).map((range) => range.start)
    );
    const startClientY = event.clientY;
    let finalDraft: ResizeDraft | null = null;
    let hasStartedResize = false;

    event.currentTarget.setPointerCapture(event.pointerId);

    const updateDraft = (clientY: number) => {
      const relativeY = clientY - canvasRect.top;
      const rawMinutes = timelineStartMinutes + (relativeY / zoom.pixelsPerHour) * 60;
      const snappedMinutes = clamp(
        snapMinutes(rawMinutes),
        timelineStartMinutes,
        timelineEndMinutes
      );
      const nextStartMinutes =
        edge === "start"
          ? clamp(snappedMinutes, previousEnd, originalEnd - minEntryMinutes)
          : originalStart;
      const nextEndMinutes =
        edge === "end"
          ? clamp(snappedMinutes, originalStart + minEntryMinutes, nextStart)
          : originalEnd;
      finalDraft = {
        entryId: entry.id,
        startedAt: isoForDateMinutes(entryDate, nextStartMinutes),
        stoppedAt: isoForDateMinutes(entryDate, nextEndMinutes)
      };
      setResizeDraft(finalDraft);
    };

    const beginResize = () => {
      if (hasStartedResize) return;
      hasStartedResize = true;
      setResizingId(entry.id);
      setResizeError(null);
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
        await saveResize(entry, finalDraft);
      } catch {
        setResizeError("Unable to save the resized time block.");
      } finally {
        setResizeDraft(null);
      }
    };

    const cancelResize = () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", cancelResize);
      setResizingId(null);
      setResizeDraft(null);
    };

    const moveResize = (moveEvent: PointerEvent) => {
      if (!hasStartedResize) {
        if (Math.abs(moveEvent.clientY - startClientY) < resizeDragThresholdPx) return;
        beginResize();
      }
      updateDraft(moveEvent.clientY);
    };

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", cancelResize, { once: true });
  }

  return (
    <section className="swiss-panel swiss-day-panel">
      <div className="swiss-day-header">
        <h2>
          {titlePrefix} · {headerLabel}
        </h2>
        <div>
          <span className="swiss-view-switch" role="group" aria-label="Timeline view">
            <button
              type="button"
              className={viewMode === "day" ? "is-selected" : ""}
              aria-pressed={viewMode === "day"}
              onClick={() => setViewMode("day")}
            >
              Day
            </button>
            <button
              type="button"
              className={viewMode === "week" ? "is-selected" : ""}
              aria-pressed={viewMode === "week"}
              onClick={() => setViewMode("week")}
            >
              Week
            </button>
          </span>
          <span className="swiss-zoom-control" role="group" aria-label="Timeline zoom">
            <button
              type="button"
              disabled={zoomIndex === 0}
              aria-label="Zoom out"
              onClick={() => setZoomLevel(zoomKeys[Math.max(0, zoomIndex - 1)])}
            >
              -
            </button>
            <b>{zoom.label}</b>
            <button
              type="button"
              disabled={zoomIndex === zoomKeys.length - 1}
              aria-label="Zoom in"
              onClick={() => setZoomLevel(zoomKeys[Math.min(zoomKeys.length - 1, zoomIndex + 1)])}
            >
              +
            </button>
          </span>
          <span className="swiss-date-tools">
            <button
              type="button"
              aria-label="Jump to date"
              className={dateJumpOpen ? "is-selected" : ""}
              aria-expanded={dateJumpOpen}
              onClick={() => setDateJumpOpen((current) => !current)}
            >
              <CalendarDays size={16} />
            </button>
            {dateJumpOpen ? (
              <span className="swiss-date-jump">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    if (nextDate) window.location.assign(`/?date=${nextDate}`);
                  }}
                />
              </span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="Toggle timeline summary"
            className={showSummary ? "is-selected" : ""}
            aria-pressed={showSummary}
            onClick={() => setShowSummary((current) => !current)}
          >
            <BarChart3 size={16} />
          </button>
        </div>
      </div>
      {viewMode === "week" ? (
        <div className="swiss-week-strip">
          {weekDays.map((day) => (
            <span key={dateKey(day)}>
              <b>{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(day)}</b>
              {new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(day)}
            </span>
          ))}
        </div>
      ) : null}
      {showSummary ? (
        <div className="swiss-timeline-summary">
          <span>
            <small>Blocks</small>
            <b>{sorted.length}</b>
          </span>
          <span>
            <small>Total</small>
            <b>{formatDuration(displayedTotal)}</b>
          </span>
          <span>
            <small>Average</small>
            <b>{formatDuration(averageDuration)}</b>
          </span>
        </div>
      ) : null}
      <div className="swiss-timeline-scroll">
        <div className="swiss-timeline-shell">
          <div className="swiss-time-axis" style={{ minHeight: timelineHeight }}>
            {axisMarks.map((mark) => (
              <div key={mark.key}>
                <span
                  aria-hidden="true"
                  className={mark.major ? "is-major swiss-time-axis-line" : "is-minor swiss-time-axis-line"}
                  style={{ top: mark.top }}
                />
                <span
                  className={mark.major ? "is-major swiss-time-axis-label" : "is-minor swiss-time-axis-label"}
                  style={{ top: mark.labelTop }}
                >
                  {mark.label}
                </span>
              </div>
            ))}
          </div>
          <div
            ref={canvasRef}
            className={["swiss-timeline-canvas", viewMode === "week" ? "is-week" : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ minHeight: timelineHeight }}
          >
            {viewMode === "week" ? (
              <div className="swiss-week-column-grid" aria-hidden="true">
                {weekDays.map((day) => (
                  <span key={dateKey(day)} />
                ))}
              </div>
            ) : null}
            {axisMarks.map((mark) => (
              <span
                key={mark.key}
                className={["swiss-hour-line", mark.major ? "is-major" : "is-minor"].join(" ")}
                style={{ top: mark.top }}
              />
            ))}
            {isToday && currentTop >= 0 && currentTop <= timelineHeight ? (
              <div className="swiss-now-line" style={{ top: currentTop }}>
                <span />
              </div>
            ) : null}
            {sorted.map((entry) => {
              const dayIndex =
                viewMode === "week"
                  ? weekDays.findIndex((day) => dateKey(day) === dateKey(new Date(entry.startedAt)))
                  : 0;
              if (dayIndex < 0) return null;
              return (
                <TimelineBlock
                  key={entry.id}
                  columnCount={viewMode === "week" ? weekDays.length : 1}
                  dayIndex={dayIndex}
                  draft={resizeDraft?.entryId === entry.id ? resizeDraft : null}
                  entry={entry}
                  isResizing={resizingId === entry.id}
                  isSelected={selectedEntryId === entry.id}
                  pixelsPerHour={zoom.pixelsPerHour}
                  viewMode={viewMode}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedEntryId(entry.id);
                    setContextMenu({
                      entry,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  onEdit={() => setEditingEntry(entry)}
                  onResizeStart={startResize}
                  onSelect={() => setSelectedEntryId(entry.id)}
                />
              );
            })}
            {sorted.length === 0 ? (
              <div className="swiss-empty-timeline">
                <Clock3 size={18} />
                No entries for this {viewMode}.
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="swiss-day-footer">
        <button type="button" onClick={onAddEntry}>
          <Plus size={17} />
          Add time block
        </button>
        <span>Total logged: {formatDuration(displayedTotal)}</span>
        <button type="button" onClick={() => setShowSummary((current) => !current)}>
          {showSummary ? "Hide summary" : "Show summary"} <ChevronDown size={14} />
        </button>
      </div>
      {contextMenu ? (
        <div
          className="swiss-entry-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => setEditingEntry(contextMenu.entry)}>
            <Edit3 size={15} />
            Edit block
          </button>
          <button type="button" role="menuitem" onClick={() => void deleteEntry(contextMenu.entry.id)}>
            <Trash2 size={15} />
            Delete block
          </button>
        </div>
      ) : null}
      {editingEntry ? (
        <EditTimeEntryDialog
          categories={data.categories}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await onEntryUpdated();
          }}
          places={data.places}
          tags={data.tags}
        />
      ) : null}
      {resizeError ? <p className="swiss-resize-error">{resizeError}</p> : null}
    </section>
  );
}

type EntryContextMenu = {
  entry: TimeEntryRow;
  x: number;
  y: number;
};

type ResizeEdge = "start" | "end";

type ResizeDraft = {
  entryId: string;
  startedAt: string;
  stoppedAt: string;
};

function TimelineBlock({
  columnCount,
  dayIndex,
  draft,
  entry,
  isResizing,
  isSelected,
  pixelsPerHour,
  viewMode,
  onContextMenu,
  onEdit,
  onResizeStart,
  onSelect
}: {
  columnCount: number;
  dayIndex: number;
  draft: ResizeDraft | null;
  entry: TimeEntryRow;
  isResizing: boolean;
  isSelected: boolean;
  pixelsPerHour: number;
  viewMode: "day" | "week";
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onEdit: () => void;
  onResizeStart: (
    entry: TimeEntryRow,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
  onSelect: () => void;
}) {
  const start = new Date(draft?.startedAt ?? entry.startedAt);
  const end = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : projectedEntryEnd(entry);
  const top =
    ((start.getHours() * 60 + start.getMinutes() - dayStartHour * 60) / 60) * pixelsPerHour;
  const rawHeight = ((end.getTime() - start.getTime()) / 3_600_000) * pixelsPerHour;
  const height = Math.max(minimumTimeBlockHeight(pixelsPerHour), rawHeight);
  const color = pastelFor(entry);
  const durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const density = getTimeBlockDensity({ durationSeconds, height });
  const detailsLabel = timelineBlockDetailsLabel(entry, start, end, durationSeconds);
  const weekLeft = (dayIndex / columnCount) * 100;
  const weekWidth = 100 / columnCount;
  const positionStyle: CSSProperties =
    viewMode === "week"
      ? {
          left: `calc(${weekLeft}% + 5px)`,
          right: "auto",
          width: `calc(${weekWidth}% - 10px)`
        }
      : {};

  return (
    <article
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={detailsLabel}
      title={detailsLabel}
      className={[
        "swiss-time-block",
        isResizing ? "is-resizing" : "",
        isSelected ? "is-selected" : "",
        entry.stoppedAt ? "" : "is-running",
        ...timeBlockDensityClassNames(density),
        viewMode === "week" ? "is-compact" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        event.preventDefault();
        onEdit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit();
      }}
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      style={{
        top: Math.round(Math.max(0, top)),
        height: Math.round(height),
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        ...positionStyle
      }}
    >
      {entry.stoppedAt ? (
        <>
          <button
            type="button"
            className="swiss-resize-handle top"
            aria-label={`Resize start of ${timeEntryTitle(entry)}`}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => onResizeStart(entry, "start", event)}
          />
          <button
            type="button"
            className="swiss-resize-handle bottom"
            aria-label={`Resize end of ${timeEntryTitle(entry)}`}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => onResizeStart(entry, "end", event)}
          />
        </>
      ) : null}
      {density.showTitle ? (
        <div>
          <strong>{timeEntryTitle(entry)}</strong>
          {density.showContext ? <span>{timeEntryContextLabel(entry)}</span> : null}
          {density.showContext ? <TagMetadata tagNames={entry.tagNames} /> : null}
        </div>
      ) : null}
      {density.showDuration ? (
        <div>
          {entry.stoppedAt ? <EntryIcon entry={entry} /> : null}
          <b>{formatDuration(durationSeconds)}</b>
        </div>
      ) : null}
    </article>
  );
}

function timelineBlockDetailsLabel(
  entry: TimeEntryRow,
  start: Date,
  end: Date,
  durationSeconds: number
) {
  const timeRange = `${formatTime(start)} - ${entry.stoppedAt ? formatTime(end) : "now"}`;
  const durationLabel = entry.stoppedAt
    ? formatDuration(durationSeconds)
    : `Running, ${formatDuration(durationSeconds)}`;
  return [timeEntryTitle(entry), timeEntryContextLabel(entry), timeRange, durationLabel].join(". ");
}

function DashboardReviewInbox({
  items
}: {
  items: BootstrapData["reviewItems"];
}) {
  const openItems = items.filter((item) => item.status === "open").slice(0, 5);

  return (
    <section className="swiss-panel swiss-list-panel">
      <div className="swiss-list-header">
        <h2>Review inbox</h2>
        <span>{items.filter((item) => item.status === "open").length} items</span>
      </div>
      <div className="swiss-review-list">
        {openItems.map((item) => {
          const display = reviewItemDisplay(item);
          return (
            <Link key={item.id} href="/review" className="swiss-review-row">
              <span className="swiss-checkbox" />
              <HelpCircle size={20} />
              <span>
                <strong>{display.title}</strong>
                <small>
                  {display.meta} ·{" "}
                  {item.suggestedStartedAt ? formatTime(item.suggestedStartedAt) : "Needs time"}
                </small>
              </span>
              <b>
                {item.suggestedStartedAt && item.suggestedStoppedAt
                  ? formatDuration(
                      Math.round(
                        (new Date(item.suggestedStoppedAt).getTime() -
                          new Date(item.suggestedStartedAt).getTime()) /
                          1000
                      )
                    )
                  : "—"}
              </b>
              <ArrowRight size={16} />
            </Link>
          );
        })}
        {openItems.length === 0 ? <p className="swiss-empty-list">No open review items.</p> : null}
      </div>
      <Link href="/review" className="swiss-panel-link">
        Open full review inbox <ArrowRight size={15} />
      </Link>
    </section>
  );
}

function reviewItemDisplay(item: BootstrapData["reviewItems"][number]) {
  const evidenceKind = typeof item.rawPayload?.evidenceKind === "string" ? item.rawPayload.evidenceKind : null;
  const eventType = item.eventType ?? item.type;
  const typeLabel =
    eventType === "commute_detected"
      ? "Commute suggestion"
      : eventType === "learned_place_visit" || eventType === "geofence_exit" || evidenceKind === "learned_place"
        ? "Detected visit"
        : formatEventLabel(eventType);
  const title = typeLabel === "Detected visit" && item.placeName
    ? `Detected visit to ${item.placeName}`
    : typeLabel === "Commute suggestion"
      ? "Commute suggestion"
      : item.title;
  const meta = [item.categoryName ?? "Needs category", item.placeName, typeLabel]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
    .join(" · ");
  return { title, meta };
}

function RecentActivityPanel({ data }: { data: BootstrapData }) {
  return (
    <section className="swiss-panel swiss-list-panel">
      <div className="swiss-list-header">
        <h2>Recent activity</h2>
        <Link href="/timeline?view=list">View all</Link>
      </div>
      <div className="swiss-activity-list">
        {data.activityEvents.slice(0, 5).map((event) => {
          const Icon = event.eventType.includes("timer")
            ? Clock3
            : event.eventType.includes("review")
              ? CheckCircle2
              : event.eventType.includes("delete")
                ? Trash2
                : Edit3;
          return (
            <div key={event.id} className="swiss-activity-row">
              <Icon size={22} />
              <span>
                <strong>{event.categoryName ?? event.placeName ?? formatEventLabel(event.eventType)}</strong>
                <small>
                  {[formatEventLabel(event.eventType), event.placeName, formatSourceLabel(event.source)]
                    .filter((part, index, parts) => part && parts.indexOf(part) === index)
                    .join(" · ")}
                </small>
              </span>
              <time>{formatTime(event.occurredAt)}</time>
            </div>
          );
        })}
        {data.activityEvents.length === 0 ? <p className="swiss-empty-list">No recent activity.</p> : null}
      </div>
    </section>
  );
}

function pastelFor(entry: TimeEntryRow) {
  const accent = timeEntryAccentColor(entry);
  return {
    background: `color-mix(in srgb, ${accent} 18%, var(--surface))`,
    border: accent,
    text: "var(--block-text)"
  };
}

function EntryIcon({ entry }: { entry: TimeEntryRow }) {
  const label = `${entry.description ?? ""} ${entry.categoryName ?? ""} ${entry.placeName ?? ""}`.toLowerCase();
  if (label.includes("gym") || label.includes("walk")) return <Users size={16} />;
  if (label.includes("lunch") || label.includes("food")) return <Utensils size={16} />;
  if (label.includes("town") || label.includes("place")) return <MapPin size={16} />;
  if (label.includes("admin")) return <Laptop size={16} />;
  return <Clock3 size={16} />;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - mondayOffset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getWeekDays(start: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return next;
  });
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatAxisMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function clampAxisLabelTop(top: number, height: number) {
  return Math.min(Math.max(0, height - timelineAxisLabelHeight), Math.max(0, top - timelineAxisLabelHeight / 2));
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function snapMinutes(value: number) {
  return Math.round(value / resizeSnapMinutes) * resizeSnapMinutes;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isoForDateMinutes(dateValue: string, minutes: number) {
  const iso = dateTimeLocalInputToIso(`${dateValue}T${formatAxisMinutes(minutes)}`);
  if (!iso) throw new Error("Invalid timeline time.");
  return iso;
}

function projectedEntryEnd(entry: TimeEntryRow) {
  return new Date(new Date(entry.startedAt).getTime() + entry.durationSeconds * 1000);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
