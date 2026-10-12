"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { resolveActivityIcon } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { ModalDialog } from "@/components/ui/Primitives";
import { blockStyle } from "@/lib/block-style";
import { formatSourceLabel } from "@/lib/format";
import { defaultReportFilters, reportsHref, type ReportFilters } from "@/lib/report-filters";
import type { ReportFilterOptions } from "@/lib/report-service";

type FilterOption = { id: string; name: string; color?: string | null; icon?: string | null };
type Draft = Pick<ReportFilters, "categories" | "tags" | "places" | "sources" | "description">;

/**
 * Reports filters in Blocks (parity step 15b-1, audit W8b UIA-307): a Filter button with the
 * number of active filters, the active filters as removable chips (activities as solid blocks) and
 * Clear all. The Filter dialog follows the prototype — Activities with All · None and filled
 * activity chips, Tags as #chips — with Places, Sources (only those with time in the range) and
 * "Description contains" behind More filters; it edits a draft and applies it in one navigation.
 * An empty list means "all", as the report URL has always meant.
 */
export function ReportFiltersPanel({
  counts,
  filters,
  options,
  rangeLabel,
  sourcesInRange
}: {
  counts?: ReportFilterCounts;
  filters: ReportFilters;
  options: ReportFilterOptions;
  rangeLabel: string;
  sourcesInRange?: string[];
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
          counts={counts}
          filters={filters}
          onApply={(draft) => {
            setOpen(false);
            router.push(reportsHref(filters, { ...draft, page: 1 }));
          }}
          onClose={() => setOpen(false)}
          options={options}
          places={places}
          sourcesInRange={sourcesInRange}
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

/**
 * Counts that let Apply say "Show N blocks" (UIA-307): the applied result's block total and its
 * blocks per activity ("uncategorized" for No activity).
 */
export type ReportFilterCounts = { totalEntries: number; byCategory: Record<string, number> };

/**
 * The number of blocks the draft would show, or null when the current result cannot tell (a tag,
 * place, source or description change, or an activity outside the applied activity filter).
 */
export function draftBlockCount(
  draft: Draft,
  filters: ReportFilters,
  counts: ReportFilterCounts | undefined
): number | null {
  if (!counts) return null;
  const same = (left: string[], right: string[]) => left.length === right.length && left.every((value) => right.includes(value));
  if (!same(draft.tags, filters.tags) || !same(draft.places, filters.places) || !same(draft.sources, filters.sources)) return null;
  if (draft.description.trim().slice(0, 160) !== filters.description) return null;
  if (draft.categories.length === 0) return filters.categories.length === 0 ? counts.totalEntries : null;
  if (filters.categories.length > 0 && !draft.categories.every((id) => filters.categories.includes(id))) return null;
  return draft.categories.reduce((sum, id) => sum + (counts.byCategory[id] ?? 0), 0);
}

function ReportFilterDialog({
  categories,
  counts,
  filters,
  onApply,
  onClose,
  options,
  places,
  sourcesInRange
}: {
  categories: FilterOption[];
  counts?: ReportFilterCounts;
  filters: ReportFilters;
  onApply: (draft: Draft) => void;
  onClose: () => void;
  options: ReportFilterOptions;
  places: FilterOption[];
  sourcesInRange?: string[];
}) {
  const allCategoryIds = categories.map((category) => category.id);
  // The dialog shows every activity as chosen when the filter means "all" (an empty list), as the
  // prototype does; None empties the choice and Apply waits for at least one activity.
  const [chosen, setChosen] = useState<string[]>(filters.categories.length ? filters.categories : allCategoryIds);
  const [draft, setDraft] = useState<Omit<Draft, "categories">>({
    tags: filters.tags,
    places: filters.places,
    sources: filters.sources,
    description: filters.description
  });
  const categoriesForDraft = chosen.length === allCategoryIds.length && allCategoryIds.every((id) => chosen.includes(id)) ? [] : chosen;
  const fullDraft: Draft = { ...draft, categories: categoriesForDraft };
  const noneChosen = chosen.length === 0;
  const count = noneChosen ? 0 : draftBlockCount(fullDraft, filters, counts);
  const moreCount = draft.places.length + draft.sources.length + (draft.description.trim() ? 1 : 0);
  // Sources with time in the range, plus any already chosen so a chosen one can be removed.
  const sources = sourcesInRange
    ? options.sources.filter((source) => sourcesInRange.includes(source.id) || draft.sources.includes(source.id))
    : options.sources;

  const toggle = (kind: "tags" | "places" | "sources", id: string) => {
    setDraft((current) => ({
      ...current,
      [kind]: current[kind].includes(id) ? current[kind].filter((value) => value !== id) : [...current[kind], id]
    }));
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (noneChosen) return;
    onApply({ ...fullDraft, description: draft.description.trim().slice(0, 160) });
  };

  return (
    <ModalDialog
      className="df-rf-dialog"
      description="Each group matches any selected option."
      footer={(
        <>
          <button
            className="df-rbtn df-rbtn--ghost"
            onClick={() => {
              setChosen(allCategoryIds);
              setDraft({ tags: [], places: [], sources: [], description: "" });
            }}
            type="button"
          >
            Reset
          </button>
          <span className="df-spacer" />
          <button className="df-rbtn df-rbtn--ghost" onClick={onClose} type="button">Cancel</button>
          <button className="df-rbtn df-rbtn--live" disabled={noneChosen} onClick={() => submit()} type="button">
            {count === null ? "Apply" : `Show ${count} ${count === 1 ? "block" : "blocks"}`}
          </button>
        </>
      )}
      onClose={onClose}
      title="Filter"
    >
      <form className="df-rf" onSubmit={submit}>
        <fieldset className="df-rf-sec">
          <legend>
            <b>Activities</b>
            <span className="df-rf-quick">
              <button className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={() => setChosen(allCategoryIds)} type="button">All</button>
              <span aria-hidden="true" className="df-faint">·</span>
              <button className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={() => setChosen([])} type="button">None</button>
            </span>
          </legend>
          {noneChosen ? <p className="df-muted df-rf-note" role="status">Choose at least one activity.</p> : null}
          <div className="df-rf-chips">
            {categories.map((option) => {
              const on = chosen.includes(option.id);
              const glyph = option.color
                ? resolveActivityIcon({ icon: option.icon ?? null, name: option.name }).glyph
                : null;
              return (
                <button
                  aria-pressed={on}
                  className={`df-rchip df-rf-activity${on ? ` is-checked${option.color ? " df-block" : " is-neutral"}` : ""}`}
                  key={option.id}
                  onClick={() => setChosen((current) => (current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id]))}
                  style={option.color ? blockStyle(option.color, option.name) : undefined}
                  type="button"
                >
                  {glyph ? <DayframeIcon glyph={glyph} size={14} /> : <i aria-hidden="true" className="is-none" />}
                  {option.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        <ChipGroup
          empty="No tags yet."
          hint="Blocks with any selected tag"
          label="Tags"
          onClear={() => setDraft((current) => ({ ...current, tags: [] }))}
          onToggle={(id) => toggle("tags", id)}
          options={options.tags.map((tag) => ({ id: tag.id, name: `#${tag.name}` }))}
          selected={draft.tags}
        />
        <details className="df-rf-more" open={moreCount > 0 || undefined}>
          <summary>
            <span>More filters</span>
            {moreCount ? <small className="df-faint">{moreCount} selected</small> : <small className="df-faint">Places, sources, description</small>}
            <ChevronDown aria-hidden="true" className="df-rf-more-chevron" size={16} />
          </summary>
          <div className="df-rf-more-body">
            <ChipGroup
              label="Places"
              onClear={() => setDraft((current) => ({ ...current, places: [] }))}
              onToggle={(id) => toggle("places", id)}
              options={places}
              selected={draft.places}
            />
            <ChipGroup
              empty="No sources have time in this range."
              label="Sources"
              onClear={() => setDraft((current) => ({ ...current, sources: [] }))}
              onToggle={(id) => toggle("sources", id)}
              options={sources}
              selected={draft.sources}
            />
            <label className="df-rf-description">
              <span>Description contains</span>
              <input
                className="ui-control"
                maxLength={160}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Search descriptions"
                type="search"
                value={draft.description}
              />
            </label>
          </div>
        </details>
      </form>
    </ModalDialog>
  );
}

function ChipGroup({
  empty = "Nothing to choose yet.",
  hint,
  label,
  onClear,
  onToggle,
  options,
  selected
}: {
  empty?: string;
  hint?: string;
  label: string;
  onClear: () => void;
  onToggle: (id: string) => void;
  options: FilterOption[];
  selected: string[];
}) {
  return (
    <fieldset className="df-rf-sec">
      <legend>
        <b>{label}</b>
        <small className="df-faint">{selected.length ? `${selected.length} selected` : hint ?? "All"}</small>
        {selected.length ? (
          <button className="df-rbtn df-rbtn--sm df-rbtn--ghost" onClick={onClear} type="button">All</button>
        ) : null}
      </legend>
      {options.length === 0 ? <p className="df-muted">{empty}</p> : null}
      <div className="df-rf-chips">
        {options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              aria-pressed={on}
              className={`df-rchip${on ? " is-checked is-neutral" : ""}`}
              key={option.id}
              onClick={() => onToggle(option.id)}
              type="button"
            >
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
  const sourceMap = new Map(options.sources.map((option) => [option.id, { ...option, name: formatSourceLabel(option.id) }]));

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
