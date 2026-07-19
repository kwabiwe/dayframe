"use client";

import {
  findActiveHashtag,
  normalizeTagName,
  replaceActiveHashtag,
  tagNamesFromDescription
} from "@dayframe/shared";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { TagRow } from "@/lib/queries";
import { TagMetadata } from "@/components/TagMetadata";

export function InlineTagInput({
  ariaLabel,
  className = "",
  inputClassName = "",
  inputId,
  inputRef: externalInputRef,
  name = "description",
  onChange,
  onClick,
  onEnter,
  onFocus,
  onHashtagPanelChange,
  placeholder,
  tags,
  value
}: {
  ariaLabel: string;
  className?: string;
  inputClassName?: string;
  inputId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  name?: string;
  onChange: (value: string) => void;
  onClick?: () => void;
  onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onHashtagPanelChange?: (open: boolean) => void;
  placeholder?: string;
  tags: TagRow[];
  value: string;
}) {
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const active = focused ? findActiveHashtag(value, caret) : null;
  const matches = useMemo(() => {
    if (!active) return [];
    const query = active.query.toLowerCase();
    return tags
      .filter((tag) => !query || tag.normalizedName.startsWith(query) || tag.name.toLowerCase().includes(query))
      .slice(0, 5);
  }, [active, tags]);
  const exactMatch = active
    ? tags.some((tag) => tag.normalizedName === active.query.toLowerCase())
    : false;
  const createName = useMemo(() => {
    if (!active?.query || exactMatch) return null;
    try {
      return normalizeTagName(active.query).name;
    } catch {
      return null;
    }
  }, [active, exactMatch]);
  const actions = useMemo(
    () => [
      ...matches.map((tag) => ({ id: tag.id, label: tag.name, create: false })),
      ...(createName ? [{ id: "create", label: createName, create: true }] : [])
    ],
    [createName, matches]
  );
  const shouldOpen = focused && Boolean(active);
  const appliedTagNames = useMemo(() => tagNamesFromDescription(value, tags), [tags, value]);

  useEffect(() => {
    onHashtagPanelChange?.(shouldOpen);
  }, [onHashtagPanelChange, shouldOpen]);

  function updateCaret() {
    const input = localInputRef.current;
    if (input) setCaret(input.selectionStart ?? input.value.length);
  }

  function selectAction(action: (typeof actions)[number]) {
    if (!active) return;
    const replacement = replaceActiveHashtag(value, active, action.label);
    onChange(replacement.text);
    setCaret(replacement.caret);
    window.requestAnimationFrame(() => {
      const input = localInputRef.current;
      input?.focus();
      input?.setSelectionRange(replacement.caret, replacement.caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!shouldOpen) {
      if (event.key === "Enter") onEnter?.(event);
      return;
    }
    if (event.key === "ArrowDown" && actions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => (index + 1) % actions.length);
    } else if (event.key === "ArrowUp" && actions.length > 0) {
      event.preventDefault();
      setHighlightedIndex((index) => (index - 1 + actions.length) % actions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = actions[highlightedIndex];
      if (action) selectAction(action);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
    }
  }

  return (
    <div className={`inline-tag-editor ${className}`}>
      <div className="inline-tag-input-anchor">
        <input
          aria-describedby={`${name}-tag-help`}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={`${name}-tag-suggestions`}
          aria-expanded={shouldOpen}
          autoComplete="off"
          className={inputClassName}
          id={inputId}
          name={name}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setHighlightedIndex(0);
          }}
          onClick={() => {
            updateCaret();
            onClick?.();
          }}
          onFocus={() => {
            setFocused(true);
            updateCaret();
            onFocus?.();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={updateCaret}
          placeholder={placeholder}
          ref={(node) => {
            localInputRef.current = node;
            if (externalInputRef) externalInputRef.current = node;
          }}
          role="combobox"
          value={value}
        />
        <div
          aria-hidden={!shouldOpen}
          className={`inline-tag-suggestions${shouldOpen ? " is-open" : ""}`}
          id={`${name}-tag-suggestions`}
          role="listbox"
        >
            <span className="inline-tag-suggestions-title">TAGS</span>
            <div>
              {actions.map((action, index) => (
                <button
                  aria-label={action.create ? `Create new tag, ${action.label}` : `Existing tag, ${action.label}`}
                  aria-selected={highlightedIndex === index}
                  className={`${highlightedIndex === index ? "is-highlighted" : ""}${action.create ? " is-create" : ""}`}
                  key={action.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectAction(action)}
                  role="option"
                  tabIndex={shouldOpen ? 0 : -1}
                  type="button"
                >
                  {action.create ? "+ " : ""}{action.create ? `Create “${action.label}”` : action.label}
                </button>
              ))}
              {actions.length === 0 ? <span className="inline-tag-empty">Type a name to search or create</span> : null}
            </div>
        </div>
      </div>
      <span className="inline-tag-help" id={`${name}-tag-help`}>
        {appliedTagNames.length > 0
          ? <TagMetadata active tagNames={appliedTagNames} />
          : "Type # to add a tag"}
      </span>
    </div>
  );
}
