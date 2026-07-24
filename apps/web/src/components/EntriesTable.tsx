"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Trash2 } from "lucide-react";
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
  const { startTimer } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<TimeEntryRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);

  const filtered = useMemo(
    () => entries.filter((entry) => !categoryFilter || entry.categoryId === categoryFilter),
    [categoryFilter, entries]
  );

  async function remove(id: string) {
    if (isDeletingEntry) return;
    setIsDeletingEntry(true);
    setDeleteError(null);
    try {
      const response = await clientFetch(`/api/time-entries/${id}`, { method: "DELETE" });
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
      setPendingDeleteEntry(null);
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

    const categoryId = entry.categoryId ?? undefined;
    const description = entry.description?.trim() || undefined;

    if (!categoryId && !description) {
      setActionError("This row does not have a task or category to start.");
      return;
    }

    setContinuingEntryId(entry.id);
    setActionError(null);
    try {
      const outcome = await startTimer({ categoryId, description, tagNames: entry.tagNames });
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
        <table className="min-w-[720px] w-full border-collapse text-sm">
          <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--line)] px-3 py-3">Time</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Task / tags</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Category</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Duration</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, index) => {
              const displayInterval = timelineEntryDisplayInterval(entry, displayRange, capturedNow);
              const previousInterval = index > 0
                ? timelineEntryDisplayInterval(filtered[index - 1], displayRange, capturedNow)
                : null;
              const currentDate = formatDate(displayInterval.startedAt);
              const previousDate = previousInterval ? formatDate(previousInterval.startedAt) : null;
              const shouldShowDate = groupByDay && currentDate !== previousDate;

              return (
                <Fragment key={entry.id}>
                  {shouldShowDate ? (
                    <tr key={`${currentDate}-${entry.id}-group`} className="bg-[var(--surface-inset)]">
                      <td colSpan={5} className="border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                        {currentDate}
                      </td>
                    </tr>
                  ) : null}
                <tr className="motion-row border-b border-[var(--line)] align-top last:border-b-0 hover:bg-[var(--surface-strong)]">
                  <td className="tabular px-3 py-3">
                    {formatTime(displayInterval.startedAt)} - {displayInterval.stoppedAt ? formatTime(displayInterval.stoppedAt) : "Running"}
                  </td>
                  <td className="px-3 py-3 font-medium">
                    <span className="block">{timeEntryTitle(entry)}</span>
                    <TagMetadata tagNames={entry.tagNames} />
                    {entry.placeName ? <small className="mt-1 block font-normal text-[var(--muted)]">{entry.placeName}</small> : null}
                  </td>
                  <td className="px-3 py-3 text-[var(--muted)]">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-3 w-3 shrink-0 rounded-full border border-[var(--line-strong)]${entry.categoryName ? "" : " is-uncategorized"}`}
                        style={{
                          backgroundColor: timeEntryCategoryColor(entry)
                        }}
                      />
                      {timeEntryCategoryLabel(entry)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                    {formatDuration(entry.durationSeconds)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <IconButton
                        disabled={isPending || Boolean(continuingEntryId)}
                        label={`Start ${timeEntryTitle(entry)} again`}
                        onClick={() => continueEntry(entry)}
                      >
                        <Play size={15} fill="currentColor" strokeWidth={0} />
                      </IconButton>
                      <IconButton
                        label="Edit entry"
                        onClick={() => setEditingEntry(entry)}
                      >
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton
                        label="Delete entry"
                        variant="danger"
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDeleteEntry(entry);
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
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
      {pendingDeleteEntry ? (
        <DestructiveConfirmationDialog
          body={`“${timeEntryTitle(pendingDeleteEntry)}” will be permanently removed.`}
          dialogId="delete-time-entry"
          error={deleteError}
          isBusy={isDeletingEntry || isPending}
          onCancel={() => setPendingDeleteEntry(null)}
          onConfirm={() => void remove(pendingDeleteEntry.id)}
          title="Delete time entry?"
        />
      ) : null}
    </section>
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
