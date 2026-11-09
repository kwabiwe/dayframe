"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FloatingListActivityOption, FloatingListSearch, type FloatingListActivity } from "@/components/FloatingList";
import { ModalDialog } from "@/components/ui/Primitives";
import { activitiesForMention } from "@/lib/command-parse";

export function SwitchActivityDialog({ activities, currentId, fallbackFocus, onClose, onSwitch }: {
  activities: readonly FloatingListActivity[];
  currentId: string | null;
  fallbackFocus: () => HTMLElement | null;
  onClose: () => void;
  onSwitch: (activity: FloatingListActivity | null) => void;
}) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const options: (FloatingListActivity | null)[] = activitiesForMention(
    query,
    activities.filter(({ id }) => id !== currentId)
  );
  if (currentId && "no activity".includes(query.trim().toLocaleLowerCase())) options.push(null);
  const index = Math.min(highlight, options.length - 1);
  const activeId = index >= 0 ? `${listId}-${index}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, query]);

  return (
    <ModalDialog
      description="Choose an activity to finish this block and start the next."
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
          label="Search activities"
          listId={listId}
          onChange={(event) => { setQuery(event.target.value); setHighlight(0); }}
          onKeyDown={(event) => {
            if (!options.length || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onSwitch(options[index]);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : options.length - 1;
              setHighlight((index + step) % options.length);
            }
          }}
          value={query}
        />
        <div aria-label="Activities to switch to" className="df-flist-rows" id={listId} role="listbox">
          {options.map((activity, optionIndex) => (
            <FloatingListActivityOption
              activity={activity}
              highlighted={optionIndex === index}
              id={`${listId}-${optionIndex}`}
              key={activity?.id ?? "none"}
              onHighlight={() => setHighlight(optionIndex)}
              onPick={() => onSwitch(activity)}
              selected={optionIndex === index}
            />
          ))}
        </div>
        {!options.length ? <p className="df-flist-empty" role="status">No matching activities.</p> : null}
      </div>
    </ModalDialog>
  );
}
