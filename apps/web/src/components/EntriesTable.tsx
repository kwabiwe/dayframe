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
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Minus } from "lucide-react";
import { analyzeTimeIntervals, resolveActivityIcon, type ClockFormat, type TimeIntervalAnalysisEntry } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { ErrorBanner } from "@/components/blocks/ErrorBanner";
import { blockStyle } from "@/lib/block-style";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { TagMetadata } from "@/components/TagMetadata";
import { clientFetch } from "@/lib/client-auth-fetch";
import { timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { CategoryRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocal,
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import { useClockFormat } from "@/components/ClockFormat";
import { displayTypedTime } from "@/lib/calendar-grid";
import { timelineEntryDisplayInterval } from "@/lib/timeline-calculations";
import { groupTimelineEntriesByDay, timelineEntryGroupKey } from "@/lib/timeline-entry-groups";
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
  target: TimelineInlineEditTarget;
};

type TimelineInlineEditTarget = {
  day: string | null;
  entryIds: string[];
  groupKey: string | null;
  kind: "entry" | "group";
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

type OptimisticDescription = {
  description: string | null;
  sourceDescription: string | null;
  sourceUpdatedAt: string;
};

async function saveGroupedTimeEntryDescription(entryIds: string[], description: string | null) {
  try {
    const response = await clientFetch("/api/time-entries/batch-description", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: entryIds, description })
    });
    if (!response.ok) {
      let message = `Unable to update this group: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        message = payload.error ?? message;
      } catch {
        // Keep the status fallback when the response is not JSON.
      }
      return { ok: false, error: message } as const;
    }
    return { ok: true } as const;
  } catch {
    return { ok: false, error: "Unable to update this group. Check your connection and try again." } as const;
  }
}

function applyTimelineRegroup(update: () => void) {
  const documentWithTransitions = document as ViewTransitionDocument;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !documentWithTransitions.startViewTransition) {
    update();
    return;
  }
  documentWithTransitions.startViewTransition(() => flushSync(update));
}

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
  typedValue,
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
  /** The draft's own text while editing (null otherwise). */
  typedValue: string | null;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // From the first key until the field is left it shows exactly what was typed; formatted
  // ("9:30 PM") only otherwise, so " AM" is never added under the caret (Codex r2 on #446).
  const [typing, setTyping] = useState(false);
  const clock = useClockFormat();
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
        inputMode={clock === "12h" ? "text" : "numeric"}
        maxLength={8}
        onBlur={() => setTyping(false)}
        onChange={(event) => {
          setTyping(true);
          onTimeChange(event.target.value);
        }}
        onClick={() => {
          onBeginEdit();
          updateDatePickerOpen(true);
        }}
        onFocus={onBeginEdit}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        ref={inputRef}
        role="combobox"
        data-tip={`Edit ${edgeLabel.toLowerCase()} time and choose its date`}
        type="text"
        value={typing && typedValue !== null ? typedValue : value}
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
        max={today}
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
  const clock = useClockFormat();
  const searchParams = useSearchParams();
  const {
    clearTimerError,
    createCategory,
    isTimerBusy,
    shellData,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [inlineEditor, setInlineEditor] = useState<TimelineInlineEditorState | null>(null);
  const [inlineStatus, setInlineStatus] = useState<string | null>(null);
  const [optimisticDescriptions, setOptimisticDescriptions] = useState<Map<string, OptimisticDescription>>(() => new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<TimelineInlineEditorState | null>(null);
  const [openInlineDatePickerKey, setOpenInlineDatePickerKey] = useState<string | null>(null);
  const inlineSessionRef = useRef(0);
  const highlightedEntryId = searchParams.get("entry");
  // Every row is grouped under, and shows times in, the browser's local days, which the server
  // render can't know (Vercel renders in UTC). The server render and the hydration pass draw the
  // empty list; the rows appear once the page has hydrated, without motion (React #418).
  const localTimeReady = useIsHydrated();
  const listEntries = localTimeReady ? entries : NO_LIST_ENTRIES;

  useEffect(() => {
    inlineEditorRef.current = inlineEditor;
  }, [inlineEditor]);

  const displayedEntries = useMemo(() => {
    if (!optimisticDescriptions.size) return listEntries;
    return listEntries.map((entry) => {
      const optimistic = optimisticDescriptions.get(entry.id);
      return optimistic &&
        entry.description === optimistic.sourceDescription &&
        entry.updatedAt === optimistic.sourceUpdatedAt
        ? { ...entry, description: optimistic.description }
        : entry;
    });
  }, [listEntries, optimisticDescriptions]);

  const overlapAnalysis = useMemo(
    () => analyzeTimeIntervals(
      displayedEntries.map((entry) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      {
        ...(displayRange ? { range: displayRange } : {}),
        now: capturedNow
      }
    ),
    [capturedNow, displayRange, displayedEntries]
  );
  const overlapById = useMemo(
    () => new Map(overlapAnalysis.entries.map((entry) => [entry.id, entry])),
    [overlapAnalysis.entries]
  );
  const grouped = useMemo(() => {
    return groupTimelineEntriesByDay(
      displayedEntries,
      (entry) => formatDate(timelineEntryDisplayInterval(entry, displayRange, capturedNow).startedAt)
    ).map((group) => ({
      ...group,
      key: `${group.day}:${group.key}`,
      totalSeconds: group.entries.reduce(
        (sum, entry) => sum + intervalSeconds(timelineEntryDisplayInterval(entry, displayRange, capturedNow), capturedNow),
        0
      )
    }));
  }, [capturedNow, displayRange, displayedEntries]);
  // Each day heading carries that day's time: every block's shown interval clipped to the local day
  // (an overnight block counts on both days; a running one up to the captured time).
  const dayTotals = useMemo(
    () => listDayTotals(displayedEntries.map((entry) => timelineEntryDisplayInterval(entry, displayRange, capturedNow)), capturedNow, formatDate),
    [capturedNow, displayRange, displayedEntries]
  );
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // Days that only continue a block started earlier (overnight, or still running) have time but no
  // row of their own; they still get a heading with their total, in date order (newest first).
  const continuedDays = useMemo(() => {
    const groupDays = new Set(grouped.map((group) => group.day));
    return [...dayTotals.entries()]
      .filter(([label]) => !groupDays.has(label))
      .map(([label, total]) => ({ label, ...total }))
      .sort((left, right) => right.dayStartMs - left.dayStartMs);
  }, [dayTotals, grouped]);

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
      const outcome = { ok: false, error: "A block update is already in progress." } as const;
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
        error: error instanceof Error ? error.message : "Unable to start this block."
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
    displayInterval?: { startedAt: string; stoppedAt: string | null },
    target: TimelineInlineEditTarget = {
      day: null,
      entryIds: [entry.id],
      groupKey: null,
      kind: "entry"
    }
  ) {
    const current = inlineEditorRef.current;
    if (current?.entryId === entry.id && current.field === field) return;
    if (isPending || current?.isSaving || (isTimerBusy && !entry.stoppedAt)) return;
    const next: TimelineInlineEditorState = {
      ...createTimelineInlineEditDraft(entry, field, displayInterval),
      entryId: entry.id,
      error: null,
      isSaving: false,
      sessionId: ++inlineSessionRef.current,
      target
    };
    inlineEditorRef.current = next;
    setInlineEditor(next);
    setActionError(null);
    setInlineStatus(null);
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
    const groupedDescription = current.target.kind === "group";
    const nextDescription = plan.payload.description ?? null;
    const outcome = groupedDescription
      ? await saveGroupedTimeEntryDescription(current.target.entryIds, nextDescription)
      : entry.stoppedAt
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

    if (latest?.sessionId === current.sessionId && groupedDescription) {
      const nextGroupKey = current.target.day
        ? `${current.target.day}:${timelineEntryGroupKey({ ...entry, description: nextDescription })}`
        : null;
      inlineEditorRef.current = null;
      applyTimelineRegroup(() => {
        setInlineEditor(null);
        setOptimisticDescriptions((descriptions) => {
          const next = new Map(descriptions);
          for (const entryId of current.target.entryIds) {
            const source = entries.find((candidate) => candidate.id === entryId);
            if (!source) continue;
            next.set(entryId, {
              description: nextDescription,
              sourceDescription: source.description,
              sourceUpdatedAt: source.updatedAt
            });
          }
          return next;
        });
        if (current.target.groupKey && nextGroupKey) {
          setExpandedGroups((expanded) => {
            const next = new Set(expanded);
            const preserveExpansion = next.delete(current.target.groupKey!);
            if (preserveExpansion) next.add(nextGroupKey);
            return next;
          });
        }
      });
      setInlineStatus(`Updated ${current.target.entryIds.length} grouped blocks.`);
      await onChanged?.();
      if (nextGroupKey) focusGroupedDescription(nextGroupKey);
      startTransition(() => router.refresh());
      return;
    }

    if (latest?.sessionId === current.sessionId) {
      inlineEditorRef.current = null;
      setInlineEditor(null);
    }
    await onChanged?.();
    startTransition(() => router.refresh());
  }

  function focusGroupedDescription(groupKey: string) {
    window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-timeline-group-key]"))
        .find((candidate) => candidate.dataset.timelineGroupKey === groupKey);
      row?.querySelector<HTMLInputElement>(".timeline-inline-description-input")
        ?.focus({ preventScroll: true });
    });
  }

  function handleInlineKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    entry: TimeEntryRow,
    field: TimelineInlineEditField,
    displayInterval?: { startedAt: string; stoppedAt: string | null },
    target?: TimelineInlineEditTarget
  ) {
    const active = inlineEditorRef.current?.entryId === entry.id && inlineEditorRef.current.field === field;
    if (!active && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      beginInlineEdit(entry, field, displayInterval, target);
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

  function renderInlineDescription(entry: TimeEntryRow, target?: TimelineInlineEditTarget) {
    const editTarget = target ?? {
      day: null,
      entryIds: [entry.id],
      groupKey: null,
      kind: "entry" as const
    };
    const isGroupedTarget = editTarget.kind === "group";
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
          if (isGroupedTarget) {
            if (!editor) beginInlineEdit(entry, "description", undefined, editTarget);
          } else {
            openFullEditor(entry);
          }
        }}
      >
        <span aria-hidden="true" className="timeline-inline-description-measure timeline-task-title">
          {value || "Untitled block"}
        </span>
        <input
          aria-label={isGroupedTarget
            ? `${timeEntryTitle(entry)} shared description for ${editTarget.entryIds.length} grouped blocks. Click to edit all occurrences.`
            : `${timeEntryTitle(entry)} description. Click to edit inline. Double-click to open the full editor.`}
          className="timeline-task-title timeline-inline-description-input"
          data-inline-edit-scope={editTarget.kind}
          data-inline-entry-id={entry.id}
          data-inline-field="description"
          onBlur={(event) => {
            if (editor) void commitInlineEdit(entry, event.currentTarget);
          }}
          onChange={(event) => updateInlineDescription(entry.id, event.target.value)}
          onClick={() => {
            if (!editor) beginInlineEdit(entry, "description", undefined, editTarget);
          }}
          onKeyDown={(event) => {
            handleInlineKeyDown(event, entry, "description", undefined, editTarget);
          }}
          placeholder="Untitled block"
          readOnly={!editor || editor.isSaving}
          data-tip={isGroupedTarget ? `Click to edit all ${editTarget.entryIds.length} occurrences.` : "Click to edit. Double-click for the full editor."}
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
      const typedValue = editor ? edge === "start" ? editor.draft.startedAtTime : editor.draft.stoppedAtTime : null;
      const value = typedValue !== null ? displayTypedTime(typedValue, clock) : formatTime(instant, clock);
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
          typedValue={typedValue}
          value={value}
        />
      );
    };
    return (
      <span
        className={`timeline-inline-time${editor ? " is-editing" : ""}${interval.stoppedAt ? "" : " is-running"}`}
        data-clock={clock}
        onBlur={handleBlur}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFullEditor(entry);
        }}
        data-tip="Click to edit. Double-click for the full editor."
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
    if (editor?.isSaving) {
      return <span className="sr-only" role="status">{editor.target.kind === "group" ? "Saving grouped blocks" : "Saving block"}</span>;
    }
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
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}
      {inlineStatus ? <p className="sr-only" aria-live="polite" role="status">{inlineStatus}</p> : null}

      <div
        aria-busy={localTimeReady ? undefined : true}
        className="timeline-list-scroll"
        onScroll={onScroll}
        ref={(element) => {
          listScrollRef.current = element;
          scrollContainerRef(element);
        }}
      >
        <table className="timeline-list-table" data-clock={clock}>
          {/* Column names stay for screen readers; the rows read as Blocks rows (as on Today). */}
          {/* Column widths live here: the header row is visually hidden, so it can't size the columns. */}
          <colgroup>
            <col className="timeline-list-col-block" />
            <col className="timeline-list-col-time" />
            <col className="timeline-list-col-duration" />
            <col className="timeline-list-col-actions" />
          </colgroup>
          <thead className="timeline-list-head">
            <tr>
              <th>Block</th>
              <th>Time</th>
              <th>Duration</th>
              <th>Actions</th>
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
              const groupEditTarget: TimelineInlineEditTarget | undefined = isGrouped
                ? {
                    day: group.day,
                    entryIds: group.entries.map((occurrence) => occurrence.id),
                    groupKey: group.key,
                    kind: "group"
                  }
                : undefined;
              return (
                <Fragment key={group.key}>
                  {shouldShowDate
                    ? continuedDays
                      .filter((day) => day.dayStartMs > (dayTotals.get(group.day)?.dayStartMs ?? 0) &&
                        (previousDate === null || day.dayStartMs < (dayTotals.get(previousDate)?.dayStartMs ?? Infinity)))
                      .map((day) => <ContinuedDayRows day={day} key={`continued-${day.label}`} />)
                    : null}
                  {shouldShowDate ? (
                    <tr key={`${group.day}-${entry.id}-group`} className="timeline-list-day-heading">
                      <td colSpan={4}>
                        <span>{group.day}</span>
                        <span className="tabular">{formatDuration(dayTotals.get(group.day)?.seconds ?? 0)}</span>
                      </td>
                    </tr>
                  ) : null}
                <tr
                  className={[
                    "motion-row timeline-list-row align-middle",
                    highlightedEntryId === entry.id && !isGrouped ? "timeline-entry-highlight" : ""
                  ].join(" ")}
                  data-timeline-group-key={group.key}
                  id={!isGrouped ? `timeline-entry-${entry.id}` : undefined}
                >
                  <td className="px-3 py-3 font-medium">
                    <div className={`timeline-task-cell${isGrouped ? "" : " is-single"}`}>
                      {isGrouped ? (
                        <button
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.entries.length} ${timeEntryTitle(entry)} blocks`}
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
                      <ListBlockMark category={entry.categoryId ? categoriesById.get(entry.categoryId) ?? null : null} entry={entry} />
                      <span className="timeline-task-details">
                        <span className="timeline-task-primary-line">
                          {renderInlineDescription(entry, groupEditTarget)}
                        </span>
                        {/* Today's row anatomy (WUI-028): the title, then "activity · #tags". */}
                        <span className="timeline-task-secondary-line">
                          <span className="timeline-task-meta">{timeEntryCategoryLabel(entry)}</span>
                          {entry.tagNames.length ? <span aria-hidden="true" className="timeline-task-dot">·</span> : null}
                          <TagMetadata compact tagNames={entry.tagNames} />
                        </span>
                        {renderInlineStatus(entry)}
                        {overlappingOccurrences.length > 0 ? (
                          <span
                            className="overlap-marker"
                            aria-label={isGrouped
                              ? `${overlappingOccurrences.length} blocks in this group overlap other blocks`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), displayedEntries, clock)}
                            data-tip={isGrouped
                              ? `${overlappingOccurrences.length} blocks in this group overlap other blocks`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), displayedEntries, clock)}
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
                            data-tip="Double-click to edit the latest occurrence"
                          >
                            {group.entries.length} occurrences
                          </span>
                        )
                        : renderInlineTime(entry, displayInterval)}
                    </div>
                  </td>
                  <td className="tabular px-3 py-3 timeline-list-duration">
                    <div className="timeline-list-duration-content">
                      {isGrouped ? formatDuration(group.totalSeconds) : renderDuration(entry, group.totalSeconds)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="timeline-list-actions">
                      <button
                        className="df-icon-action"
                        data-tip={entry.stoppedAt ? "Start again" : "Restart"}
                        disabled={isPending || Boolean(continuingEntryId)}
                        aria-label={!entry.stoppedAt
                          ? `Restart ${timeEntryTitle(entry)} from zero`
                          : isGrouped
                            ? `Start ${timeEntryTitle(entry)} from this group again`
                            : `Start ${timeEntryTitle(entry)} again`}
                        onClick={() => continueEntry(entry)}
                        type="button"
                      >
                        <DayframeIcon glyph="rotate-ccw" size={16} />
                      </button>
                      <button
                        className="df-icon-action"
                        data-tip="Edit"
                        aria-label={isGrouped ? `Edit the latest ${timeEntryTitle(entry)}` : `Edit ${timeEntryTitle(entry)}`}
                        onClick={() => openFullEditor(entry)}
                        type="button"
                      >
                        <DayframeIcon glyph="pencil" size={16} />
                      </button>
                      <button
                        className="df-icon-action"
                        data-tip="Delete"
                        aria-label={isGrouped
                          ? `Delete all ${group.entries.length} ${timeEntryTitle(entry)} blocks`
                          : `Delete ${timeEntryTitle(entry)}`}
                        onClick={() => onDeleteEntries(isGrouped ? group.entries : [entry])}
                        type="button"
                      >
                        <DayframeIcon glyph="trash-2" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded ? group.entries.map((occurrence) => {
                  const occurrenceInterval = timelineEntryDisplayInterval(occurrence, displayRange, capturedNow);
                  const highlighted = highlightedEntryId === occurrence.id;
                  return (
                    <tr
                      className={`timeline-occurrence-row motion-row timeline-list-row align-middle${highlighted ? " timeline-entry-highlight" : ""}`}
                      id={`timeline-entry-${occurrence.id}`}
                      key={occurrence.id}
                    >
                      <td className="px-3 py-3">
                        <div className="timeline-task-cell timeline-occurrence-task">
                          <ListBlockMark category={occurrence.categoryId ? categoriesById.get(occurrence.categoryId) ?? null : null} entry={occurrence} />
                          <span className="timeline-task-details">
                            <span className="timeline-task-primary-line">
                              {renderInlineDescription(occurrence)}
                            </span>
                            <span className="timeline-task-secondary-line">
                              <span className="timeline-task-meta">{timeEntryCategoryLabel(occurrence)}</span>
                              {occurrence.tagNames.length ? <span aria-hidden="true" className="timeline-task-dot">·</span> : null}
                              <TagMetadata compact tagNames={occurrence.tagNames} />
                            </span>
                            {renderInlineStatus(occurrence)}
                            {(overlapById.get(occurrence.id)?.overlapCount ?? 0) > 0 ? (
                              <span
                                className="overlap-marker"
                                aria-label={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  displayedEntries,
                                  clock
                                )}
                                data-tip={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  displayedEntries,
                                  clock
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
                      <td className="tabular px-3 py-3 timeline-list-duration">
                        <div className="timeline-list-duration-content">
                          {renderDuration(occurrence, intervalSeconds(occurrenceInterval, capturedNow))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="timeline-list-actions">
                          <button
                            className="df-icon-action"
                            data-tip="Edit"
                            aria-label={`Edit this ${timeEntryTitle(occurrence)}`}
                            onClick={() => openFullEditor(occurrence)}
                            type="button"
                          >
                            <DayframeIcon glyph="pencil" size={16} />
                          </button>
                          <button
                            className="df-icon-action"
                            data-tip="Delete"
                            aria-label={`Delete this ${timeEntryTitle(occurrence)}`}
                            onClick={() => onDeleteEntries([occurrence])}
                            type="button"
                          >
                            <DayframeIcon glyph="trash-2" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : null}
                </Fragment>
              );
            })}
            {groupByDay && grouped.length
              ? continuedDays
                .filter((day) => day.dayStartMs < (dayTotals.get(grouped[grouped.length - 1].day)?.dayStartMs ?? -Infinity))
                .map((day) => <ContinuedDayRows day={day} key={`continued-${day.label}`} />)
              : null}
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
          onCreateCategory={createCategory}
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
          taskSuggestions={shellData?.taskSuggestions ?? []}
          taskSuggestionCandidates={shellData?.taskSuggestionCandidates}
          tags={tags}
        />
      ) : null}
    </section>
  );
}

function overlapMarkerDescription(
  entry: TimeEntryRow,
  overlap: TimeIntervalAnalysisEntry | undefined,
  entries: ReadonlyArray<TimeEntryRow>,
  clock: ClockFormat
) {
  if (!overlap?.overlapCount) return "No overlap";
  const firstPeer = entries.find((candidate) => overlap.overlappingEntryIds.includes(candidate.id));
  const peerDetail = firstPeer
    ? `, including ${timeEntryTitle(firstPeer)} from ${formatTime(firstPeer.startedAt, clock)} to ${
        firstPeer.stoppedAt ? formatTime(firstPeer.stoppedAt, clock) : "now"
      }`
    : "";
  return `Overlap: ${formatDuration(overlap.uniqueOverlapSeconds)} shared with ${overlap.overlapCount} other ${
    overlap.overlapCount === 1 ? "block" : "blocks"
  }${peerDetail}. ${timeEntryTitle(entry)} still counts in full towards Total logged.`;
}

const NO_LIST_ENTRIES: TimeEntryRow[] = [];

export type ListDayTotal = { dayStartMs: number; seconds: number };

/** Time per local day (keyed by the List's day label) across intervals, each clipped to its days. */
export function listDayTotals(
  intervals: ReadonlyArray<{ startedAt: string; stoppedAt: string | null }>,
  capturedNow: Date,
  dayLabel: (iso: string) => string
) {
  const totals = new Map<string, ListDayTotal>();
  for (const interval of intervals) {
    const start = Date.parse(interval.startedAt);
    const end = interval.stoppedAt ? Date.parse(interval.stoppedAt) : capturedNow.getTime();
    if (!(end > start)) continue;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < end) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      const from = Math.max(start, cursor.getTime());
      const to = Math.min(end, next.getTime());
      if (to > from) {
        const key = dayLabel(new Date(from).toISOString());
        const current = totals.get(key) ?? { dayStartMs: cursor.getTime(), seconds: 0 };
        current.seconds += Math.floor((to - from) / 1000);
        totals.set(key, current);
      }
      cursor.setTime(next.getTime());
    }
  }
  return totals;
}

/** A day that only continues an earlier block: its heading and total, and a note saying so. */
function ContinuedDayRows({ day }: { day: { label: string; seconds: number } }) {
  return (
    <>
      <tr className="timeline-list-day-heading">
        <td colSpan={4}>
          <span>{day.label}</span>
          <span className="tabular">{formatDuration(day.seconds)}</span>
        </td>
      </tr>
      <tr className="timeline-list-continued">
        <td colSpan={4}>Continues from the day before</td>
      </tr>
    </>
  );
}

/** The activity block with its icon (as on Today's rows); no activity is a neutral block. */
function ListBlockMark({ category, entry }: { category: CategoryRow | null; entry: TimeEntryRow }) {
  const glyph = resolveActivityIcon({ icon: category?.icon ?? null, name: entry.categoryName }).glyph;
  return (
    <span
      aria-hidden="true"
      className={`timeline-task-block${entry.categoryId ? " df-block" : ""}`}
      style={entry.categoryId ? blockStyle(entry.categoryColor, entry.categoryName ?? "") : undefined}
    >
      <DayframeIcon glyph={entry.categoryId ? glyph : "tag"} size={14} />
    </span>
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
