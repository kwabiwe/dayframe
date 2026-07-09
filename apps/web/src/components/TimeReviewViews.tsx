"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, List, Table2 } from "lucide-react";
import { CurrentTimerPanel } from "@/components/DashboardRealtime";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { EntriesTable } from "@/components/EntriesTable";
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
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "@/lib/time-block-display";

type TimeView = "calendar" | "list" | "timesheet";
type CalendarMode = "week" | "day";
type CalendarHoursMode = "awake" | "fullDay";

const viewItems: Array<{ id: TimeView; label: string; icon: ReactNode }> = [
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={16} /> },
  { id: "list", label: "List", icon: <List size={16} /> },
  { id: "timesheet", label: "Timesheet", icon: <Table2 size={16} /> }
];

const calendarHourModes: Record<CalendarHoursMode, { label: string; startHour: number; endHour: number }> = {
  awake: { label: "Awake", startHour: 6, endHour: 22 },
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

const timelinePreferenceEvent = "dayframe:timeline-preference";

function isTimeView(value: string | null): value is TimeView {
  return value === "calendar" || value === "list" || value === "timesheet";
}

function isCalendarMode(value: string | null): value is CalendarMode {
  return value === "week" || value === "day";
}

function isCalendarHoursMode(value: string | null): value is CalendarHoursMode {
  return value === "awake" || value === "fullDay";
}

function readTimelinePreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeTimelinePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(timelinePreferenceEvent));
  } catch {
    // Preference persistence is best-effort; tab switching should still work.
  }
}

function subscribeTimelinePreference(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  window.addEventListener(timelinePreferenceEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(timelinePreferenceEvent, callback);
  };
}

function useTimelinePreference(key: string) {
  return useSyncExternalStore(
    subscribeTimelinePreference,
    () => readTimelinePreference(key),
    () => null
  );
}

export function TimeReviewViews({
  initialData
}: {
  initialData: BootstrapData;
}) {
  const [data, setData] = useState(initialData);
  const [activeViewOverride, setActiveViewOverride] = useState<TimeView | null>(null);
  const [calendarModeOverride, setCalendarModeOverride] = useState<CalendarMode | null>(null);
  const [calendarHoursModeOverride, setCalendarHoursModeOverride] = useState<CalendarHoursMode | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date(initialData.dateRange.selectedDate)));
  const timelineViewStorageKey = `dayframe.timeline.${data.workspace.id}.view`;
  const calendarModeStorageKey = `dayframe.timeline.${data.workspace.id}.calendarMode`;
  const calendarHoursStorageKey = `dayframe.timeline.${data.workspace.id}.hours`;
  const storedView = useTimelinePreference(timelineViewStorageKey);
  const storedCalendarMode = useTimelinePreference(calendarModeStorageKey);
  const storedCalendarHours = useTimelinePreference(calendarHoursStorageKey);
  const activeView = activeViewOverride ?? (isTimeView(storedView) ? storedView : "calendar");
  const calendarMode =
    calendarModeOverride ?? (isCalendarMode(storedCalendarMode) ? storedCalendarMode : "week");
  const calendarHoursMode =
    calendarHoursModeOverride ?? (isCalendarHoursMode(storedCalendarHours) ? storedCalendarHours : "awake");

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch(`/api/bootstrap?date=${data.dateRange.selectedDate}`, {
        cache: "no-store"
      });
      if (response.ok) setData((await response.json()) as BootstrapData);
    } catch {
      // Navigation can interrupt polling; the next visible tick will retry.
    }
  }, [data.dateRange.selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshData();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [refreshData]);

  function updateView(view: TimeView) {
    setActiveViewOverride(view);
    writeTimelinePreference(timelineViewStorageKey, view);
  }

  function updateCalendarMode(mode: CalendarMode) {
    setCalendarModeOverride(mode);
    writeTimelinePreference(calendarModeStorageKey, mode);
  }

  function updateCalendarHoursMode(mode: CalendarHoursMode) {
    setCalendarHoursModeOverride(mode);
    writeTimelinePreference(calendarHoursStorageKey, mode);
  }

  const weekDays = useMemo(() => getWeekDays(weekAnchor), [weekAnchor]);
  const weekEntries = useMemo(
    () => data.entries.filter((entry) => entryOverlapsRange(entry, weekAnchor, addDays(weekAnchor, 7))),
    [data.entries, weekAnchor]
  );
  const weekTotal = weekEntries.reduce((sum, entry) => sum + entryOverlapSeconds(entry, weekAnchor, addDays(weekAnchor, 7)), 0);

  return (
    <section className="space-y-5">
      <CurrentTimerPanel key={data.activeEntry?.id ?? "inactive"} data={data} onSynced={setData} />

      <div className="industrial-panel rounded-xl p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[220px] rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2">
              <div className="text-sm font-semibold">This week</div>
              <div className="tabular mt-1 text-xs text-[var(--muted)]">
                {formatDate(weekDays[0])} - {formatDate(weekDays[6])}
              </div>
            </div>
            <button
              className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              type="button"
              aria-label="Next week"
              onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}
            >
              <ChevronRight size={16} />
            </button>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-sm">
              <span className="text-[var(--muted)]">Week total </span>
              <span className="tabular font-semibold">{formatDuration(weekTotal)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--surface-inset)]">
            {viewItems.map((item) => {
              const selected = item.id === activeView;
              return (
                <button
                  key={item.id}
                  className={[
                    "focus-ring flex min-h-10 min-w-[116px] items-center justify-center gap-2 border-r border-[var(--line)] px-3 text-sm last:border-r-0",
                    selected
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "text-[var(--foreground)] hover:text-[var(--accent)]"
                  ].join(" ")}
                  type="button"
                  onClick={() => updateView(item.id)}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeView === "calendar" ? (
        <CalendarReview
          calendarHoursMode={calendarHoursMode}
          calendarMode={calendarMode}
          categories={data.categories}
          entries={weekEntries}
          onSynced={refreshData}
          places={data.places}
          setCalendarHoursMode={updateCalendarHoursMode}
          setCalendarMode={updateCalendarMode}
          weekDays={weekDays}
        />
      ) : null}
      {activeView === "list" ? (
        <EntriesTable
          entries={data.entries}
          categories={data.categories}
          places={data.places}
          groupByDay
          onChanged={refreshData}
        />
      ) : null}
      {activeView === "timesheet" ? <TimesheetView entries={weekEntries} weekDays={weekDays} /> : null}
    </section>
  );
}

function CalendarReview({
  calendarHoursMode,
  calendarMode,
  categories,
  entries,
  onSynced,
  places,
  setCalendarHoursMode,
  setCalendarMode,
  weekDays
}: {
  calendarHoursMode: CalendarHoursMode;
  calendarMode: CalendarMode;
  categories: CategoryRow[];
  entries: TimeEntryRow[];
  onSynced: () => Promise<void>;
  places: PlaceRow[];
  setCalendarHoursMode: (mode: CalendarHoursMode) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  weekDays: Date[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [resizeDraft, setResizeDraft] = useState<CalendarResizeDraft | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<CalendarZoom>("hour");
  const today = new Date();
  const zoom = calendarZooms[zoomLevel];
  const calendarHours = calendarHourModes[calendarHoursMode];
  const zoomKeys = Object.keys(calendarZooms) as CalendarZoom[];
  const zoomIndex = zoomKeys.indexOf(zoomLevel);
  const rowHeight = zoom.pixelsPerHour;
  const gridLineSpacing = (zoom.intervalMinutes / 60) * rowHeight;
  const calendarHeight = (calendarHours.endHour - calendarHours.startHour) * rowHeight;
  const visibleDays =
    calendarMode === "day"
      ? [weekDays.find((day) => sameDay(day, today)) ?? today]
      : weekDays;
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

  async function saveCalendarResize(entry: TimeEntryRow, draft: CalendarResizeDraft) {
    const response = await fetch(`/api/time-entries/${entry.id}`, {
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
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    if (!entry.stoppedAt) return;
    const dayColumn = event.currentTarget.closest("[data-calendar-day-body]") as HTMLElement | null;
    if (!dayColumn) return;

    event.preventDefault();
    event.stopPropagation();

    const columnRect = dayColumn.getBoundingClientRect();
    const originalStart = minutesFromDate(new Date(entry.startedAt));
    const originalEnd = minutesFromDate(new Date(entry.stoppedAt));
    const ranges = entries
      .filter((candidate) => candidate.id !== entry.id && candidate.stoppedAt && sameDay(new Date(candidate.startedAt), day))
      .map((candidate) => ({
        start: minutesFromDate(new Date(candidate.startedAt)),
        end: minutesFromDate(new Date(candidate.stoppedAt as string))
      }))
      .sort((a, b) => a.start - b.start);
    const timelineStart = calendarHours.startHour * 60;
    const timelineEnd = calendarHours.endHour * 60;
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
        startedAt: isoForDateMinutes(day, nextStartMinutes),
        stoppedAt: isoForDateMinutes(day, nextEndMinutes)
      };
      setResizeDraft(finalDraft);
    };

    const beginResize = () => {
      if (hasStartedResize) return;
      hasStartedResize = true;
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
    <section className="industrial-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Double click a block to edit it. Drag the top or bottom edge to resize.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="swiss-view-switch" aria-label="Calendar view">
            {(["week", "day"] as CalendarMode[]).map((mode) => (
              <button
                key={mode}
                className={calendarMode === mode ? "is-selected" : ""}
                type="button"
                onClick={() => setCalendarMode(mode)}
              >
                {mode === "week" ? "Week" : "Day"}
              </button>
            ))}
          </span>
          <span className="swiss-zoom-control" aria-label="Calendar zoom">
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
          <span className="swiss-view-switch" aria-label="Calendar hours">
            {(["awake", "fullDay"] as CalendarHoursMode[]).map((mode) => (
              <button
                key={mode}
                className={calendarHoursMode === mode ? "is-selected" : ""}
                type="button"
                onClick={() => setCalendarHoursMode(mode)}
              >
                {calendarHourModes[mode].label}
              </button>
            ))}
          </span>
        </div>
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
              .filter((entry) => entryOverlapsDay(entry, day))
              .reduce((sum, entry) => sum + entryOverlapSeconds(entry, day, addDays(day, 1)), 0);
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
              {entries
                .filter((entry) => entryOverlapsDay(entry, day))
                .map((entry) => {
                  const activeDraft = resizeDraft?.entryId === entry.id ? resizeDraft : null;
                  const blockStyle = calendarBlockStyle(entry, activeDraft, day, rowHeight, calendarHeight, calendarHours);
                  if (!blockStyle) return null;
                  const { continuesIntoNextDay, ...blockPositionStyle } = blockStyle;
                  const durationSeconds = calendarDurationSeconds(entry, activeDraft);
                  const density = getTimeBlockDensity({
                    durationSeconds,
                    height: blockPositionStyle.height
                  });
                  const detailsLabel = calendarBlockDetailsLabel(entry, activeDraft, durationSeconds);
                  return (
                    <article
                      key={entry.id}
                      className={[
                        "focus-ring absolute left-2 right-2 overflow-hidden border p-2 text-left text-xs",
                        "calendar-time-block",
                        selectedEntryId === entry.id ? "outline outline-2 outline-offset-1 outline-[var(--foreground)]" : "",
                        resizingId === entry.id ? "is-resizing" : "",
                        entry.stoppedAt ? "" : "is-running",
                        continuesIntoNextDay ? "is-continuation-to-next" : "",
                        ...timeBlockDensityClassNames(density)
                      ].join(" ")}
                      style={{
                        ...blockPositionStyle,
                        backgroundColor: timeEntryAccentColor(entry),
                        borderColor: "color-mix(in srgb, var(--foreground) 28%, transparent)",
                        color: "var(--on-pastel)"
                      }}
                      role="button"
                      tabIndex={0}
                      data-entry-id={entry.id}
                      title={detailsLabel}
                      aria-label={detailsLabel}
                      onClick={() => setSelectedEntryId(entry.id)}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        setEditingEntry(entry);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          setEditingEntry(entry);
                        }
                      }}
                      onMouseDown={(event) => {
                        if (event.detail > 1) event.preventDefault();
                      }}
                    >
                      {entry.stoppedAt ? (
                        <>
                          <button
                            type="button"
                            className="swiss-resize-handle top"
                            aria-label={`Resize start of ${timeEntryTitle(entry)}`}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => startCalendarResize(entry, day, "start", event)}
                          />
                          <button
                            type="button"
                            className="swiss-resize-handle bottom"
                            aria-label={`Resize end of ${timeEntryTitle(entry)}`}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => startCalendarResize(entry, day, "end", event)}
                          />
                        </>
                      ) : null}
                      {density.showTitle ? (
                        <>
                          <span className="block truncate font-semibold">{timeEntryTitle(entry)}</span>
                          {density.showContext ? (
                            <span className="block truncate opacity-80">
                              {timeEntryContextLabel(entry)}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                      {density.showDuration ? <span className="tabular block">{formatDuration(durationSeconds)}</span> : null}
                    </article>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {resizeError ? <p className="border-t border-[var(--line)] px-4 py-2 text-sm text-[var(--danger)]">{resizeError}</p> : null}
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
        />
      ) : null}
    </section>
  );
}

function TimesheetView({ entries, weekDays }: { entries: TimeEntryRow[]; weekDays: Date[] }) {
  const rows = Array.from(
    entries.reduce((totals, entry) => {
      const key = entry.categoryId ?? `uncategorized:${entry.categoryName ?? "time"}`;
      const current = totals.get(key) ?? {
        id: key,
        name: key,
        label: timeEntryCategoryLabel(entry),
        categoryName: entry.categoryName,
        color: timeEntryCategoryColor(entry),
        days: Array(7).fill(0) as number[],
        total: 0
      };
      const dayIndex = weekDays.findIndex((day) => sameDay(day, new Date(entry.startedAt)));
      if (dayIndex >= 0) current.days[dayIndex] += entry.durationSeconds;
      current.total += entry.durationSeconds;
      totals.set(key, current);
      return totals;
    }, new Map<string, { id: string; name: string; label: string; categoryName: string | null; color: string; days: number[]; total: number }>())
  )
    .map(([, row]) => row)
    .sort((a, b) => b.total - a.total);
  const dailyTotals = weekDays.map((_, dayIndex) =>
    rows.reduce((sum, row) => sum + row.days[dayIndex], 0)
  );

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
                  <span className="h-3 w-3 border border-[var(--line-strong)]" style={{ backgroundColor: row.color }} />
                  {row.label}
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
              <td className="tabular px-3 py-3 font-semibold text-[var(--accent)]">{formatDuration(row.total)}</td>
            </tr>
          ))}
          <tr className="bg-[var(--surface-inset)] font-semibold">
            <td className="border-r border-[var(--line)] px-3 py-3">Daily total</td>
            {dailyTotals.map((seconds, index) => (
              <td key={weekDays[index].toISOString()} className="tabular border-r border-[var(--line)] px-3 py-3">
                {formatDuration(seconds)}
              </td>
            ))}
            <td className="tabular px-3 py-3 text-[var(--accent)]">
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
  calendarHours: { startHour: number; endHour: number }
) {
  const start = new Date(draft?.startedAt ?? entry.startedAt);
  const stoppedAt = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : projectedEntryEnd(entry);
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
  const startMinutes = (visibleStart.getTime() - axisStart.getTime()) / 60_000;
  const durationMinutes = Math.max(1, (visibleEnd.getTime() - visibleStart.getTime()) / 60_000);
  const minimumHeight = minimumTimeBlockHeight(rowHeight);
  const top = Math.min(calendarHeight - minimumHeight, Math.max(0, (startMinutes / 60) * rowHeight));
  const height = Math.min(calendarHeight - top, Math.max(minimumHeight, (durationMinutes / 60) * rowHeight));
  return {
    top: Math.round(top),
    height: Math.round(height),
    continuesIntoNextDay: stoppedAt > dayEnd
  };
}

function calendarBlockDetailsLabel(
  entry: TimeEntryRow,
  draft: CalendarResizeDraft | null,
  durationSeconds: number
) {
  const start = draft?.startedAt ?? entry.startedAt;
  const stoppedAt = draft?.stoppedAt ?? entry.stoppedAt;
  const timeRange = `${formatTime(start)} - ${stoppedAt ? formatTime(stoppedAt) : "now"}`;
  const durationLabel = stoppedAt ? formatDuration(durationSeconds) : `Running, ${formatDuration(durationSeconds)}`;
  return `${timeEntryTitle(entry)}. ${timeEntryContextLabel(entry)}. ${timeRange}. ${durationLabel}`;
}

function calendarDurationSeconds(entry: TimeEntryRow, draft: CalendarResizeDraft | null = null) {
  const start = new Date(draft?.startedAt ?? entry.startedAt);
  const stoppedAt = draft?.stoppedAt
    ? new Date(draft.stoppedAt)
    : entry.stoppedAt
      ? new Date(entry.stoppedAt)
      : projectedEntryEnd(entry);
  return Math.max(0, Math.round((stoppedAt.getTime() - start.getTime()) / 1000));
}

function projectedEntryEnd(entry: TimeEntryRow) {
  return new Date(new Date(entry.startedAt).getTime() + entry.durationSeconds * 1000);
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

function startOfWeek(input: Date) {
  const date = new Date(input);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
}

function getWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function entryOverlapsDay(entry: TimeEntryRow, day: Date) {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return entryOverlapsRange(entry, start, addDays(start, 1));
}

function entryOverlapsRange(entry: TimeEntryRow, rangeStart: Date, rangeEnd: Date) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : projectedEntryEnd(entry);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < rangeEnd && stoppedAt > rangeStart;
}

function entryOverlapSeconds(entry: TimeEntryRow, rangeStart: Date, rangeEnd: Date) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : projectedEntryEnd(entry);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) return 0;
  const overlapStart = Math.max(startedAt.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(stoppedAt.getTime(), rangeEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / 1000);
}
