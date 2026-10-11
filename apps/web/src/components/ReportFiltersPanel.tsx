"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { ModalDialog } from "@/components/ui/Primitives";
import { blockStyle } from "@/lib/block-style";
import { defaultReportFilters, reportsHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportFilterOptions } from "@/lib/report-service";

type FilterOption = { id: string; name: string; color?: string | null };
type Draft = Pick<ReportFilters, "categories" | "tags" | "places" | "sources" | "description">;

/**
 * Reports filters in Blocks (parity step 15b-1): a Filter button with the number of active
 * filters, the active filters as removable chips (activities as solid blocks) and Clear all; the
 * Filter dialog edits a draft of every filter — activities, tags, places, sources and
 * "Description contains" — and applies it in one navigation. An empty list means "all", as the
 * report URL has always meant.
 */
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
  const [open, setOpen] = useState(false);
  const categories = useMemo<FilterOption[]>(() => [
    { id: "uncategorized", name: "No activity", color: null },
    ...options.categories
  ], [options.categories]);
  const places = useMemo<FilterOption[]>(() => [
    { id: "no-place", name: "No place" },
    ...options.places
  ], [options.places]);

  const chips = buildFilterChips(filters, options, categories, places);
  const summary = chips.length > 0
    ? `${rangeLabel}. Applied filters: ${chips.map((chip) => chip.label).join(", ")}.`
    : `${rangeLabel}. No additional filters applied.`;

  return (
    <section className="df-report-filters" aria-label="Report filters">
      <p className="sr-only" role="status">{summary}</p>
      <button aria-haspopup="dialog" className="df-rbtn df-rbtn--sm" onClick={() => setOpen(true)} type="button">
        <SlidersHorizontal aria-hidden="true" size={15} />
        Filter{chips.length ? ` · ${chips.length}` : ""}
      </button>
      {chips.length > 0 ? (
        <div className="df-fchips" aria-label="Applied report filters">
          <span className="df-faint">Showing</span>
          {chips.map((chip) => (
            <Link
              aria-label={`Remove ${chip.label} filter`}
              className={`df-fchip${chip.color ? " df-block" : ""}`}
              href={reportsHref(filters, { [chip.kind]: chip.remaining, page: 1 })}
              key={`${chip.kind}-${chip.id}`}
              style={chip.color ? blockStyle(chip.color, chip.name) : undefined}
            >
              <span>{chip.label}</span>
              <X aria-hidden="true" size={13} />
            </Link>
          ))}
          <Link aria-label="Clear all report filters" className="df-rbtn df-rbtn--sm df-rbtn--ghost" href={reportsHref(defaultReportFiltersFor(filters))}>
            Clear all
          </Link>
        </div>
      ) : null}
      {open ? (
        <ReportFilterDialog
          categories={categories}
          filters={filters}
          onApply={(draft) => {
            setOpen(false);
            router.push(reportsHref(filters, { ...draft, page: 1 }));
          }}
          onClose={() => setOpen(false)}
          options={options}
          places={places}
        />
      ) : null}
    </section>
  );
}

/** Clear all keeps the range the report shows and drops every filter. */
function defaultReportFiltersFor(filters: ReportFilters): ReportFilters {
  const blank = defaultReportFilters();
  return { ...filters, categories: blank.categories, tags: blank.tags, places: blank.places, sources: blank.sources, description: blank.description, page: 1 };
}

function ReportFilterDialog({
  categories,
  filters,
  onApply,
  onClose,
  options,
  places
}: {
  categories: FilterOption[];
  filters: ReportFilters;
  onApply: (draft: Draft) => void;
  onClose: () => void;
  options: ReportFilterOptions;
  places: FilterOption[];
}) {
  const [draft, setDraft] = useState<Draft>({
    categories: filters.categories,
    tags: filters.tags,
    places: filters.places,
    sources: filters.sources,
    description: filters.description
  });
  const toggle = (kind: "categories" | "tags" | "places" | "sources", id: string) => {
    setDraft((current) => ({
      ...current,
      [kind]: current[kind].includes(id) ? current[kind].filter((value) => value !== id) : [...current[kind], id]
    }));
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onApply({ ...draft, description: draft.description.trim().slice(0, 160) });
  };

  return (
    <ModalDialog
      className="df-rf-dialog"
      description="Each group matches any selected option. Nothing selected means all."
      footer={(
        <>
          <button
            className="df-rbtn df-rbtn--ghost"
            onClick={() => setDraft({ categories: [], tags: [], places: [], sources: [], description: "" })}
            type="button"
          >
            Reset
          </button>
          <span className="df-spacer" />
          <button className="df-rbtn" onClick={onClose} type="button">Cancel</button>
          <button className="df-rbtn df-rbtn--live" onClick={() => submit()} type="button">Apply</button>
        </>
      )}
      onClose={onClose}
      title="Filter"
    >
      <form className="df-rf" onSubmit={submit}>
        <ChipGroup
          label="Activities"
          onClear={() => setDraft((current) => ({ ...current, categories: [] }))}
          onToggle={(id) => toggle("categories", id)}
          options={categories}
          selected={draft.categories}
          solid
        />
        <ChipGroup
          empty="No tags yet."
          label="Tags"
          onClear={() => setDraft((current) => ({ ...current, tags: [] }))}
          onToggle={(id) => toggle("tags", id)}
          options={options.tags}
          selected={draft.tags}
        />
        <ChipGroup
          label="Places"
          onClear={() => setDraft((current) => ({ ...current, places: [] }))}
          onToggle={(id) => toggle("places", id)}
          options={places}
          selected={draft.places}
        />
        <ChipGroup
          label="Sources"
          onClear={() => setDraft((current) => ({ ...current, sources: [] }))}
          onToggle={(id) => toggle("sources", id)}
          options={options.sources}
          selected={draft.sources}
        />
        <label className="df-rf-description">
          <span>Description contains</span>
          <input
            className="ui-control"
            maxLength={160}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="Search task descriptions"
            type="search"
            value={draft.description}
          />
        </label>
      </form>
    </ModalDialog>
  );
}

function ChipGroup({
  empty = "Nothing to choose yet.",
  label,
  onClear,
  onToggle,
  options,
  selected,
  solid = false
}: {
  empty?: string;
  label: string;
  onClear: () => void;
  onToggle: (id: string) => void;
  options: FilterOption[];
  selected: string[];
  solid?: boolean;
}) {
  return (
    <fieldset className="df-rf-sec">
      <legend>
        <b>{label}</b>
        <small className="df-faint">{selected.length ? `${selected.length} selected` : "All"}</small>
        {selected.length ? (
          <button className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={onClear} type="button">All</button>
        ) : null}
      </legend>
      {options.length === 0 ? <p className="df-muted">{empty}</p> : null}
      <div className="df-rf-chips">
        {options.map((option) => {
          const on = selected.includes(option.id);
          const styled = solid && option.color ? blockStyle(option.color, option.name) : undefined;
          return (
            <button
              aria-pressed={on}
              className={`df-rchip${on ? ` is-checked${styled ? " df-block" : " is-neutral"}` : ""}`}
              key={option.id}
              onClick={() => onToggle(option.id)}
              style={styled}
              type="button"
            >
              {solid ? <i aria-hidden="true" /> : null}
              {option.name}
            </button>
          );
        })}
      </div>
    </fieldset>
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
    name: string;
    /** Activity chips carry their colour (null for No activity); others have none. */
    color?: string | null;
    remaining: string[] | string;
  }> = [];
  const categoryMap = new Map(categories.map((option) => [option.id, option]));
  const tagMap = new Map(options.tags.map((option) => [option.id, option]));
  const placeMap = new Map(places.map((option) => [option.id, option]));
  const sourceMap = new Map(options.sources.map((option) => [option.id, option]));

  for (const id of filters.categories) {
    const option = categoryMap.get(id);
    if (!option) continue;
    chips.push({ id, kind: "categories", label: option.name, name: option.name, color: option.color ?? null, remaining: filters.categories.filter((value) => value !== id) });
  }
  for (const id of filters.tags) {
    const option = tagMap.get(id);
    if (option) chips.push({ id, kind: "tags", label: `#${option.name}`, name: option.name, remaining: filters.tags.filter((value) => value !== id) });
  }
  for (const id of filters.places) {
    const option = placeMap.get(id);
    if (option) chips.push({ id, kind: "places", label: `Place: ${option.name}`, name: option.name, remaining: filters.places.filter((value) => value !== id) });
  }
  for (const id of filters.sources) {
    const option = sourceMap.get(id);
    if (option) chips.push({ id, kind: "sources", label: `Source: ${option.name}`, name: option.name, remaining: filters.sources.filter((value) => value !== id) });
  }
  if (filters.description) {
    chips.push({ id: filters.description, kind: "description", label: `Description: ${filters.description}`, name: filters.description, remaining: "" });
  }
  return chips;
}
