"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FloatingListActivityOption, FloatingListSearch, type FloatingListActivity } from "@/components/FloatingList";
import type { RecentActivitySuggestion, RecentActivitySuggestionCandidate } from "@dayframe/shared";
import { TaskSuggestionOption } from "@/components/TaskSuggestionsPanel";
import { Button, ModalDialog } from "@/components/ui/Primitives";
import { activitiesForMention } from "@/lib/command-parse";
import { searchTaskSuggestions } from "@/lib/task-suggestion-search";
import type { TimerDraft } from "@/lib/timer-runtime";

type SwitchOption = { suggestion: RecentActivitySuggestion } | { activity: FloatingListActivity | null };

export function SwitchActivityDialog({ activities, candidates, currentId, fallbackFocus, onClose, onSwitch, suggestions, suggestionLimit }: {
  activities: readonly FloatingListActivity[];
  candidates: RecentActivitySuggestionCandidate[] | undefined;
  currentId: string | null;
  fallbackFocus: () => HTMLElement | null;
  onClose: () => void;
  onSwitch: (draft: TimerDraft) => void;
  suggestions: RecentActivitySuggestion[];
  suggestionLimit: number;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const picked = useRef(false);
  const description = query.trim();
  const matchingSuggestions = description
    ? searchTaskSuggestions(candidates, suggestions, description, suggestionLimit)
    : suggestions.slice(0, suggestionLimit);
  const options: SwitchOption[] = matchingSuggestions
    .filter(({ categoryId }) => !categoryId || activities.some(({ id }) => id === categoryId))
    .map((suggestion) => ({ suggestion }));
  options.push(...activitiesForMention(description, activities.filter(({ id }) => id !== currentId))
    .map((activity) => ({ activity })));
  if (currentId && "no activity".includes(description.toLocaleLowerCase())) options.push({ activity: null });

  function pick(draft: TimerDraft) {
    if (picked.current) return;
    picked.current = true;
    onSwitch(draft);
  }

  function pickOption(option: SwitchOption) {
    if ("suggestion" in option) {
      const { categoryId, description, tagNames } = option.suggestion;
      pick({ categoryId: categoryId ?? "", description, tagNames });
    } else {
      pick({ categoryId: option.activity?.id ?? "", description: "", tagNames: [] });
    }
  }

  const index = Math.min(highlight, options.length - 1);
  const activeId = index >= 0 ? `${listId}-${index}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, query]);

  return (
    <ModalDialog
      description="Choose a suggestion or activity, or enter a description for the next block."
      footer={(
        <Button disabled={!description} onClick={() => pick({ categoryId: "", description, tagNames: [] })}>Switch to new block</Button>
      )}
      fallbackFocus={fallbackFocus}
      initialFocusRef={searchRef}
      onClose={onClose}
      size="compact"
      title="Switch activity"
    >
      <div className="df-flist">
        <FloatingListSearch
          activeDescendant={activeId}
          expanded
          inputRef={searchRef}
          label="Search or enter a description"
          listId={listId}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
          onKeyDown={(event) => {
            if (!options.length || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              pickOption(options[index]);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : options.length - 1;
              setHighlight((index + step) % options.length);
            }
          }}
          value={query}
        />
        <div aria-label="Blocks to switch to" className="df-flist-rows" id={listId} role="listbox">
          {options.map((option, optionIndex) => {
            const row = {
              highlighted: optionIndex === index,
              id: `${listId}-${optionIndex}`,
              onHighlight: () => setHighlight(optionIndex),
              onPick: () => pickOption(option)
            };
            return "suggestion" in option
              ? <TaskSuggestionOption {...row} key={`suggestion-${option.suggestion.key}`} suggestion={option.suggestion} />
              : <FloatingListActivityOption {...row} activity={option.activity} key={option.activity?.id ?? "none"} selected={row.highlighted} />;
          })}
        </div>
        {!options.length ? <p className="df-flist-empty" role="status">No matching suggestions or activities.</p> : null}
      </div>
    </ModalDialog>
  );
}
