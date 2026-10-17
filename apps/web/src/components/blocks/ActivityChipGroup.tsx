"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { blockStyle } from "@/lib/block-style";
import type { CategoryRow } from "@/lib/queries";

/**
 * Activity chips (Blocks; as on the Review card and in the prototype's block editor): a radio group
 * where the chosen activity is a solid block. Arrow keys move and choose; choosing the chosen chip
 * again clears it (no activity). `trailing` holds an "All activities" control after the chips.
 * With `maxRows`, chips are dropped from the end (never the chosen one) until the chips and the
 * trailing control fit in that many rows, so "All activities" never sits alone on a row of its own
 * (owner, 16 Oct 2026); every activity stays reachable through it.
 */
export function ActivityChipGroup({
  categories,
  disabled = false,
  label = "Activity",
  maxRows,
  onSelect,
  selectedId,
  trailing
}: {
  categories: readonly CategoryRow[];
  disabled?: boolean;
  label?: string;
  /** Fit the chips and `trailing` into at most this many rows. */
  maxRows?: number;
  onSelect: (categoryId: string) => void;
  /** The chosen activity's id, or "" for no activity. */
  selectedId: string;
  trailing?: ReactNode;
}) {
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useRef<HTMLDivElement | null>(null);
  // The editor's width, so a wider or narrower editor measures again from all the chips.
  const [width, setWidth] = useState(0);
  // How many chips fit, for exactly these chips, this choice and this width; anything else starts
  // again from all of them.
  const fitKey = `${categories.map((category) => category.id).join("|")}#${selectedId}#${width}`;
  const [fit, setFit] = useState<{ key: string; count: number } | null>(null);
  // The last activity chosen stays among the fitted chips after it is cleared, so clearing a chip
  // kept only because it was chosen never drops it from under the keyboard (Codex r1 on #465).
  const [lastChosen, setLastChosen] = useState(selectedId);
  if (selectedId && selectedId !== lastChosen) setLastChosen(selectedId);
  const keepId = selectedId || lastChosen;
  const shown = fit && fit.key === fitKey ? fittedChips(categories, fit.count, keepId) : categories;

  // Before paint: one chip fewer until everything fits in `maxRows` rows.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!maxRows || !group) return;
    if (rowCount(group) <= maxRows || shown.length <= 1) return;
    setFit({ key: fitKey, count: shown.length - 1 });
  }, [fitKey, maxRows, shown.length]);

  // Only a width change measures again: the rows' own height changes as chips drop.
  useEffect(() => {
    const group = groupRef.current;
    if (!maxRows || !group || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setWidth(Math.round(group.getBoundingClientRect().width));
    });
    observer.observe(group);
    return () => observer.disconnect();
  }, [maxRows]);

  const checkedIndex = shown.findIndex((category) => category.id === selectedId);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Modified arrows belong to the browser (Alt+Left is Back) and other shortcuts.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + shown.length) % shown.length;
    chipRefs.current[next]?.focus();
    onSelect(shown[next].id);
  }

  return (
    <div className="df-ed-chips" ref={groupRef}>
      <div aria-label={label} className="df-rchips" role="radiogroup">
        {shown.map((category, index) => {
          const checked = category.id === selectedId;
          return (
            <button
              aria-checked={checked}
              className={`df-rchip${checked ? " is-checked df-block" : ""}`}
              disabled={disabled}
              key={category.id}
              onClick={() => onSelect(checked ? "" : category.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(element) => {
                chipRefs.current[index] = element;
              }}
              role="radio"
              style={blockStyle(category.color, category.name)}
              tabIndex={index === tabStop ? 0 : -1}
              type="button"
            >
              <i aria-hidden="true" />
              {category.name}
            </button>
          );
        })}
      </div>
      {trailing}
    </div>
  );
}

/**
 * The chips an editor shows, in a stable order so choosing never moves them: pinned quick starts,
 * then the rest, at most `limit`. An activity chosen through "All activities" that is not among
 * them takes the last place. Every activity stays reachable through "All activities".
 */
export function editorChipCategories(categories: readonly CategoryRow[], selectedId: string, limit = 7) {
  const ordered = [...categories.filter((category) => category.isPinned), ...categories.filter((category) => !category.isPinned)];
  const shown = ordered.slice(0, limit);
  const chosen = categories.find((category) => category.id === selectedId);
  if (chosen && !shown.includes(chosen) && shown.length) shown[shown.length - 1] = chosen;
  return shown;
}

/** The first `count` chips, with `keepId` (the chosen, or last chosen, one) kept in the last place
 *  when it would drop. */
export function fittedChips(categories: readonly CategoryRow[], count: number, keepId: string) {
  const fitted = categories.slice(0, Math.max(1, count));
  const chosen = categories.find((category) => category.id === keepId);
  if (chosen && !fitted.includes(chosen)) fitted[fitted.length - 1] = chosen;
  return fitted;
}

/** How many rows the chips and the trailing control take: an item joins a row its middle falls in
 *  (a shorter control centred in a taller row is still on that row). */
function rowCount(group: HTMLElement) {
  const items = [...group.querySelectorAll<HTMLElement>(".df-rchips > .df-rchip"), ...[...group.children].filter((child) => !child.classList.contains("df-rchips"))];
  const rows: Array<{ top: number; bottom: number }> = [];
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const middle = (box.top + box.bottom) / 2;
    const row = rows.find((candidate) => middle >= candidate.top && middle <= candidate.bottom);
    if (row) {
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ top: box.top, bottom: box.bottom });
    }
  }
  return rows.length;
}
