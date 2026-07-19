"use client";

import type { FormEvent } from "react";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Trash2 } from "lucide-react";
import { EditTimeEntryDialog } from "@/components/EditTimeEntryDialog";
import { TagMetadata } from "@/components/TagMetadata";
import { InlineTagInput } from "@/components/InlineTagInput";
import { timeEntryCategoryColor, timeEntryCategoryLabel, timeEntryTitle } from "@/lib/display";
import type { CategoryRow, PlaceRow, TagRow, TimeEntryRow } from "@/lib/queries";
import {
  dateTimeLocal,
  dateTimeLocalInputToIso,
  formatDate,
  formatDuration,
  formatSourceLabel,
  formatTime
} from "@/lib/format";

export function EntriesTable({
  entries,
  categories,
  places,
  tags = [],
  showManualForm = true,
  groupByDay = false,
  onChanged
}: {
  entries: TimeEntryRow[];
  categories: CategoryRow[];
  places: PlaceRow[];
  tags?: TagRow[];
  showManualForm?: boolean;
  groupByDay?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState({
    category: "",
    source: "",
    confidence: "",
    reviewStatus: ""
  });
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [manualDescription, setManualDescription] = useState("");
  const [manualTagNames, setManualTagNames] = useState<string[]>([]);

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (filters.category && entry.categoryId !== filters.category) return false;
        if (filters.source && entry.source !== filters.source) return false;
        if (filters.confidence && entry.confidence !== filters.confidence) return false;
        if (filters.reviewStatus && entry.reviewStatus !== filters.reviewStatus) return false;
        return true;
      }),
    [entries, filters]
  );

  async function remove(id: string) {
    await fetch(`/api/time-entries/${id}`, { method: "DELETE" });
    await onChanged?.();
    startTransition(() => router.refresh());
  }

  async function continueEntry(entry: TimeEntryRow) {
    if (continuingEntryId) return;

    const categoryId = entry.categoryId ?? undefined;
    const description = entry.description?.trim() || undefined;

    if (!categoryId && !description) {
      setManualError("This row does not have a task or category to start.");
      return;
    }

    setContinuingEntryId(entry.id);
    setManualError(null);
    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "start",
          categoryId,
          description,
          tagNames: entry.tagNames
        })
      });
      if (!response.ok) {
        let errorMessage = `Unable to start this task: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }
      await onChanged?.();
      startTransition(() => router.refresh());
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Unable to start this task.");
    } finally {
      setContinuingEntryId(null);
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const startedAt = dateTimeLocalInputToIso(formData.get("startedAt"));
    const stoppedAt = dateTimeLocalInputToIso(formData.get("stoppedAt"));

    if (!startedAt || !stoppedAt) {
      setManualError("Use valid start and finish times.");
      return;
    }

    if (new Date(startedAt).getTime() >= new Date(stoppedAt).getTime()) {
      setManualError("Finish time must be after start time.");
      return;
    }

    try {
      const response = await fetch("/api/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          categoryId: formData.get("categoryId") || undefined,
          placeId: formData.get("placeId") || undefined,
          description: formData.get("description") || undefined,
          tagNames: manualTagNames,
          startedAt,
          stoppedAt
        })
      });
      if (!response.ok) {
        let errorMessage = `Unable to add entry: ${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string };
          errorMessage = payload.error ?? errorMessage;
        } catch {
          // Runtime failures may not return JSON.
        }
        throw new Error(errorMessage);
      }
      form.reset();
      setManualDescription("");
      setManualTagNames([]);
      await onChanged?.();
      startTransition(() => router.refresh());
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Unable to add this time entry.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="fill-group-surface grid gap-3 overflow-hidden p-4 md:grid-cols-2 xl:grid-cols-4">
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(category) => setFilters((current) => ({ ...current, category }))}
          options={categories.map((category) => ({ label: category.name, value: category.id }))}
        />
        <FilterSelect
          label="Source"
          value={filters.source}
          onChange={(source) => setFilters((current) => ({ ...current, source }))}
          options={[...new Set(entries.map((entry) => entry.source))].map((source) => ({
            label: formatSourceLabel(source),
            value: source
          }))}
        />
        <FilterSelect
          label="Confidence"
          value={filters.confidence}
          onChange={(confidence) => setFilters((current) => ({ ...current, confidence }))}
          options={[...new Set(entries.map((entry) => entry.confidence))].map((confidence) => ({
            label: confidence,
            value: confidence
          }))}
        />
        <FilterSelect
          label="Review"
          value={filters.reviewStatus}
          onChange={(reviewStatus) => setFilters((current) => ({ ...current, reviewStatus }))}
          options={[...new Set(entries.map((entry) => entry.reviewStatus))].map((reviewStatus) => ({
            label: reviewStatus,
            value: reviewStatus
          }))}
        />
      </div>

      {showManualForm ? (
        <form
          onSubmit={submitManual}
          className="fill-inset-surface grid gap-3 p-4 md:grid-cols-5"
        >
          <SelectField name="categoryId" label="Category" options={categories} />
          <SelectField name="placeId" label="Place" options={places} />
          <div className="text-sm">
            <label className="industrial-field-label" htmlFor="entries-manual-description">Description</label>
            <InlineTagInput
              ariaLabel="Manual time entry description"
              inputClassName="industrial-field focus-ring"
              inputId="entries-manual-description"
              name="manual-description"
              onChange={setManualDescription}
              onSelectedTagNamesChange={setManualTagNames}
              selectedTagNames={manualTagNames}
              tags={tags}
              value={manualDescription}
            />
          </div>
          <DateField name="startedAt" label="Start" defaultValue={dateTimeLocal()} />
          <DateField name="stoppedAt" label="Finish" defaultValue={dateTimeLocal()} />
          {manualError ? (
            <p className="swiss-inline-error md:col-span-5" role="alert">
              {manualError}
            </p>
          ) : null}
          <button
            className="industrial-button-primary focus-ring text-sm md:col-span-5"
            type="submit"
            disabled={isPending}
          >
            Add manual entry
          </button>
        </form>
      ) : null}
      {!showManualForm && manualError ? (
        <p className="swiss-inline-error" role="alert">
          {manualError}
        </p>
      ) : null}

      <div className="fill-group-surface overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--line)] px-3 py-3">Time</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Task</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Category</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Place</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Source</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Review</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Duration</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, index) => {
              const currentDate = formatDate(entry.startedAt);
              const previousDate = index > 0 ? formatDate(filtered[index - 1].startedAt) : null;
              const shouldShowDate = groupByDay && currentDate !== previousDate;

              return (
                <Fragment key={entry.id}>
                  {shouldShowDate ? (
                    <tr key={`${currentDate}-${entry.id}-group`} className="bg-[var(--surface-inset)]">
                      <td colSpan={8} className="border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                        {currentDate}
                      </td>
                    </tr>
                  ) : null}
                <tr className="motion-row border-b border-[var(--line)] align-top last:border-b-0 hover:bg-[var(--surface-strong)]">
                  <td className="tabular px-3 py-3">
                    {formatTime(entry.startedAt)} - {entry.stoppedAt ? formatTime(entry.stoppedAt) : "Running"}
                  </td>
                  <td className="px-3 py-3 font-medium">
                    <span className="block">{timeEntryTitle(entry)}</span>
                    <TagMetadata tagNames={entry.tagNames} />
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
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.placeName ?? "No place"}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{formatSourceLabel(entry.source)}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.reviewStatus}</td>
                  <td className="tabular px-3 py-3 font-semibold text-[var(--accent-text)]">
                    {formatDuration(entry.durationSeconds)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <button
                        className="fill-icon-action focus-ring min-h-11 min-w-11 p-2 hover:text-[var(--accent-text)]"
                        type="button"
                        disabled={isPending || Boolean(continuingEntryId)}
                        aria-label={`Start ${timeEntryTitle(entry)} again`}
                        onClick={() => continueEntry(entry)}
                      >
                        <Play size={15} fill="currentColor" strokeWidth={0} />
                      </button>
                      <button
                        className="fill-icon-action focus-ring min-h-11 min-w-11 p-2 hover:text-[var(--accent-text)]"
                        type="button"
                        aria-label="Edit entry"
                        onClick={() => setEditingEntry(entry)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="fill-icon-action fill-icon-danger focus-ring min-h-11 min-w-11 p-2"
                        type="button"
                        aria-label="Delete entry"
                        onClick={() => remove(entry.id)}
                      >
                        <Trash2 size={15} />
                      </button>
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

function SelectField({
  name,
  label,
  options,
  defaultValue = "",
  required = false
}: {
  name: string;
  label: string;
  options: Array<{ id: string; name: string }>;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="industrial-field focus-ring"
      >
        <option value="">{required ? "Select" : label === "Category" ? "Uncategorized" : "None"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({
  name,
  label,
  defaultValue
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        type="datetime-local"
        name={name}
        defaultValue={defaultValue}
        required={name === "startedAt"}
        className="industrial-field focus-ring"
      />
    </label>
  );
}
