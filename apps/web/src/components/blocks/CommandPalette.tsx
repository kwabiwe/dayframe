"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { IconButton, ModalDialog } from "@/components/ui/Primitives";
import { blockStyle } from "@/lib/block-style";
import { clientFetch } from "@/lib/client-auth-fetch";
import {
  filterPaletteCommands,
  searchResultCommand,
  sortByGroup,
  type PaletteCommand
} from "@/lib/command-palette";
import type { GlobalSearchResult } from "@/lib/global-search";

type SearchState = { query: string; status: "loading" | "ready" | "error"; results: PaletteCommand[] };

/**
 * ⌘K: one combobox over commands and past work. Arrow keys move the active option
 * (`aria-activedescendant`, focus stays in the field), Enter runs it, and Enter with nothing
 * matching starts a block with the typed description. Two or more characters also search all
 * history through /api/search.
 */
export function CommandPalette({
  commands,
  onClose,
  onRun,
  onStartTyped
}: {
  commands: readonly PaletteCommand[];
  onClose: () => void;
  onRun: (command: PaletteCommand) => void;
  onStartTyped: (description: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearch({ query: term, status: "loading", results: [] });
      try {
        const response = await clientFetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);
        const payload = (await response.json()) as { results: GlobalSearchResult[] };
        setSearch({ query: term, status: "ready", results: payload.results.map(searchResultCommand) });
      } catch {
        if (!controller.signal.aborted) setSearch({ query: term, status: "error", results: [] });
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [term]);

  const searchForTerm = term.length >= 2 && search?.query === term ? search : null;
  const searching = term.length >= 2 && (!searchForTerm || searchForTerm.status === "loading");
  const results = useMemo(
    () => sortByGroup([...filterPaletteCommands(commands, term), ...(searchForTerm?.results ?? [])]),
    [commands, searchForTerm, term]
  );
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Typed text only becomes a new block once history has answered (or could not be searched):
  // a match may still arrive with the activity and tags to start again.
  const searchSettled = term.length < 2 || (searchForTerm !== null && searchForTerm.status !== "loading");

  function run(index: number) {
    const command = results[index];
    if (command) onRun(command);
    else if (term && searchSettled) onStartTyped(term);
  }

  const sections = results.reduce<Array<{ group: string; items: Array<{ command: PaletteCommand; index: number }> }>>(
    (groups, command, index) => {
      const last = groups.at(-1);
      if (last && last.group === command.group) last.items.push({ command, index });
      else groups.push({ group: command.group, items: [{ command, index }] });
      return groups;
    },
    []
  );

  return (
    <ModalDialog ariaLabel="Search and commands" className="df-palette" initialFocusRef={inputRef} onClose={onClose} showClose={false}>
      <div className="df-palette-input">
        <DayframeIcon glyph="search" size={20} />
        <input
          ref={inputRef}
          aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-label="Search and commands"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!results.length) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((activeIndex + step + results.length) % results.length);
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              run(activeIndex);
            }
          }}
          placeholder="Start a block, jump somewhere, or search past work"
          role="combobox"
          value={query}
        />
        <kbd>Esc</kbd>
        <IconButton className="df-palette-close" label="Close search" onClick={onClose}>
          <DayframeIcon glyph="x" size={18} />
        </IconButton>
      </div>
      <div ref={listRef} className="df-palette-list" id={listId} role="listbox" aria-label="Results">
        {sections.map((section) => (
          <div key={section.group} role="group" aria-labelledby={`${listId}-${section.group.replace(/\s+/g, "-")}`}>
            <div className="df-palette-group" id={`${listId}-${section.group.replace(/\s+/g, "-")}`} role="presentation">
              {section.group}
            </div>
            {section.items.map(({ command, index }) => (
              <div
                key={command.id}
                aria-selected={index === activeIndex}
                className="df-palette-item"
                data-index={index}
                id={optionId(index)}
                onClick={() => run(index)}
                onMouseMove={() => { if (index !== activeIndex) setActive(index); }}
                role="option"
              >
                <span
                  className={`df-palette-icon${command.block ? " df-block" : ""}`}
                  style={command.block ? blockStyle(command.block.color, command.block.name) : undefined}
                >
                  <DayframeIcon glyph={command.glyph} size={16} />
                </span>
                <span className="df-palette-text">
                  <b>{command.label}</b>
                  {command.detail ? <small>{command.detail}</small> : null}
                </span>
                {command.hint ? <kbd>{command.hint}</kbd> : null}
              </div>
            ))}
          </div>
        ))}
        {searching ? <p className="df-palette-note" role="status">Searching all history…</p> : null}
        {searchForTerm?.status === "error" ? (
          <p className="df-palette-note" role="alert">
            Search is unavailable.{results.length ? " Try again." : ` Press Enter to start a block called “${term}”.`}
          </p>
        ) : null}
        {!results.length && searchSettled && searchForTerm?.status !== "error" && term ? (
          <p className="df-palette-note">Nothing matches. Press Enter to start a block called “{term}”.</p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
