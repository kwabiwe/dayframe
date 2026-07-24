"use client";

import {
  consumeActiveHashtag,
  findActiveHashtag,
  normalizeTagName
} from "@dayframe/shared";
import { Check, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject
} from "react";
import type { TagRow } from "@/lib/queries";
import { TagIcon } from "@/components/TagIcon";

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
  onInputKeyDown,
  onSelectedTagNamesChange,
  placeholder,
  selectedTagNames,
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
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectedTagNamesChange: (tagNames: string[]) => void;
  placeholder?: string;
  selectedTagNames: string[];
  tags: TagRow[];
  value: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const active = focused && !pickerOpen ? findActiveHashtag(value, caret) : null;
  const selectedNormalized = useMemo(
    () => new Set(selectedTagNames.map((tagName) => normalizeTagName(tagName).normalizedName)),
    [selectedTagNames]
  );
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
  const shouldOpen = focused && Boolean(active) && !pickerOpen;
  const normalizedPickerQuery = pickerQuery.trim().toLowerCase();
  const pickerOptions = useMemo(() => {
    const byNormalized = new Map(tags.map((tag) => [tag.normalizedName, tag]));
    for (const tagName of selectedTagNames) {
      const normalized = normalizeTagName(tagName);
      if (!byNormalized.has(normalized.normalizedName)) {
        byNormalized.set(normalized.normalizedName, {
          id: `draft:${normalized.normalizedName}`,
          name: normalized.name,
          normalizedName: normalized.normalizedName,
          usageCount: 0
        });
      }
    }
    return [...byNormalized.values()];
  }, [selectedTagNames, tags]);
  const pickerMatches = useMemo(
    () => pickerOptions.filter((tag) => (
      !normalizedPickerQuery ||
      tag.normalizedName.includes(normalizedPickerQuery) ||
      tag.name.toLowerCase().includes(normalizedPickerQuery)
    )),
    [normalizedPickerQuery, pickerOptions]
  );
  const pickerExactMatch = pickerOptions.some((tag) => tag.normalizedName === normalizedPickerQuery);
  const pickerCreateName = useMemo(() => {
    if (!pickerQuery.trim() || pickerExactMatch) return null;
    try {
      return normalizeTagName(pickerQuery).name;
    } catch {
      return null;
    }
  }, [pickerExactMatch, pickerQuery]);

  useEffect(() => {
    onHashtagPanelChange?.(shouldOpen || pickerOpen);
  }, [onHashtagPanelChange, pickerOpen, shouldOpen]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      if (!editorRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPickerOpen(false);
        pickerTriggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  function updateCaret() {
    const input = localInputRef.current;
    if (input) setCaret(input.selectionStart ?? input.value.length);
  }

  function addSelectedTag(tagName: string) {
    const normalized = normalizeTagName(tagName);
    if (selectedNormalized.has(normalized.normalizedName)) return;
    const existing = tags.find((tag) => tag.normalizedName === normalized.normalizedName);
    onSelectedTagNamesChange([...selectedTagNames, existing?.name ?? normalized.name]);
  }

  function toggleSelectedTag(tagName: string) {
    const normalizedName = normalizeTagName(tagName).normalizedName;
    if (selectedNormalized.has(normalizedName)) {
      onSelectedTagNamesChange(selectedTagNames.filter(
        (selected) => normalizeTagName(selected).normalizedName !== normalizedName
      ));
      return;
    }
    addSelectedTag(tagName);
  }

  function selectAction(action: (typeof actions)[number]) {
    if (!active) return;
    addSelectedTag(action.label);
    const replacement = consumeActiveHashtag(value, active);
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
      onInputKeyDown?.(event);
      if (event.defaultPrevented) return;
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
    <div className={`inline-tag-editor ${className}`} ref={editorRef}>
      <div className="ui-compound-control inline-tag-input-anchor">
        <input
          aria-describedby={`${name}-tag-help`}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={`${name}-tag-suggestions`}
          aria-expanded={shouldOpen}
          autoComplete="off"
          className={`${inputClassName} inline-tag-description-input`.trim()}
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
        <button
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          aria-label="Add or filter tags"
          className={`inline-tag-picker-trigger${pickerOpen ? " is-open" : ""}`}
          onClick={() => {
            setPickerOpen((open) => {
              const next = !open;
              if (next) window.requestAnimationFrame(() => pickerInputRef.current?.focus());
              return next;
            });
            setPickerQuery("");
          }}
          ref={pickerTriggerRef}
          type="button"
        >
          <TagIcon size={15} />
        </button>
        <div
          aria-hidden={!shouldOpen}
          className={`ui-floating-surface inline-tag-suggestions${shouldOpen ? " is-open" : ""}`}
          id={`${name}-tag-suggestions`}
          inert={!shouldOpen}
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
        <section
          aria-hidden={!pickerOpen}
          aria-label="Add or filter tags"
          className={`ui-floating-surface inline-tag-picker${pickerOpen ? " is-open" : ""}`}
          inert={!pickerOpen}
          role="dialog"
        >
            <div className="inline-tag-picker-header">
              <strong>Tags</strong>
              <button
                aria-label="Close tag picker"
                onClick={() => {
                  setPickerOpen(false);
                  pickerTriggerRef.current?.focus();
                }}
                type="button"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </div>
            <div className="ui-compound-control inline-tag-picker-search">
              <TagIcon size={15} />
              <input
                aria-label="Add or filter tags"
                autoComplete="off"
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Add/filter tags"
                ref={pickerInputRef}
                value={pickerQuery}
              />
            </div>
            <div className="inline-tag-picker-list">
              {pickerMatches.map((tag) => {
                const selected = selectedNormalized.has(tag.normalizedName);
                return (
                  <button
                    aria-pressed={selected}
                    key={tag.id}
                    onClick={() => toggleSelectedTag(tag.name)}
                    type="button"
                  >
                    <span className={`inline-tag-check${selected ? " is-selected" : ""}`}>
                      {selected ? <Check aria-hidden="true" size={13} strokeWidth={2.3} /> : null}
                    </span>
                    <span>{tag.name}</span>
                  </button>
                );
              })}
              {pickerMatches.length === 0 && !pickerCreateName ? (
                <span className="inline-tag-empty">No matching tags</span>
              ) : null}
            </div>
            {pickerCreateName ? (
              <button
                className="inline-tag-picker-create"
                onClick={() => {
                  addSelectedTag(pickerCreateName);
                  setPickerQuery("");
                  pickerInputRef.current?.focus();
                }}
                type="button"
              >
                + Create “{pickerCreateName}”
              </button>
            ) : null}
        </section>
      </div>
      <span className="inline-tag-help" id={`${name}-tag-help`}>
        {selectedTagNames.map((tagName) => (
          <button
            aria-label={`Remove tag ${tagName}`}
            className="inline-selected-tag"
            key={normalizeTagName(tagName).normalizedName}
            onClick={() => toggleSelectedTag(tagName)}
            type="button"
          >
            <TagIcon aria-hidden="true" size={12} />
            <span>{tagName}</span>
            <X aria-hidden="true" size={12} />
          </button>
        ))}
      </span>
    </div>
  );
}
