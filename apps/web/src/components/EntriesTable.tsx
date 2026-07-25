"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Ellipsis, Pencil, Play, Trash2 } from "lucide-react";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { DestructiveConfirmationDialog } from "@/components/DestructiveConfirmationDialog";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { TagMetadata } from "@/components/TagMetadata";
import { IconButton } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { CategoryRow, PlaceRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import { timelineEntryDisplayInterval } from "@/lib/timeline-calculations";
import { groupTimelineEntries } from "@/lib/timeline-entry-groups";
import type { DateRange } from "@/lib/time-entry-overlap";

export function EntriesTable({
  entries,
  categories,
  places,
  tags = [],
  groupByDay = false,
  onChanged,
  displayRange,
  capturedNow = new Date()
}: {
  entries: TimeEntryRow[];
  categories: CategoryRow[];
  places: PlaceRow[];
  tags?: TagRow[];
  groupByDay?: boolean;
  onChanged?: () => Promise<void>;
  displayRange?: DateRange;
  capturedNow?: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startEntryAgain } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    entries: TimeEntryRow[];
    title: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const highlightedEntryId = searchParams.get("entry");

  const filtered = useMemo(
    () => entries.filter((entry) => !categoryFilter || entry.categoryId === categoryFilter),
    [categoryFilter, entries]
  );
  const grouped = useMemo(() => {
    const byDay = new Map<string, TimeEntryRow[]>();
    for (const entry of filtered) {
      const interval = timelineEntryDisplayInterval(entry, displayRange, capturedNow);
      const day = formatDate(interval.startedAt);
      const dayEntries = byDay.get(day) ?? [];
      dayEntries.push(entry);
      byDay.set(day, dayEntries);
    }
    return [...byDay].flatMap(([day, entriesForDay]) =>
      groupTimelineEntries(entriesForDay).map((group) => ({
        ...group,
        day,
        key: `${day}:${group.key}`,
        totalSeconds: group.entries.reduce(
          (sum, entry) => sum + intervalSeconds(timelineEntryDisplayInterval(entry, displayRange, capturedNow), capturedNow),
          0
        )
      }))
    );
  }, [capturedNow, displayRange, filtered]);

  useEffect(() => {
    if (!highlightedEntryId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`timeline-entry-${highlightedEntryId}`)?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [grouped, highlightedEntryId]);

  async function remove(entriesToDelete: TimeEntryRow[]) {
    if (isDeletingEntry) return;
    setIsDeletingEntry(true);
    setDeleteError(null);
    try {
      const response = entriesToDelete.length === 1
        ? await clientFetch(`/api/time-entries/${entriesToDelete[0].id}`, { method: "DELETE" })
        : await clientFetch("/api/time-entries/batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: entriesToDelete.map((entry) => entry.id) })
          });
      if (!response.ok) {
        let errorMessage = `Unable to delete this entry: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }
      setPendingDelete(null);
      await onChanged?.();
      startTransition(() => router.refresh());
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete this entry.");
    } finally {
      setIsDeletingEntry(false);
    }
  }

  async function continueEntry(entry: TimeEntryRow) {
    if (continuingEntryId) return;

    setContinuingEntryId(entry.id);
    setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) throw new Error(outcome.error);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to start this task.");
    } finally {
      setContinuingEntryId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="fill-group-surface grid gap-3 overflow-hidden p-4 md:max-w-sm">
        <FilterSelect
          label="Category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categories.map((category) => ({ label: category.name, value: category.id }))}
        />
      </div>
      {actionError ? (
        <p className="swiss-inline-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="fill-group-surface overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full border-collapse text-sm">
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

              return (
                <Fragment key={group.key}>
                  {shouldShowDate ? (
                    <tr key={`${group.day}-${entry.id}-group`} className="bg-[var(--surface-inset)]">
                      <td colSpan={4} className="border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
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
                        <span className="timeline-task-title">{timeEntryTitle(entry)}</span>
                        <span className="timeline-task-meta">{timeEntryCategoryLabel(entry)}</span>
                        <TagMetadata tagNames={entry.tagNames} />
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
                        label={isGrouped
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
                          setDeleteError(null);
                          setPendingDelete({
                            entries: isGrouped ? group.entries : [entry],
                            title: isGrouped ? `Delete all ${group.entries.length} occurrences?` : "Delete time entry?"
                          });
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
                            <span className="timeline-task-title">{timeEntryTitle(occurrence)}</span>
                            <span className="timeline-task-meta">{timeEntryCategoryLabel(occurrence)}</span>
                            <TagMetadata tagNames={occurrence.tagNames} />
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
                            setDeleteError(null);
                            setPendingDelete({ entries: [occurrence], title: "Delete time entry?" });
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
      </div>
      {editingEntry ? (
        <EditTimeEntryDialog
          categories={categories}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await onChanged?.();
            startTransition(() => router.refresh());
          }}
          places={places}
          tags={tags}
        />
      ) : null}
      {pendingDelete ? (
        <DestructiveConfirmationDialog
          body={pendingDelete.entries.length > 1
            ? `All ${pendingDelete.entries.length} “${timeEntryTitle(pendingDelete.entries[0])}” occurrences will be permanently removed.`
            : `“${timeEntryTitle(pendingDelete.entries[0])}” will be permanently removed.`}
          dialogId="delete-time-entry"
          error={deleteError}
          isBusy={isDeletingEntry || isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete.entries)}
          title={pendingDelete.title}
        />
      ) : null}
    </section>
  );
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

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <select
        className="industrial-field focus-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
