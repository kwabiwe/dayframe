"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, X } from "lucide-react";
import { Button, Field } from "@/components/ui/Primitives";
import { defaultReportFilters, reportsHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportFilterOptions } from "@/lib/report-service";
import { categoryDisplay } from "@/lib/display";

type FilterOption = { id: string; name: string; color?: string | null };

export function ReportFiltersPanel({
  filters,
  options,
  rangeLabel
}: {
  filters: ReportFilters;
  options: ReportFilterOptions;
  rangeLabel: string;
}) {
  const router = useRouter();
  const [descriptionDraft, setDescriptionDraft] = useState(filters.description);
  const [moreOpen, setMoreOpen] = useState(
    filters.places.length > 0 || filters.sources.length > 0 || Boolean(filters.description)
  );
  const categories = useMemo<FilterOption[]>(() => [
    { id: "uncategorized", name: "Uncategorized", color: null },
    ...options.categories
  ], [options.categories]);
  const places = useMemo<FilterOption[]>(() => [
    { id: "no-place", name: "No place" },
    ...options.places
  ], [options.places]);

  function navigate(overrides: Partial<ReportFilters>) {
    router.push(reportsHref(filters, { ...overrides, page: 1 }));
  }

  function submitDescription(event: FormEvent) {
    event.preventDefault();
    navigate({ description: descriptionDraft.trim() });
  }

  const chips = buildFilterChips(filters, options, categories, places);
  const summary = chips.length > 0
    ? `${rangeLabel}. Applied filters: ${chips.map((chip) => chip.label).join(", ")}.`
    : `${rangeLabel}. No additional filters applied.`;

  return (
    <section className="fill-group-surface report-filter-panel" aria-labelledby="report-filters-title">
      <div className="report-filter-heading">
        <div>
          <h2 id="report-filters-title">Filters</h2>
          <p>Categories and tags match any selected option.</p>
        </div>
        <Link className="ui-button ui-button-ghost" href={reportsHref(defaultReportFilters())} aria-label="Clear all report filters">
          Clear all
        </Link>
      </div>

      <p className="sr-only" role="status">{summary}</p>

      <div className="report-primary-filters">
        <ReportMultiSelect
          label="Categories"
          options={categories}
          selected={filters.categories}
          onToggle={(id) => navigate({ categories: toggleValue(filters.categories, id) })}
          categoryMarkers
        />
        <ReportMultiSelect
          label="Tags"
          options={options.tags}
          selected={filters.tags}
          onToggle={(id) => navigate({ tags: toggleValue(filters.tags, id) })}
        />
      </div>

      {chips.length > 0 ? (
        <div className="report-filter-chips" aria-label="Applied report filters">
          {chips.map((chip) => (
            <Link
              key={`${chip.kind}-${chip.id}`}
              className="report-filter-chip"
              href={reportsHref(filters, { [chip.kind]: chip.remaining, page: 1 })}
              aria-label={`Remove ${chip.label} filter`}
            >
              {chip.color ? <span className="report-filter-chip-dot" style={{ backgroundColor: chip.color }} aria-hidden="true" /> : null}
              <span>{chip.label}</span>
              <X aria-hidden="true" size={14} />
            </Link>
          ))}
        </div>
      ) : null}

      <details
        className="report-more-filters"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary aria-expanded={moreOpen}>
          <span>More filters</span>
          <ChevronDown aria-hidden="true" size={18} />
        </summary>
        <div className="report-more-filter-grid">
          <ReportMultiSelect
            label="Place"
            options={places}
            selected={filters.places}
            onToggle={(id) => navigate({ places: toggleValue(filters.places, id) })}
          />
          <ReportMultiSelect
            label="Source"
            options={options.sources}
            selected={filters.sources}
            onToggle={(id) => navigate({ sources: toggleValue(filters.sources, id) })}
          />
          <form className="report-description-filter" onSubmit={submitDescription}>
            <Field htmlFor="report-description-search" label="Description contains">
              <input
                className="ui-control"
                id="report-description-search"
                maxLength={160}
                placeholder="Search task descriptions"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
            </Field>
            <Button type="submit">Apply search</Button>
          </form>
        </div>
      </details>
    </section>
  );
}

function ReportMultiSelect({
  categoryMarkers = false,
  label,
  onToggle,
  options,
  selected
}: {
  categoryMarkers?: boolean;
  label: string;
  onToggle: (id: string) => void;
  options: FilterOption[];
  selected: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="report-multi-select" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-expanded={open}>
        <span>
          <strong>{label}</strong>
          <small>{selected.length > 0 ? `${selected.length} selected` : "All"}</small>
        </span>
        <ChevronDown aria-hidden="true" size={18} />
      </summary>
      <div
        className="report-multi-select-list"
        role="listbox"
        aria-label={`Select ${label.toLocaleLowerCase()}`}
        aria-multiselectable="true"
      >
        {options.length === 0 ? <p>No options available.</p> : null}
        {options.map((option) => {
          const checked = selected.includes(option.id);
          const display = categoryMarkers ? categoryDisplay(option.name, option.color ?? null) : null;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={checked}
              onClick={() => onToggle(option.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onToggle(option.id);
              }}
            >
              <span className="report-filter-option-label">
                {display ? (
                  <span
                    className={`report-filter-option-dot${display.isUncategorized ? " is-uncategorized" : ""}`}
                    style={{ backgroundColor: display.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span>{option.name}</span>
              </span>
              {checked ? <Check aria-hidden="true" size={16} /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function buildFilterChips(
  filters: ReportFilters,
  options: ReportFilterOptions,
  categories: FilterOption[],
  places: FilterOption[]
) {
  const chips: Array<{
    id: string;
    kind: "categories" | "tags" | "places" | "sources" | "description";
    label: string;
    color?: string;
    remaining: string[] | string;
  }> = [];
  const categoryMap = new Map(categories.map((option) => [option.id, option]));
  const tagMap = new Map(options.tags.map((option) => [option.id, option]));
  const placeMap = new Map(places.map((option) => [option.id, option]));
  const sourceMap = new Map(options.sources.map((option) => [option.id, option]));

  for (const id of filters.categories) {
    const option = categoryMap.get(id);
    if (!option) continue;
    const display = categoryDisplay(option.name, option.color ?? null);
    chips.push({ id, kind: "categories", label: `Category: ${option.name}`, color: display.color, remaining: filters.categories.filter((value) => value !== id) });
  }
  for (const id of filters.tags) {
    const option = tagMap.get(id);
    if (option) chips.push({ id, kind: "tags", label: `Tag: ${option.name}`, remaining: filters.tags.filter((value) => value !== id) });
  }
  for (const id of filters.places) {
    const option = placeMap.get(id);
    if (option) chips.push({ id, kind: "places", label: `Place: ${option.name}`, remaining: filters.places.filter((value) => value !== id) });
  }
  for (const id of filters.sources) {
    const option = sourceMap.get(id);
    if (option) chips.push({ id, kind: "sources", label: `Source: ${option.name}`, remaining: filters.sources.filter((value) => value !== id) });
  }
  if (filters.description) {
    chips.push({ id: filters.description, kind: "description", label: `Description: ${filters.description}`, remaining: "" });
  }
  return chips;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
