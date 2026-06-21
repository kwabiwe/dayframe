"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paletteColorFor } from "@dayframe/shared";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { CategoryRow, PlaceRow, ProjectRow, TimeEntryRow } from "@/lib/queries";
import { dateTimeLocal, formatDate, formatDuration, formatTime } from "@/lib/format";

export function EntriesTable({
  entries,
  projects,
  categories,
  places,
  showManualForm = true,
  groupByDay = false
}: {
  entries: TimeEntryRow[];
  projects: ProjectRow[];
  categories: CategoryRow[];
  places: PlaceRow[];
  showManualForm?: boolean;
  groupByDay?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState({
    project: "",
    client: "",
    category: "",
    tag: "",
    source: "",
    confidence: "",
    reviewStatus: ""
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (filters.project && entry.projectId !== filters.project) return false;
        if (filters.client && entry.clientName !== filters.client) return false;
        if (filters.category && entry.categoryId !== filters.category) return false;
        if (filters.tag && !entry.tagNames.includes(filters.tag)) return false;
        if (filters.source && entry.source !== filters.source) return false;
        if (filters.confidence && entry.confidence !== filters.confidence) return false;
        if (filters.reviewStatus && entry.reviewStatus !== filters.reviewStatus) return false;
        return true;
      }),
    [entries, filters]
  );

  async function remove(id: string) {
    await fetch(`/api/time-entries/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  async function continueEntry(entry: TimeEntryRow) {
    await fetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "start",
        projectId: entry.projectId,
        categoryId: entry.categoryId,
        description: entry.description ? `Continue: ${entry.description}` : undefined
      })
    });
    startTransition(() => router.refresh());
  }

  async function submitManual(formData: FormData) {
    await fetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "manual",
        projectId: formData.get("projectId"),
        categoryId: formData.get("categoryId") || undefined,
        placeId: formData.get("placeId") || undefined,
        description: formData.get("description") || undefined,
        startedAt: formData.get("startedAt"),
        stoppedAt: formData.get("stoppedAt")
      })
    });
    startTransition(() => router.refresh());
  }

  async function submitEdit(entry: TimeEntryRow, formData: FormData) {
    await fetch(`/api/time-entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: formData.get("projectId"),
        categoryId: formData.get("categoryId") || null,
        placeId: formData.get("placeId") || null,
        description: formData.get("description") || null,
        startedAt: formData.get("startedAt"),
        stoppedAt: formData.get("stoppedAt") || null
      })
    });
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-3 border border-[var(--line)] bg-[var(--surface)] p-4 md:grid-cols-3 xl:grid-cols-7">
        <FilterSelect
          label="Project"
          value={filters.project}
          onChange={(project) => setFilters((current) => ({ ...current, project }))}
          options={projects.map((project) => ({ label: project.name, value: project.id }))}
        />
        <FilterSelect
          label="Client"
          value={filters.client}
          onChange={(client) => setFilters((current) => ({ ...current, client }))}
          options={[...new Set(entries.map((entry) => entry.clientName).filter(isString))].map((client) => ({
            label: client,
            value: client
          }))}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(category) => setFilters((current) => ({ ...current, category }))}
          options={categories.map((category) => ({ label: category.name, value: category.id }))}
        />
        <FilterSelect
          label="Tag"
          value={filters.tag}
          onChange={(tag) => setFilters((current) => ({ ...current, tag }))}
          options={[...new Set(entries.flatMap((entry) => entry.tagNames))].map((tag) => ({
            label: tag,
            value: tag
          }))}
        />
        <FilterSelect
          label="Source"
          value={filters.source}
          onChange={(source) => setFilters((current) => ({ ...current, source }))}
          options={[...new Set(entries.map((entry) => entry.source))].map((source) => ({
            label: source,
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
          action={submitManual}
          className="grid gap-3 border border-[var(--line)] bg-[var(--surface-strong)] p-4 md:grid-cols-6"
        >
          <SelectField name="projectId" label="Project" options={projects} required />
          <SelectField name="categoryId" label="Category" options={categories} />
          <SelectField name="placeId" label="Place" options={places} />
          <TextField name="description" label="Description" />
          <DateField name="startedAt" label="Start" defaultValue={dateTimeLocal()} />
          <DateField name="stoppedAt" label="Stop" defaultValue={dateTimeLocal()} />
          <button
            className="industrial-button-primary focus-ring text-sm md:col-span-6"
            type="submit"
            disabled={isPending}
          >
            Add manual entry
          </button>
        </form>
      ) : null}

      <div className="overflow-x-auto border border-[var(--line)] bg-[var(--surface)]">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="bg-[var(--surface-inset)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--line)] px-3 py-3">Time</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Project</th>
              <th className="border-b border-[var(--line)] px-3 py-3">Client</th>
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
                      <td colSpan={9} className="border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                        {currentDate}
                      </td>
                    </tr>
                  ) : null}
                  {editingId === entry.id ? (
                <tr className="border-b border-[var(--line)] bg-[var(--surface-strong)] align-top">
                  <td colSpan={9} className="p-3">
                    <form action={(formData) => submitEdit(entry, formData)} className="grid gap-3 md:grid-cols-6">
                      <SelectField
                        name="projectId"
                        label="Project"
                        options={projects}
                        defaultValue={entry.projectId ?? ""}
                        required
                      />
                      <SelectField
                        name="categoryId"
                        label="Category"
                        options={categories}
                        defaultValue={entry.categoryId ?? ""}
                      />
                      <SelectField
                        name="placeId"
                        label="Place"
                        options={places}
                        defaultValue={entry.placeId ?? ""}
                      />
                      <TextField
                        name="description"
                        label="Description"
                        defaultValue={entry.description ?? ""}
                      />
                      <DateField
                        name="startedAt"
                        label="Start"
                        defaultValue={dateTimeLocal(entry.startedAt)}
                      />
                      <DateField
                        name="stoppedAt"
                        label="Stop"
                        defaultValue={entry.stoppedAt ? dateTimeLocal(entry.stoppedAt) : ""}
                      />
                      <div className="flex gap-2 md:col-span-6">
                        <button className="industrial-button-primary focus-ring text-sm">
                          Save
                        </button>
                        <button
                          type="button"
                          className="industrial-button focus-ring text-sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
                  ) : (
                <tr className="motion-row border-b border-[var(--line)] align-top last:border-b-0 hover:bg-[var(--surface-strong)]">
                  <td className="tabular px-3 py-3">
                    {formatTime(entry.startedAt)} - {entry.stoppedAt ? formatTime(entry.stoppedAt) : "Running"}
                  </td>
                  <td className="px-3 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 border border-[var(--line-strong)]"
                        style={{
                          backgroundColor: paletteColorFor(
                            entry.projectColor,
                            entry.projectName ?? entry.id
                          )
                        }}
                      />
                      {entry.projectName ?? "Unassigned"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.clientName ?? "No client"}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.categoryName ?? "No category"}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.placeName ?? "No place"}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.source}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{entry.reviewStatus}</td>
                  <td className="tabular px-3 py-3 font-semibold text-[var(--accent)]">
                    {formatDuration(entry.durationSeconds)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <button
                        className="focus-ring border border-[var(--line)] bg-[var(--surface-inset)] p-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        type="button"
                        disabled={!entry.projectId || isPending}
                        aria-label="Continue entry"
                        onClick={() => continueEntry(entry)}
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        className="focus-ring border border-[var(--line)] bg-[var(--surface-inset)] p-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        type="button"
                        aria-label="Edit entry"
                        onClick={() => setEditingId(entry.id)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="focus-ring border border-[var(--line)] bg-[var(--surface-inset)] p-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        type="button"
                        aria-label="Delete entry"
                        onClick={() => remove(entry.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
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
        <option value="">{required ? "Select" : "None"}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  name,
  label,
  defaultValue = ""
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <label className="text-sm">
      <span className="industrial-field-label">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="industrial-field focus-ring"
      />
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
