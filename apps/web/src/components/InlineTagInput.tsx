"use client";

import {
  consumeActiveHashtag,
  findActiveHashtag,
  normalizeNewTagName,
  normalizeTagName
} from "@dayframe/shared";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import type { TagRow } from "@/lib/queries";
import {
  FLOATING_LIST_HINTS,
  FloatingList,
  FloatingListActivityOption,
  FloatingListSearch,
  FloatingListTagOption,
  restoreFocusIfDropped,
  type FloatingListActivity
} from "@/components/FloatingList";
import { TagIcon } from "@/components/TagIcon";
import { activitiesForMention, findActiveMention } from "@/lib/command-parse";
import { selectVisibleTags, TAG_SELECTION_MAX_COUNT } from "@/lib/tag-display";

/** An activity the description's `@` list can offer (the command timer passes its activities). */
export type MentionActivity = FloatingListActivity;

/**
 * How an activity was chosen from the `@` list: Enter (the command timer may also start the
 * block), or Tab, a click or a tap (only the activity changes).
 */
export type ActivityChoiceTrigger = "enter" | "select";

export function InlineTagInput({
  activities,
  ariaLabel,
  className = "",
  closeSignal = 0,
  completionScope = "",
  disabled = false,
  inputClassName = "",
  inputId,
  inputRef: externalInputRef,
  name = "description",
  onActivityChoose,
  onBlur,
  onChange,
  onClick,
  onEnter,
  onFocus,
  onHashtagPanelChange,
  onInputKeyDown,
  onSelectedTagNamesChange,
  placeholder,
  portal = false,
  selectedTagNames,
  tags,
  value
}: {
  /** Turns on the `@` Activities list; without it `@` is plain text. */
  activities?: readonly MentionActivity[];
  ariaLabel: string;
  className?: string;
  closeSignal?: number;
  /**
   * What the text belongs to (the command timer passes the running block's id, or "idle"). When
   * it changes, an open `#` or `@` list closes even if the text reads the same, and a pick is
   * reported with the scope its list was opened in so the owner can drop a stale one.
   */
  completionScope?: string;
  disabled?: boolean;
  inputClassName?: string;
  inputId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  name?: string;
  /**
   * An activity chosen from the `@` list, with the description as it reads once the `@query`
   * has left it. The owner sets both (the input does not call `onChange` for it).
   */
  onActivityChoose?: (activityId: string, description: string, trigger: ActivityChoiceTrigger, scope: string) => void;
  /** The description field lost focus. */
  onBlur?: () => void;
  onChange: (value: string) => void;
  onClick?: () => void;
  onEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onHashtagPanelChange?: (open: boolean) => void;
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectedTagNamesChange: (tagNames: string[]) => void;
  placeholder?: string;
  portal?: boolean;
  selectedTagNames: string[];
  tags: TagRow[];
  value: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  const suggestionsPanelRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  // Escape or Close dismisses the Tags list for the `#…` it was open for; the next `#` (or the
  // same one once deleted) opens it again. Focus, and the phone keyboard, stay in the field.
  const [dismissedTagStart, setDismissedTagStart] = useState<number | null>(null);
  const activityPanelRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // The block (`completionScope`) the Tags button's list was opened for: its picks, Create and
  // Backspace only ever change that block (Codex r3 on #402).
  const [pickerScope, setPickerScope] = useState<string | null>(null);
  const [pickerScopeHandoff, setPickerScopeHandoff] = useState(0);
  const [anchorWidth, setAnchorWidth] = useState(0);
  const [tagWidths, setTagWidths] = useState<number[]>([]);
  const [pickerPosition, setPickerPosition] = useState<CSSProperties | null>(null);
  const [suggestionsPosition, setSuggestionsPosition] = useState<CSSProperties | null>(null);
  const active = !disabled && focused && !pickerOpen ? findActiveHashtag(value, caret) : null;
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
      return normalizeNewTagName(active.query).name;
    } catch {
      return null;
    }
  }, [active, exactMatch]);
  const actions = useMemo(
    () => [
      ...matches.map((tag) => ({ id: tag.id, label: tag.name, create: false, count: tag.usageCount as number | null })),
      ...(createName ? [{ id: "create", label: createName, create: true, count: null }] : [])
    ],
    [createName, matches]
  );
  // The `@` Activities list opens only for an `@word` being typed (it was the token at the caret
  // when the text last changed in this field, in this `completionScope`). Escape, Close, leaving
  // the field, moving the caret out of it, any other change of the text or a new scope closes it
  // and leaves the `@word` as written; placing the caret on existing text never opens it.
  const [typedMention, setTypedMention] = useState<{ start: number; value: string; scope: string } | null>(null);
  // The scope of the user's last keystroke, click or caret move in the field. A new scope
  // (another block, or idle) closes both lists, even when the text reads the same, and they stay
  // closed through the runtime reconciling the new block's text until the user acts in the field
  // again; a pick from either list only applies in the scope it was opened in.
  const [interactionScope, setInteractionScope] = useState<string | null>(completionScope);
  // A new scope clears what the field owned (the typed `@` anchor, the dismissed `#` token, the
  // interaction scope), so returning to an earlier scope starts clean (Codex r8).
  const [ownedScope, setOwnedScope] = useState(completionScope);
  if (ownedScope !== completionScope) {
    setOwnedScope(completionScope);
    setTypedMention(null);
    setDismissedTagStart(null);
    setInteractionScope(null);
    // A new block closes the Tags button's list and clears its search, as it closes the typed lists;
    // focus that was in it is handed back to the button below.
    if (pickerOpen) setPickerScopeHandoff((count) => count + 1);
    setPickerOpen(false);
    setPickerQuery("");
    setPickerScope(null);
  }
  const shouldOpen = !disabled && focused && Boolean(active) && active?.start !== dismissedTagStart && !pickerOpen
    && interactionScope === completionScope;
  const caretMention = activities && !disabled && focused && !pickerOpen
    && typedMention?.value === value && typedMention.scope === completionScope
    ? findActiveMention(value, caret)
    : null;
  const mention = caretMention && caretMention.start === typedMention?.start ? caretMention : null;
  const activityOpen = Boolean(mention);
  const activityMatches = mention && activities ? activitiesForMention(mention.query, activities) : [];
  const activeActivityIndex = Math.min(activityIndex, Math.max(0, activityMatches.length - 1));
  const tagListId = `${name}-tag-suggestions`;
  const activityListId = `${name}-activity-suggestions`;
  const effectivePickerOpen = !disabled && pickerOpen;
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
      return normalizeNewTagName(pickerQuery).name;
    } catch {
      return null;
    }
  }, [pickerExactMatch, pickerQuery]);
  const atTagLimit = selectedTagNames.length >= TAG_SELECTION_MAX_COUNT;
  // The Tags button's rows: every matching tag (checked when it is on the block), then Create.
  const pickerActions = useMemo(() => [
    ...pickerMatches.map((tag) => ({ create: false, id: tag.id, label: tag.name, count: tag.usageCount as number | null })),
    ...(pickerCreateName && !atTagLimit ? [{ create: true, id: "create", label: pickerCreateName, count: null }] : [])
  ], [atTagLimit, pickerCreateName, pickerMatches]);
  const activePickerIndex = Math.min(pickerIndex, Math.max(0, pickerActions.length - 1));
  const tagPickerListId = `${name}-tag-picker`;
  const tagDisplay = selectVisibleTags(selectedTagNames, {
    availableWidth: anchorWidth ? Math.max(0, Math.min(anchorWidth * 0.52, anchorWidth - 190)) : undefined,
    tagWidths,
    overflowWidth: 38
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return undefined;
    const measure = () => {
      setAnchorWidth(anchor.getBoundingClientRect().width);
      setTagWidths(
        [...anchor.querySelectorAll<HTMLElement>("[data-tag-measure]")]
          .map((element) => element.getBoundingClientRect().width + 4)
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    return () => observer?.disconnect();
  }, [selectedTagNames]);

  // Any of the input's own panels (Tags, the tag picker, Activities) hides the owner's Suggestions.
  useEffect(() => {
    onHashtagPanelChange?.(shouldOpen || effectivePickerOpen || activityOpen);
  }, [activityOpen, effectivePickerOpen, onHashtagPanelChange, shouldOpen]);

  // A new block closed the Tags button's list: focus that was in it (or that the now inert list
  // dropped on the page) goes back to the button, before the browser paints.
  useLayoutEffect(() => {
    if (!pickerScopeHandoff) return;
    const activeElement = document.activeElement;
    if (!activeElement || activeElement === document.body || pickerPanelRef.current?.contains(activeElement)) {
      pickerTriggerRef.current?.focus();
    }
  }, [pickerScopeHandoff]);

  useEffect(() => {
    if (!effectivePickerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => pickerInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [effectivePickerOpen]);

  useEffect(() => {
    if (!disabled) return undefined;
    const timeout = window.setTimeout(() => {
      setFocused(false);
      setPickerOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [disabled]);

  useEffect(() => {
    if (!closeSignal) return undefined;
    const timeout = window.setTimeout(() => {
      setFocused(false);
      setPickerOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [closeSignal]);

  useEffect(() => {
    if (!effectivePickerOpen) return undefined;
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (editorRef.current?.contains(target) || pickerPanelRef.current?.contains(target)) return;
      // Focus goes where the press puts it, or back to the Tags button when that is nowhere
      // (non-focusable content, or a button WebKit does not focus), never the page (Codex r5).
      const hadFocus = Boolean(pickerPanelRef.current?.contains(document.activeElement));
      setPickerOpen(false);
      if (hadFocus) window.setTimeout(() => restoreFocusIfDropped(pickerTriggerRef.current), 0);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        pickerInputRef.current?.blur();
        setPickerOpen(false);
        window.setTimeout(() => pickerTriggerRef.current?.focus(), 0);
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [effectivePickerOpen]);

  useLayoutEffect(() => {
    if (!portal || (!shouldOpen && !effectivePickerOpen && !activityOpen)) return undefined;
    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 6;
      const anchorRect = anchor.getBoundingClientRect();
      const availableWidth = Math.max(0, viewportWidth - margin * 2);
      const suggestionsWidth = Math.min(anchorRect.width, availableWidth);
      const place = (panel: HTMLElement | null, width: number, alignRight: boolean) => {
        const height = panel?.getBoundingClientRect().height ?? 260;
        const preferredLeft = alignRight ? anchorRect.right - width : anchorRect.left;
        const left = Math.min(
          Math.max(viewportLeft + margin, preferredLeft),
          viewportLeft + viewportWidth - width - margin
        );
        const below = anchorRect.bottom + gap;
        const top = below + height <= viewportTop + viewportHeight - margin
          ? below
          : Math.max(viewportTop + margin, anchorRect.top - height - gap);
        return { left, top, width } satisfies CSSProperties;
      };
      if (shouldOpen) setSuggestionsPosition(place(suggestionsPanelRef.current, suggestionsWidth, false));
      else if (activityOpen) setSuggestionsPosition(place(activityPanelRef.current, suggestionsWidth, false));
      // The Tags button's list lines up with the field, like the typed lists.
      if (effectivePickerOpen) setPickerPosition(place(pickerPanelRef.current, suggestionsWidth, false));
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [activityOpen, effectivePickerOpen, portal, shouldOpen]);

  /** Reads the caret after a key or click (a user action in this scope) or on focus (not one). */
  function updateCaret(userAction = true) {
    const input = localInputRef.current;
    if (!input) return;
    if (userAction) setInteractionScope(completionScope);
    const nextCaret = input.selectionStart ?? input.value.length;
    setCaret(nextCaret);
    // Moving the caret out of the `@word` being typed closes its list for good.
    if (typedMention && findActiveMention(input.value, nextCaret)?.start !== typedMention.start) setTypedMention(null);
  }

  function openPicker() {
    if (disabled) return;
    setPickerQuery("");
    setPickerIndex(0);
    setPickerScope(completionScope);
    setPickerOpen(true);
  }

  /** Closes the Tags button's list; Escape, Close and Tab put focus back on the button. */
  function closePicker(restoreFocus: boolean) {
    setPickerOpen(false);
    if (restoreFocus) window.setTimeout(() => pickerTriggerRef.current?.focus(), 0);
  }

  function pickPickerAction(action: (typeof pickerActions)[number] | undefined) {
    // Only for the block the list was opened for, and only while it is open.
    if (!action || disabled || !effectivePickerOpen || pickerScope !== completionScope) return;
    if (action.create) {
      addSelectedTag(action.label);
      setPickerQuery("");
      setPickerIndex(0);
    } else {
      const normalizedName = normalizeTagName(action.label).normalizedName;
      if (!selectedNormalized.has(normalizedName) && atTagLimit) return;
      toggleSelectedTag(action.label);
    }
    pickerInputRef.current?.focus();
  }

  function onPickerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    // A list closed by a new block (or any stale keystroke) changes nothing and never submits.
    if (!effectivePickerOpen || pickerScope !== completionScope) {
      if (event.key === "Enter" || event.key === "Backspace") event.preventDefault();
      return;
    }
    const count = pickerActions.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!count) return;
      setPickerIndex((activePickerIndex + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter") {
      // Never the surrounding form's submit (the command timer's Start).
      event.preventDefault();
      pickPickerAction(pickerActions[activePickerIndex]);
    } else if (event.key === "Backspace" && !pickerQuery && selectedTagNames.length) {
      // An empty search: Backspace removes the last tag on the block.
      event.preventDefault();
      onSelectedTagNamesChange(selectedTagNames.slice(0, -1));
    } else if (event.key === "Tab" || event.key === "Escape") {
      // Escape is handled here, before a surrounding dialog (Add time) would take it and close.
      event.preventDefault();
      closePicker(true);
    }
  }

  function addSelectedTag(tagName: string) {
    if (disabled) return false;
    const normalized = normalizeTagName(tagName);
    if (selectedNormalized.has(normalized.normalizedName)) return true;
    if (selectedTagNames.length >= TAG_SELECTION_MAX_COUNT) return false;
    const existing = tags.find((tag) => tag.normalizedName === normalized.normalizedName);
    onSelectedTagNamesChange([...selectedTagNames, existing?.name ?? normalized.name]);
    return true;
  }

  function toggleSelectedTag(tagName: string) {
    if (disabled) return;
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
    if (disabled || !active || interactionScope !== completionScope) return;
    if (!addSelectedTag(action.label)) return;
    const replacement = consumeActiveHashtag(value, active);
    onChange(replacement.text);
    setCaret(replacement.caret);
    window.requestAnimationFrame(() => {
      const input = localInputRef.current;
      input?.focus();
      input?.setSelectionRange(replacement.caret, replacement.caret);
    });
  }

  // The one way typed `@` text leaves the description: an explicit choice from the list removes
  // exactly the `@query` it was opened for.
  function chooseActivity(activity: MentionActivity, trigger: ActivityChoiceTrigger) {
    if (disabled || !mention) return;
    setTypedMention(null);
    const replacement = consumeActiveHashtag(value, mention);
    onActivityChoose?.(activity.id, replacement.text, trigger, typedMention?.scope ?? completionScope);
    placeCaret(replacement.caret);
  }

  // Escape or Close closes the list and leaves the `@word` as typed: it is description text.
  function dismissMention() {
    setTypedMention(null);
  }

  function placeCaret(position: number) {
    setCaret(position);
    window.requestAnimationFrame(() => {
      const input = localInputRef.current;
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    // The Activities list owns ↑/↓/Enter/Tab/Escape while it is open. Enter with nothing to
    // choose falls through to the owner (the command timer's Start).
    if (activityOpen && !event.nativeEvent.isComposing) {
      const count = activityMatches.length;
      if (event.key === "ArrowDown" && count) {
        event.preventDefault();
        setActivityIndex((activeActivityIndex + 1) % count);
        return;
      }
      if (event.key === "ArrowUp" && count) {
        event.preventDefault();
        setActivityIndex((activeActivityIndex - 1 + count) % count);
        return;
      }
      if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && count) {
        event.preventDefault();
        chooseActivity(activityMatches[activeActivityIndex], event.key === "Enter" ? "enter" : "select");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissMention();
        return;
      }
    }
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
      dismissTagList();
    }
  }

  function dismissTagList() {
    setDismissedTagStart(active?.start ?? null);
  }

  function maybePortal(panel: ReactNode) {
    return portal && typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
  }

  return (
    <div className={`inline-tag-editor ${className}`} ref={editorRef}>
      <div className="ui-compound-control inline-tag-input-anchor" ref={anchorRef}>
        <input
          aria-activedescendant={activityOpen && activityMatches.length
            ? `${name}-activity-option-${activeActivityIndex}`
            : shouldOpen && actions.length
              ? `${name}-tag-option-${Math.min(highlightedIndex, actions.length - 1)}`
              : undefined}
          aria-describedby={`${name}-tag-help`}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={activityOpen ? activityListId : tagListId}
          aria-expanded={shouldOpen || activityOpen}
          autoComplete="off"
          className={`${inputClassName} inline-tag-description-input`.trim()}
          disabled={disabled}
          id={inputId}
          name={name}
          onBlur={() => {
            setFocused(false);
            setTypedMention(null);
            onBlur?.();
          }}
          onChange={(event) => {
            const nextCaret = event.target.selectionStart ?? event.target.value.length;
            onChange(event.target.value);
            setInteractionScope(completionScope);
            const typed = activities ? findActiveMention(event.target.value, nextCaret) : null;
            setTypedMention(typed ? { start: typed.start, value: event.target.value, scope: completionScope } : null);
            setCaret(nextCaret);
            setHighlightedIndex(0);
            setActivityIndex(0);
            if (dismissedTagStart !== null && findActiveHashtag(event.target.value, nextCaret)?.start !== dismissedTagStart) {
              setDismissedTagStart(null);
            }
          }}
          onClick={() => {
            updateCaret();
            onClick?.();
          }}
          onFocus={() => {
            setFocused(true);
            updateCaret(false);
            onFocus?.();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={() => updateCaret()}
          placeholder={placeholder}
          ref={(node) => {
            localInputRef.current = node;
            if (externalInputRef) externalInputRef.current = node;
          }}
          role="combobox"
          value={value}
        />
        <span className="inline-selected-tags" aria-label="Selected tags">
          {tagDisplay.visible.map((tagName) => (
            <button
              aria-label={`Remove tag ${tagName}`}
              className="inline-selected-tag"
              disabled={disabled}
              key={normalizeTagName(tagName).normalizedName}
              onClick={() => toggleSelectedTag(tagName)}
              type="button"
            >
              <span className="inline-selected-tag-visual">
                <span>#{tagName}</span>
                <X aria-hidden="true" size={12} strokeWidth={1.6} />
              </span>
            </button>
          ))}
          {tagDisplay.hiddenCount > 0 ? (
            <button
              aria-label={`Show ${tagDisplay.hiddenCount} more selected tags`}
              className="inline-selected-tag-overflow"
              disabled={disabled}
              onClick={openPicker}
              type="button"
            >
              <span className="inline-selected-tag-overflow-visual">+{tagDisplay.hiddenCount}</span>
            </button>
          ) : null}
        </span>
        <span className="inline-tag-measurer" aria-hidden="true">
          {selectedTagNames.map((tagName) => (
            <span className="inline-selected-tag-visual" data-tag-measure key={tagName}>
              <span>#{tagName}</span>
              <X size={12} strokeWidth={1.6} />
            </span>
          ))}
        </span>
        <button
          aria-controls={tagPickerListId}
          aria-expanded={effectivePickerOpen}
          aria-haspopup="listbox"
          aria-label="Add or filter tags"
          className={`inline-tag-picker-trigger${effectivePickerOpen ? " is-open" : ""}`}
          disabled={disabled}
          onClick={() => {
            // Focus ends on the button (WebKit leaves a clicked button unfocused).
            if (effectivePickerOpen) closePicker(true);
            else openPicker();
          }}
          ref={pickerTriggerRef}
          type="button"
        >
          <TagIcon size={15} />
        </button>
        {maybePortal(<FloatingList
          activeId={actions.length ? `${name}-tag-option-${Math.min(highlightedIndex, actions.length - 1)}` : undefined}
          anchorRef={anchorRef}
          className={`inline-tag-suggestions${portal ? " is-portalled time-entry-quick-editor-nested-surface" : ""}`}
          heading="Tags"
          hints={FLOATING_LIST_HINTS.tags}
          id={tagListId}
          isOpen={shouldOpen}
          onClose={dismissTagList}
          panelRef={suggestionsPanelRef}
          style={portal ? { ...suggestionsPosition, visibility: suggestionsPosition ? "visible" : "hidden" } : undefined}
        >
          {actions.map((action, index) => (
            // The option's name is its visible text ("#Deep work", "Create “#launch”"; WCAG 2.5.3
            // label in name): the lead glyph and the use count are hidden from it.
            <FloatingListTagOption
              count={action.count}
              create={action.create}
              disabled={disabled}
              highlighted={highlightedIndex === index}
              id={`${name}-tag-option-${index}`}
              key={action.id}
              name={action.label}
              onHighlight={() => setHighlightedIndex(index)}
              onPick={() => selectAction(action)}
              selected={highlightedIndex === index}
              tabIndex={shouldOpen ? 0 : -1}
            />
          ))}
          {actions.length === 0 ? <span className="df-flist-empty inline-tag-empty">Type a name to search or create</span> : null}
        </FloatingList>)}
        {activities ? maybePortal(<FloatingList
          activeId={activityMatches.length ? `${name}-activity-option-${activeActivityIndex}` : undefined}
          anchorRef={anchorRef}
          className={`inline-activity-suggestions${portal ? " is-portalled time-entry-quick-editor-nested-surface" : ""}`}
          heading="Activities"
          hints={FLOATING_LIST_HINTS.activities}
          id={activityListId}
          isOpen={activityOpen}
          onClose={dismissMention}
          panelRef={activityPanelRef}
          style={portal ? { ...suggestionsPosition, visibility: suggestionsPosition ? "visible" : "hidden" } : undefined}
        >
          {activityMatches.map((activity, index) => (
            // A pinned activity is one of the quick starts: "Pinned" is the option's accessible
            // description, kept out of its name, which stays the activity's name.
            <FloatingListActivityOption
              activity={activity}
              highlighted={activeActivityIndex === index}
              id={`${name}-activity-option-${index}`}
              key={activity.id}
              onHighlight={() => setActivityIndex(index)}
              onPick={() => chooseActivity(activity, "select")}
              selected={activeActivityIndex === index}
            />
          ))}
          {activityMatches.length === 0 ? (
            <span className="df-flist-empty">No activity called “{mention?.query}”</span>
          ) : null}
        </FloatingList>) : null}
        {/* The Tags button opens the same Tags list as `#`, with a search field (there is no typed
            query) and several choices at once: a chosen tag is checked and removable. */}
        {maybePortal(<FloatingList
          activeId={pickerActions.length ? `${tagPickerListId}-option-${activePickerIndex}` : undefined}
          anchorRef={anchorRef}
          className={`inline-tag-picker${portal ? " is-portalled time-entry-quick-editor-nested-surface" : ""}`}
          heading="Tags"
          hints={FLOATING_LIST_HINTS.tagsPicker}
          id={tagPickerListId}
          isOpen={effectivePickerOpen}
          multiselectable
          onClose={() => closePicker(true)}
          panelRef={pickerPanelRef}
          returnFocusRef={pickerTriggerRef}
          search={(
            <FloatingListSearch
              activeDescendant={pickerActions.length ? `${tagPickerListId}-option-${activePickerIndex}` : undefined}
              className="inline-tag-picker-search"
              expanded={effectivePickerOpen}
              inputRef={pickerInputRef}
              label="Search tags"
              listId={tagPickerListId}
              onChange={(event) => {
                setPickerQuery(event.target.value);
                setPickerIndex(0);
              }}
              onKeyDown={onPickerKeyDown}
              value={pickerQuery}
            />
          )}
          style={portal ? { ...pickerPosition, visibility: pickerPosition ? "visible" : "hidden" } : undefined}
        >
          {pickerActions.map((action, index) => {
            const checked = !action.create && selectedNormalized.has(normalizeTagName(action.label).normalizedName);
            return (
              <FloatingListTagOption
                checked={action.create ? undefined : checked}
                count={action.count}
                create={action.create}
                disabled={disabled}
                highlighted={activePickerIndex === index}
                id={`${tagPickerListId}-option-${index}`}
                key={action.id}
                name={action.label}
                onHighlight={() => setPickerIndex(index)}
                onPick={() => pickPickerAction(action)}
                selected={checked}
                unavailable={!action.create && !checked && atTagLimit}
              />
            );
          })}
          {pickerActions.length === 0 ? (
            <span className="df-flist-empty inline-tag-empty">
              {pickerQuery.trim() ? "No matching tags" : "Type a name to search or create"}
            </span>
          ) : null}
        </FloatingList>)}
      </div>
      <span className="sr-only" id={`${name}-tag-help`}>
        {selectedTagNames.length
          ? `Selected tags: ${selectedTagNames.join(", ")}. Activate a selected tag to remove it.`
          : "No tags selected."}
      </span>
    </div>
  );
}
