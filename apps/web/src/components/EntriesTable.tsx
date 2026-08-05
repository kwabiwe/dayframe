"use client";

import { Fragment, type UIEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Ellipsis, Pencil, Play, Trash2 } from "lucide-react";
import { analyzeTimeIntervals, type TimeIntervalAnalysisEntry } from "@dayframe/shared";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { TagMetadata } from "@/components/TagMetadata";
import { IconButton } from "@/components/ui/Primitives";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { CategoryRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import { timelineEntryDisplayInterval } from "@/lib/timeline-calculations";
import { groupTimelineEntriesByDay } from "@/lib/timeline-entry-groups";
import type { DateRange } from "@/lib/time-entry-overlap";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const highlightedEntryId = searchParams.get("entry");

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
                    "motion-row border-b border-[var(--line)] align-top last:border-b-0 hover:bg-[var(--surface-strong)]",
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
                          <span className="timeline-task-title">{timeEntryTitle(entry)}</span>
                          <span className="timeline-task-meta">{timeEntryCategoryLabel(entry)}</span>
                          <TagMetadata compact tagNames={entry.tagNames} />
                        </span>
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
                    {isGrouped
                      ? `${group.entries.length} occurrences`
                      : <>{formatTime(displayInterval.startedAt)} - {displayInterval.stoppedAt ? formatTime(displayInterval.stoppedAt) : "Running"}</>}
                  </td>
                  <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                    {formatDuration(group.totalSeconds)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
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
                        onEdit={() => setEditingEntry(entry)}
                      />
                    </div>
                  </td>
                </tr>
                {isExpanded ? group.entries.map((occurrence) => {
                  const occurrenceInterval = timelineEntryDisplayInterval(occurrence, displayRange, capturedNow);
                  const highlighted = highlightedEntryId === occurrence.id;
                  return (
                    <tr
                      className={`timeline-occurrence-row motion-row border-b border-[var(--line)] align-top${highlighted ? " timeline-entry-highlight" : ""}`}
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
                              <span className="timeline-task-title">{timeEntryTitle(occurrence)}</span>
                              <span className="timeline-task-meta">{timeEntryCategoryLabel(occurrence)}</span>
                              <TagMetadata compact tagNames={occurrence.tagNames} />
                            </span>
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
                        {formatTime(occurrenceInterval.startedAt)} - {occurrenceInterval.stoppedAt ? formatTime(occurrenceInterval.stoppedAt) : "Running"}
                      </td>
                      <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                        {formatDuration(intervalSeconds(occurrenceInterval, capturedNow))}
                      </td>
                      <td className="px-3 py-3">
                        <EntryActionsMenu
                          deleteLabel="Delete"
                          editLabel="Edit"
                          label={`More actions for ${timeEntryTitle(occurrence)} occurrence`}
                          onDelete={() => {
                            onDeleteEntries([occurrence]);
                          }}
                          onEdit={() => setEditingEntry(occurrence)}
                        />
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
