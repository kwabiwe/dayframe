"use client";

import {
  Fragment,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Ellipsis, Minus, Pencil, Play, Trash2 } from "lucide-react";
import { analyzeTimeIntervals, type TimeIntervalAnalysisEntry } from "@dayframe/shared";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { TagMetadata } from "@/components/TagMetadata";
import { IconButton } from "@/components/ui/Primitives";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { CategoryRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocal,
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import { timelineEntryDisplayInterval } from "@/lib/timeline-calculations";
import { groupTimelineEntriesByDay } from "@/lib/timeline-entry-groups";
import {
  buildTimelineInlineSavePlan,
  createTimelineInlineEditDraft,
  updateTimelineInlineDate,
  updateTimelineInlineDescription,
  updateTimelineInlineTime,
  type TimelineInlineEditDraft,
  type TimelineInlineEditField,
  type TimelineInlineTimeEdge
} from "@/lib/timeline-inline-edit";
import type { DateRange } from "@/lib/time-entry-overlap";

type TimelineInlineEditorState = TimelineInlineEditDraft & {
  entryId: string;
  error: string | null;
  isSaving: boolean;
  sessionId: number;
};

function TimelineInlineTimeControl({
  date,
  disabled,
  edge,
  entryId,
  entryTitle,
  onBeginEdit,
  onDateChange,
  onKeyDown,
  onPickerOpenChange,
  onTimeChange,
  today,
  value,
  readOnly
}: {
  date: string;
  disabled?: boolean;
  edge: TimelineInlineTimeEdge;
  entryId: string;
  entryTitle: string;
  onBeginEdit: () => void;
  onDateChange: (date: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPickerOpenChange: (open: boolean) => void;
  onTimeChange: (time: string) => void;
  readOnly: boolean;
  today: string;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const edgeLabel = edge === "start" ? "Start" : "Finish";
  const panelId = `timeline-inline-date-${entryId}-${edge}`;

  function updateDatePickerOpen(open: boolean) {
    setDatePickerOpen(open);
    onPickerOpenChange(open);
  }

  return (
    <span className="timeline-inline-time-control">
      <input
        aria-controls={panelId}
        aria-expanded={datePickerOpen}
        aria-haspopup="dialog"
        aria-label={`${edgeLabel} time for ${entryTitle}`}
        className="timeline-inline-time-input"
        data-inline-entry-id={entryId}
        data-inline-field="time"
        disabled={disabled}
        inputMode="numeric"
        maxLength={5}
        onChange={(event) => onTimeChange(event.target.value)}
        onClick={() => {
          onBeginEdit();
          updateDatePickerOpen(true);
        }}
        onFocus={onBeginEdit}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        ref={inputRef}
        role="combobox"
        title={`Edit ${edgeLabel.toLowerCase()} time and choose its date`}
        type="text"
        value={value}
      />
      <DatePickerPopover
        anchorRef={inputRef}
        ariaLabel={`Choose ${edgeLabel} date, currently ${formatDate(`${date}T12:00:00`)}`}
        className="timeline-inline-date-picker"
        disabled={disabled}
        label={formatDate(`${date}T12:00:00`)}
        onChange={onDateChange}
        onOpenChange={updateDatePickerOpen}
        open={datePickerOpen}
        panelId={panelId}
        panelClassName="timeline-inline-date-picker-panel"
        panelLabel={`Choose ${edgeLabel} date`}
        portal
        showTrigger={false}
        today={today}
        value={date}
      />
    </span>
  );
}

export function EntriesTable({
  entries,
  categories,
  tags = [],
  groupByDay = false,
  onDeleteEntries,
  onChanged,
  onScroll,
  scrollContainerRef,
  displayRange,
  capturedNow = new Date()
}: {
  entries: TimeEntryRow[];
  categories: CategoryRow[];
  tags?: TagRow[];
  groupByDay?: boolean;
  onDeleteEntries: (entries: readonly TimeEntryRow[]) => void;
  onChanged?: () => Promise<void>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  displayRange?: DateRange;
  capturedNow?: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    clearTimerError,
    isTimerBusy,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [inlineEditor, setInlineEditor] = useState<TimelineInlineEditorState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<TimelineInlineEditorState | null>(null);
  const [openInlineDatePickerKey, setOpenInlineDatePickerKey] = useState<string | null>(null);
  const inlineSessionRef = useRef(0);
  const highlightedEntryId = searchParams.get("entry");

  useEffect(() => {
    inlineEditorRef.current = inlineEditor;
  }, [inlineEditor]);

  const overlapAnalysis = useMemo(
    () => analyzeTimeIntervals(
      entries.map((entry) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      {
        ...(displayRange ? { range: displayRange } : {}),
        now: capturedNow
      }
    ),
    [capturedNow, displayRange, entries]
  );
  const overlapById = useMemo(
    () => new Map(overlapAnalysis.entries.map((entry) => [entry.id, entry])),
    [overlapAnalysis.entries]
  );
  const grouped = useMemo(() => {
    return groupTimelineEntriesByDay(
      entries,
      (entry) => formatDate(timelineEntryDisplayInterval(entry, displayRange, capturedNow).startedAt)
    ).map((group) => ({
      ...group,
      key: `${group.day}:${group.key}`,
      totalSeconds: group.entries.reduce(
        (sum, entry) => sum + intervalSeconds(timelineEntryDisplayInterval(entry, displayRange, capturedNow), capturedNow),
        0
      )
    }));
  }, [capturedNow, displayRange, entries]);

  useEffect(() => {
    if (!highlightedEntryId) return;
    const frame = window.requestAnimationFrame(() => {
      const container = listScrollRef.current;
      const target = document.getElementById(`timeline-entry-${highlightedEntryId}`);
      if (!container || !target) return;
      const containerBounds = container.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + targetBounds.top - containerBounds.top - container.clientHeight / 2 + targetBounds.height / 2,
        behavior: "auto"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [grouped, highlightedEntryId]);

  async function continueEntry(entry: TimeEntryRow, surface: "row" | "editor" = "row") {
    if (continuingEntryId || isTimerBusy) {
      const outcome = { ok: false, error: "A timer update is already in progress." } as const;
      if (surface === "row") setActionError(outcome.error);
      return outcome;
    }

    setContinuingEntryId(entry.id);
    setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) {
        clearTimerError();
        if (surface === "row") setActionError(outcome.error);
      }
      return outcome;
    } catch (error) {
      const outcome = {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to start this task."
      } as const;
      if (surface === "row") setActionError(outcome.error);
      return outcome;
    } finally {
      setContinuingEntryId(null);
    }
  }

  function beginInlineEdit(
    entry: TimeEntryRow,
    field: TimelineInlineEditField,
    displayInterval?: { startedAt: string; stoppedAt: string | null }
  ) {
    const current = inlineEditorRef.current;
    if (current?.entryId === entry.id && current.field === field) return;
    if (isPending || current?.isSaving || (isTimerBusy && !entry.stoppedAt)) return;
    const next: TimelineInlineEditorState = {
      ...createTimelineInlineEditDraft(entry, field, displayInterval),
      entryId: entry.id,
      error: null,
      isSaving: false,
      sessionId: ++inlineSessionRef.current
    };
    inlineEditorRef.current = next;
    setInlineEditor(next);
    setActionError(null);
  }

  function cancelInlineEdit(entryId: string) {
    if (inlineEditorRef.current?.entryId !== entryId) return;
    setOpenInlineDatePickerKey(null);
    inlineEditorRef.current = null;
    setInlineEditor(null);
  }

  function openFullEditor(entry: TimeEntryRow) {
    setOpenInlineDatePickerKey(null);
    inlineEditorRef.current = null;
    setInlineEditor(null);
    setEditingEntry(entry);
  }

  function updateInlineDescription(entryId: string, description: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entryId || current.field !== "description" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineDescription(current, description);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  function updateInlineTime(entry: TimeEntryRow, edge: TimelineInlineTimeEdge, value: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entry.id || current.field !== "time" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineTime(current, entry, edge, value);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  function updateInlineDate(entry: TimeEntryRow, edge: TimelineInlineTimeEdge, value: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entry.id || current.field !== "time" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineDate(current, entry, edge, value);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  async function commitInlineEdit(entry: TimeEntryRow, returnFocus?: HTMLElement | null) {
    const current = inlineEditorRef.current;
    if (!current || current.entryId !== entry.id || current.isSaving) return;

    let plan;
    try {
      plan = buildTimelineInlineSavePlan(current, entry, capturedNow);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the time values.";
      const next = { ...current, error: message };
      inlineEditorRef.current = next;
      setInlineEditor(next);
      window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
      return;
    }

    if (!Object.keys(plan.payload).length) {
      cancelInlineEdit(entry.id);
      return;
    }

    const saving = { ...current, error: null, isSaving: true };
    inlineEditorRef.current = saving;
    setInlineEditor(saving);
    const outcome = entry.stoppedAt
      ? await saveTimeEntryQuickEdit(entry.id, plan)
      : await updateActiveEntryFromCalendar({ plan });
    const latest = inlineEditorRef.current;

    if (!outcome.ok) {
      if (latest?.sessionId !== current.sessionId) {
        setActionError(outcome.error);
        return;
      }
      const failed = { ...saving, error: outcome.error, isSaving: false };
      inlineEditorRef.current = failed;
      setInlineEditor(failed);
      window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
      return;
    }

    if (latest?.sessionId === current.sessionId) {
      inlineEditorRef.current = null;
      setInlineEditor(null);
    }
    await onChanged?.();
    startTransition(() => router.refresh());
  }

  function handleInlineKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    entry: TimeEntryRow,
    field: TimelineInlineEditField,
    displayInterval?: { startedAt: string; stoppedAt: string | null }
  ) {
    const active = inlineEditorRef.current?.entryId === entry.id && inlineEditorRef.current.field === field;
    if (!active && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      beginInlineEdit(entry, field, displayInterval);
      return;
    }
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineEdit(entry.id);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void commitInlineEdit(entry, event.currentTarget);
    }
  }

  function renderInlineDescription(entry: TimeEntryRow, canInlineEdit = true) {
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "description"
      ? inlineEditor
      : null;
    const value = editor ? editor.draft.description : timeEntryTitle(entry);
    return (
      <span
        className={`timeline-inline-description${editor ? " is-editing" : ""}`}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFullEditor(entry);
        }}
      >
        <span aria-hidden="true" className="timeline-inline-description-measure timeline-task-title">
          {value || "Untitled task"}
        </span>
        <input
          aria-label={`${timeEntryTitle(entry)} description. ${canInlineEdit ? "Click to edit inline. " : ""}Double-click to open the full editor.`}
          className="timeline-task-title timeline-inline-description-input"
          data-inline-entry-id={entry.id}
          data-inline-field="description"
          onBlur={(event) => {
            if (editor) void commitInlineEdit(entry, event.currentTarget);
          }}
          onChange={(event) => updateInlineDescription(entry.id, event.target.value)}
          onClick={() => {
            if (canInlineEdit && !editor) beginInlineEdit(entry, "description");
          }}
          onKeyDown={(event) => {
            if (canInlineEdit) handleInlineKeyDown(event, entry, "description");
            else if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              openFullEditor(entry);
            }
          }}
          placeholder="Untitled task"
          readOnly={!editor || editor.isSaving}
          title={canInlineEdit ? "Click to edit. Double-click for the full editor." : "Double-click for the full editor."}
          value={value}
        />
      </span>
    );
  }

  function renderInlineTime(
    entry: TimeEntryRow,
    interval: { startedAt: string; stoppedAt: string | null }
  ) {
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "time"
      ? inlineEditor
      : null;
    const handleBlur = (event: ReactFocusEvent<HTMLSpanElement>) => {
      if (!editor || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (openInlineDatePickerKey?.startsWith(`${entry.id}:`)) return;
      const returnFocus = event.currentTarget.querySelector<HTMLInputElement>("input");
      void commitInlineEdit(entry, returnFocus);
    };
    const timeInput = (edge: TimelineInlineTimeEdge, instant: string) => {
      const value = editor
        ? edge === "start" ? editor.draft.startedAtTime : editor.draft.stoppedAtTime
        : formatTime(instant);
      const date = editor
        ? edge === "start" ? editor.draft.startedAtDate : editor.draft.stoppedAtDate
        : dateTimeLocal(instant).slice(0, 10);
      const pickerKey = `${entry.id}:${edge}`;
      return (
        <TimelineInlineTimeControl
          date={date}
          disabled={editor?.isSaving}
          edge={edge}
          entryId={entry.id}
          entryTitle={timeEntryTitle(entry)}
          onBeginEdit={() => {
            if (!editor) beginInlineEdit(entry, "time", interval);
          }}
          onDateChange={(nextDate) => updateInlineDate(entry, edge, nextDate)}
          onKeyDown={(event) => handleInlineKeyDown(event, entry, "time", interval)}
          onPickerOpenChange={(open) => {
            if (open) {
              setOpenInlineDatePickerKey(pickerKey);
              if (!editor) beginInlineEdit(entry, "time", interval);
            } else if (openInlineDatePickerKey === pickerKey) {
              setOpenInlineDatePickerKey(null);
            }
          }}
          onTimeChange={(nextTime) => updateInlineTime(entry, edge, nextTime)}
          readOnly={!editor || editor.isSaving}
          today={dateTimeLocal(capturedNow).slice(0, 10)}
          value={value}
        />
      );
    };
    return (
      <span
        className={`timeline-inline-time${editor ? " is-editing" : ""}`}
        onBlur={handleBlur}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFullEditor(entry);
        }}
        title="Click to edit. Double-click for the full editor."
      >
        {timeInput("start", interval.startedAt)}
        <span aria-hidden="true" className="timeline-inline-time-separator">
          <Minus size={12} strokeWidth={1.5} />
        </span>
        {interval.stoppedAt
          ? timeInput("finish", interval.stoppedAt)
          : <span className="timeline-inline-running">Running</span>}
      </span>
    );
  }

  function renderInlineStatus(entry: TimeEntryRow) {
    const editor = inlineEditor?.entryId === entry.id ? inlineEditor : null;
    if (editor?.error) return <span className="timeline-inline-edit-error" role="alert">{editor.error}</span>;
    if (editor?.isSaving) return <span className="sr-only" role="status">Saving entry</span>;
    return null;
  }

  function renderDuration(entry: TimeEntryRow, fallbackSeconds: number) {
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "time"
      ? inlineEditor
      : null;
    return formatDuration(editor?.draft.durationSeconds ?? fallbackSeconds);
  }

  return (
    <section className="timeline-list-workspace">
      {actionError ? (
        <p className="swiss-inline-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div
        className="timeline-list-scroll"
        onScroll={onScroll}
        ref={(element) => {
          listScrollRef.current = element;
          scrollContainerRef(element);
        }}
      >
        <table className="timeline-list-table">
          <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--line)] px-3 py-3">Task</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Time</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Duration</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line react-hooks/refs -- nested row callbacks read refs only after user interaction */}
            {grouped.map((group, index) => {
              const entry = group.representative;
              const displayInterval = timelineEntryDisplayInterval(entry, displayRange, capturedNow);
              const previousDate = index > 0 ? grouped[index - 1].day : null;
              const shouldShowDate = groupByDay && group.day !== previousDate;
              const isGrouped = group.entries.length > 1;
              const isExpanded = isGrouped && (
                expandedGroups.has(group.key) ||
                group.entries.some((occurrence) => occurrence.id === highlightedEntryId)
              );
              const overlappingOccurrences = group.entries.filter(
                (occurrence) => (overlapById.get(occurrence.id)?.overlapCount ?? 0) > 0
              );

              return (
                <Fragment key={group.key}>
                  {shouldShowDate ? (
                    <tr key={`${group.day}-${entry.id}-group`} className="timeline-list-day-heading">
                      <td colSpan={4}>
                        {group.day}
                      </td>
                    </tr>
                  ) : null}
                <tr
                  className={[
                    "motion-row border-b border-[var(--line)] align-middle last:border-b-0 hover:bg-[var(--surface-strong)]",
                    highlightedEntryId === entry.id && !isGrouped ? "timeline-entry-highlight" : ""
                  ].join(" ")}
                  id={!isGrouped ? `timeline-entry-${entry.id}` : undefined}
                >
                  <td className="px-3 py-3 font-medium">
                    <div className={`timeline-task-cell${isGrouped ? "" : " is-single"}`}>
                      {isGrouped ? (
                        <button
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.entries.length} ${timeEntryTitle(entry)} entries`}
                          className="timeline-group-count"
                          onClick={() => setExpandedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })}
                          type="button"
                        >
                          {group.entries.length}
                        </button>
                      ) : null}
                      <span
                        aria-hidden="true"
                        className={`timeline-task-category-dot${entry.categoryName ? "" : " is-uncategorized"}`}
                        style={{ backgroundColor: timeEntryCategoryColor(entry) }}
                      />
                      <span className="timeline-task-details">
                        <span className="timeline-task-primary-line">
                          {renderInlineDescription(entry, !isGrouped)}
                          <span className="timeline-task-meta">{timeEntryCategoryLabel(entry)}</span>
                          <TagMetadata compact tagNames={entry.tagNames} />
                        </span>
                        {renderInlineStatus(entry)}
                        {overlappingOccurrences.length > 0 ? (
                          <span
                            className="overlap-marker"
                            aria-label={isGrouped
                              ? `${overlappingOccurrences.length} entries in this group overlap other entries`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), entries)}
                            title={isGrouped
                              ? `${overlappingOccurrences.length} entries in this group overlap other entries`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), entries)}
                          >
                            {isGrouped
                              ? `${overlappingOccurrences.length} overlapping`
                              : `Overlap · ${formatDuration(overlapById.get(entry.id)?.overlapSeconds ?? 0)}`}
                          </span>
                        ) : null}
                        {entry.placeName ? <small className="mt-1 block font-normal text-[var(--muted)]">{entry.placeName}</small> : null}
                      </span>
                    </div>
                  </td>
                  <td className="tabular px-3 py-3">
                    <div className="timeline-list-time-content">
                      {isGrouped
                        ? (
                          <span
                            className="timeline-group-time-summary"
                            onDoubleClick={() => openFullEditor(entry)}
                            title="Double-click to edit the latest occurrence"
                          >
                            {group.entries.length} occurrences
                          </span>
                        )
                        : renderInlineTime(entry, displayInterval)}
                    </div>
                  </td>
                  <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                    <div className="timeline-list-duration-content">
                      {isGrouped ? formatDuration(group.totalSeconds) : renderDuration(entry, group.totalSeconds)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="timeline-list-actions">
                      <IconButton
                        disabled={isPending || Boolean(continuingEntryId)}
                        label={!entry.stoppedAt
                          ? `Restart ${timeEntryTitle(entry)} from zero`
                          : isGrouped
                            ? `Start ${timeEntryTitle(entry)} from this group again`
                            : `Start ${timeEntryTitle(entry)} again`}
                        onClick={() => continueEntry(entry)}
                      >
                        <Play size={15} fill="currentColor" strokeWidth={0} />
                      </IconButton>
                      <EntryActionsMenu
                        deleteLabel={isGrouped ? "Delete whole group" : "Delete"}
                        editLabel={isGrouped ? "Edit latest occurrence" : "Edit"}
                        label={`More actions for ${timeEntryTitle(entry)}`}
                        onDelete={() => {
                          onDeleteEntries(isGrouped ? group.entries : [entry]);
                        }}
                        onEdit={() => openFullEditor(entry)}
                      />
                    </div>
                  </td>
                </tr>
                {isExpanded ? group.entries.map((occurrence) => {
                  const occurrenceInterval = timelineEntryDisplayInterval(occurrence, displayRange, capturedNow);
                  const highlighted = highlightedEntryId === occurrence.id;
                  return (
                    <tr
                      className={`timeline-occurrence-row motion-row border-b border-[var(--line)] align-middle${highlighted ? " timeline-entry-highlight" : ""}`}
                      id={`timeline-entry-${occurrence.id}`}
                      key={occurrence.id}
                    >
                      <td className="px-3 py-3">
                        <div className="timeline-task-cell timeline-occurrence-task">
                          <span
                            aria-hidden="true"
                            className={`timeline-task-category-dot${occurrence.categoryName ? "" : " is-uncategorized"}`}
                            style={{ backgroundColor: timeEntryCategoryColor(occurrence) }}
                          />
                          <span className="timeline-task-details">
                            <span className="timeline-task-primary-line">
                              {renderInlineDescription(occurrence)}
                              <span className="timeline-task-meta">{timeEntryCategoryLabel(occurrence)}</span>
                              <TagMetadata compact tagNames={occurrence.tagNames} />
                            </span>
                            {renderInlineStatus(occurrence)}
                            {(overlapById.get(occurrence.id)?.overlapCount ?? 0) > 0 ? (
                              <span
                                className="overlap-marker"
                                aria-label={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  entries
                                )}
                                title={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  entries
                                )}
                              >
                                Overlap · {formatDuration(overlapById.get(occurrence.id)?.overlapSeconds ?? 0)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-3">
                        <div className="timeline-list-time-content">
                          {renderInlineTime(occurrence, occurrenceInterval)}
                        </div>
                      </td>
                      <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                        <div className="timeline-list-duration-content">
                          {renderDuration(occurrence, intervalSeconds(occurrenceInterval, capturedNow))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="timeline-list-actions">
                          <EntryActionsMenu
                            deleteLabel="Delete"
                            editLabel="Edit"
                            label={`More actions for ${timeEntryTitle(occurrence)} occurrence`}
                            onDelete={() => {
                              onDeleteEntries([occurrence]);
                            }}
                            onEdit={() => openFullEditor(occurrence)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                }) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {editingEntry ? (
        <TimeEntryQuickEditorModal
          capturedNow={capturedNow}
          categories={categories}
          entry={editingEntry}
          isTimerBusy={isTimerBusy}
          onClose={() => setEditingEntry(null)}
          onDelete={() => {
            const entry = editingEntry;
            setEditingEntry(null);
            onDeleteEntries([entry]);
          }}
          onSave={async (plan) => {
            const outcome = editingEntry.stoppedAt
              ? await saveTimeEntryQuickEdit(editingEntry.id, plan)
              : await updateActiveEntryFromCalendar({ plan });
            if (outcome.ok) {
              await onChanged?.();
              startTransition(() => router.refresh());
            }
            return outcome;
          }}
          onStartAgain={editingEntry.stoppedAt ? () => continueEntry(editingEntry, "editor") : undefined}
          peerEntries={entries}
          tags={tags}
        />
      ) : null}
    </section>
  );
}

function overlapMarkerDescription(
  entry: TimeEntryRow,
  overlap: TimeIntervalAnalysisEntry | undefined,
  entries: ReadonlyArray<TimeEntryRow>
) {
  if (!overlap?.overlapCount) return "No overlap";
  const firstPeer = entries.find((candidate) => overlap.overlappingEntryIds.includes(candidate.id));
  const peerDetail = firstPeer
    ? `, including ${timeEntryTitle(firstPeer)} from ${formatTime(firstPeer.startedAt)} to ${
        firstPeer.stoppedAt ? formatTime(firstPeer.stoppedAt) : "now"
      }`
    : "";
  return `Overlap: ${formatDuration(overlap.uniqueOverlapSeconds)} shared with ${overlap.overlapCount} other ${
    overlap.overlapCount === 1 ? "entry" : "entries"
  }${peerDetail}. ${timeEntryTitle(entry)} still counts in full towards Total logged.`;
}

function EntryActionsMenu({
  deleteLabel,
  editLabel,
  label,
  onDelete,
  onEdit
}: {
  deleteLabel: string;
  editLabel: string;
  label: string;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ right: 12, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        label={label}
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            const opensBelow = window.innerHeight - rect.bottom >= 124;
            setPosition({
              right: Math.max(12, window.innerWidth - rect.right),
              top: opensBelow ? rect.bottom + 8 : Math.max(12, rect.top - 108)
            });
          }
          setOpen((current) => !current);
        }}
        ref={triggerRef}
      >
        <Ellipsis size={18} />
      </IconButton>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          className="ui-floating-surface swiss-timer-actions-menu timeline-entry-actions-popover is-open"
          ref={menuRef}
          role="menu"
          style={{ right: position.right, top: position.top }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const delta = event.key === "ArrowDown" ? 1 : -1;
            items[(index + delta + items.length) % items.length]?.focus();
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            role="menuitem"
            type="button"
          >
            <Pencil aria-hidden="true" size={16} />
            {editLabel}
          </button>
          <button
            className="is-danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            {deleteLabel}
          </button>
        </div>,
        document.body
      ) : null}
    </>
  );
}

function intervalSeconds(
  interval: { startedAt: string; stoppedAt: string | null },
  capturedNow: Date
) {
  return Math.max(
    0,
    Math.round(
      ((interval.stoppedAt ? Date.parse(interval.stoppedAt) : capturedNow.getTime()) - Date.parse(interval.startedAt)) / 1000
    )
  );
}
