"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { blockStyle } from "@/lib/block-style";
import type { CategoryRow } from "@/lib/queries";

/**
 * Activity chips (Blocks; as on the Review card and in the prototype's block editor): a radio group
 * where the chosen activity is a solid block. Arrow keys move and choose; choosing the chosen chip
 * again clears it (no activity). `trailing` holds an "All activities" control after the chips.
 */
export function ActivityChipGroup({
  categories,
  disabled = false,
  label = "Activity",
  onSelect,
  selectedId,
  trailing
}: {
  categories: readonly CategoryRow[];
  disabled?: boolean;
  label?: string;
  onSelect: (categoryId: string) => void;
  /** The chosen activity's id, or "" for no activity. */
  selectedId: string;
  trailing?: ReactNode;
}) {
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = categories.findIndex((category) => category.id === selectedId);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Modified arrows belong to the browser (Alt+Left is Back) and other shortcuts.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + categories.length) % categories.length;
    chipRefs.current[next]?.focus();
    onSelect(categories[next].id);
  }

  return (
    <div className="df-ed-chips">
      <div aria-label={label} className="df-rchips" role="radiogroup">
        {categories.map((category, index) => {
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
