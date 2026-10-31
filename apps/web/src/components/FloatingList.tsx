"use client";

import { DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH, resolveActivityIcon } from "@dayframe/shared";
import { Check, Plus, Search, X } from "lucide-react";
import { useKeyboardFocusRing } from "./useKeyboardFocusRing";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type ChangeEventHandler,
  type CSSProperties,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  type RefObject
} from "react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { blockStyle } from "@/lib/block-style";

/** Phones get the sheet (the command timer's own narrow breakpoint). */
export const FLOATING_LIST_PHONE_QUERY = "(max-width: 560px)";
const SHEET_MARGIN = 12;
const SHEET_GAP = 6;
/** Below the field when this much room is left there (or more than above it); above otherwise. */
const SHEET_MIN_BELOW = 160;

export type FloatingListHeading = "Suggestions" | "Tags" | "Activities";

/**
 * One keyboard hint in a list's footer: the glyph and its short label are drawn (and hidden from
 * assistive technology); `spoken` is the sentence a screen reader gets instead.
 */
export type FloatingListHint = { glyph: string; label: string; spoken: string };

/** The footer hints (owner design, 13 Oct 2026): `@ activity · # tag · ↵ start` and friends. */
export const FLOATING_LIST_HINTS = {
  /** Command timer Suggestions while idle: Enter starts the block. */
  suggestionsStart: [
    { glyph: "@", label: "activity", spoken: "Type @ to choose an activity." },
    { glyph: "#", label: "tag", spoken: "Type # to add a tag." },
    { glyph: "↵", label: "start", spoken: "Enter starts the block." }
  ],
  /** Command timer Suggestions while recording: a suggestion fills the running block. */
  suggestionsUse: [
    { glyph: "@", label: "activity", spoken: "Type @ to choose an activity." },
    { glyph: "#", label: "tag", spoken: "Type # to add a tag." },
    { glyph: "↵", label: "use", spoken: "Enter on a suggestion uses it." }
  ],
  /** Suggestions in the block editors (no `@` list there): a suggestion fills the draft. */
  suggestionsEditor: [
    { glyph: "#", label: "tag", spoken: "Type # to add a tag." },
    { glyph: "↵", label: "use", spoken: "Enter on a suggestion uses it." }
  ],
  activities: [
    { glyph: "↑↓", label: "choose", spoken: "Up and down arrows choose an activity." },
    { glyph: "↵", label: "pick", spoken: "Enter picks it." }
  ],
  tags: [
    { glyph: "↵", label: "add", spoken: "Enter adds the tag." },
    { glyph: "⌫", label: "remove", spoken: "Backspace removes the typed tag." }
  ],
  /** The Tags button's list: Enter toggles the highlighted tag, Backspace in an empty search removes the last. */
  tagsPicker: [
    { glyph: "↵", label: "add", spoken: "Enter adds or removes the highlighted tag." },
    { glyph: "⌫", label: "remove", spoken: "Backspace in an empty search removes the last tag." }
  ]
} as const satisfies Record<string, readonly FloatingListHint[]>;

/**
 * The one floating list under a text field (Suggestions, Tags, Activities in the command timer
 * and the block editors): the same raised surface, a small uppercase muted header (the DOM text
 * stays sentence case and names the listbox), the same 36 px rows (44 px on phones and touch)
 * with an inset rounded highlight, right-aligned muted metadata (`df-flist-meta`) and one footer
 * row of keyboard hints (`df-flist*` in globals.css). Rows are the caller's `role="option"`
 * buttons with the `df-flist-row` class; their content differs.
 *
 * On phones (560 px and below) with an `anchorRef` it is a full-width sheet: fixed 12 px from the
 * screen edges, just below the field (above it when the keyboard leaves no room), its height
 * bounded by the visual viewport, so it stays above the on-screen keyboard, scrolling inside,
 * with a visible 44 px Close (`onClose`; a focused row hands focus back to the anchor's
 * combobox field first). It stays mounted while closed (hidden, inert) so it can
 * fade: opacity only, none under Reduce Motion.
 *
 * The Activity and Tags buttons open the same list with a `search` field at the top (there is no
 * typed query to filter by): focus sits in that field, which is the combobox for the rows.
 */
export function FloatingList({
  activeId,
  anchorRef,
  body,
  children,
  closeDisabled = false,
  className = "",
  heading,
  headClassName = "",
  hints,
  id,
  isOpen,
  multiselectable = false,
  onBlur,
  onClose,
  onKeyDown,
  panelRef,
  returnFocusRef,
  rowsClassName = "",
  search,
  style
}: {
  /**
   * The highlighted option's id (the field's `aria-activedescendant`). While the list is open it
   * is kept in view: on open (the current choice) and as ↑/↓ move it, for every list.
   */
  activeId?: string;
  anchorRef?: RefObject<HTMLElement | null>;
  /** Shown instead of the search, rows and hints (the Activity button's Create form). */
  body?: ReactNode;
  children: ReactNode;
  /** The phone sheet's Close is unavailable (a Create is being saved). */
  closeDisabled?: boolean;
  className?: string;
  heading: FloatingListHeading;
  headClassName?: string;
  /** The footer's keyboard hints (outside the listbox, so they are never options). */
  hints?: readonly FloatingListHint[];
  /** The listbox's id (what the field's `aria-controls` names). */
  id?: string;
  isOpen: boolean;
  /** A list that holds several choices at once (the Tags button): options say whether each is chosen. */
  multiselectable?: boolean;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  /** Closes the list: the phone sheet's Close control. */
  onClose: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  panelRef?: Ref<HTMLDivElement>;
  /** Where the phone sheet's Close puts focus when it was inside the list (default: the anchor's field). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  rowsClassName?: string;
  /** A search field above the rows (`FloatingListSearch`), for a list opened from a button. */
  search?: ReactNode;
  style?: CSSProperties;
}) {
  const sheetStyle = usePhoneSheet(isOpen, anchorRef);
  const sheet = Boolean(sheetStyle);
  // The highlighted row stays visible in a list longer than the panel, so ↑/↓ and Enter never
  // act on a row the person cannot see. A frame later, once the panel (or sheet) has its size.
  useEffect(() => {
    if (!isOpen || !activeId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, isOpen, sheet]);
  return (
    <div
      aria-hidden={!isOpen}
      className={`ui-floating-surface df-flist ${className}${isOpen ? " is-open" : ""}${sheet ? " is-sheet" : ""}`}
      inert={!isOpen}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      // A press on the surface itself (its head, padding or hints) keeps focus where it is (the
      // field or the list's search), so the list never closes under the pointer; fields inside
      // it (the search, a Create form) still take focus.
      onMouseDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest("input, textarea, select")) event.preventDefault();
      }}
      ref={panelRef}
      style={sheetStyle ? { ...style, ...sheetStyle } : style}
    >
      <div className={`df-flist-head ${headClassName}`.trim()}>
        <span aria-hidden="true">{heading}</span>
        <button
          aria-label={`Close ${heading.toLocaleLowerCase()}`}
          className="df-flist-close"
          disabled={closeDisabled}
          hidden={!sheet}
          // The field keeps focus (and the keyboard stays up) when Close is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // A row ↓ moved focus to is about to be hidden: focus goes back to the field (the
            // anchor's combobox) first, so it is never lost and the list stays closed.
            const surface = event.currentTarget.closest(".df-flist");
            if (surface?.contains(document.activeElement)) {
              if (returnFocusRef) returnFocusRef.current?.focus();
              else anchorRef?.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
            }
            onClose();
          }}
          tabIndex={-1}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      {body ?? (
        <>
          {search}
          <div
            aria-label={heading}
            aria-multiselectable={multiselectable || undefined}
            className={`df-flist-rows ${rowsClassName}`.trim()}
            id={id}
            role="listbox"
          >
            {children}
          </div>
        </>
      )}
      {hints?.length && !body ? (
        <p className="df-flist-foot">
          {hints.map((hint, index) => (
            <span className="df-flist-hint" key={hint.glyph}>
              {index ? <span aria-hidden="true" className="df-flist-hint-sep">·</span> : null}
              <kbd aria-hidden="true">{hint.glyph}</kbd>
              <span aria-hidden="true">{hint.label}</span>
              <span className="sr-only">{hint.spoken}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/**
 * After a press outside a list opened from a button (Codex r5 on #402): focus goes back to
 * the opener only if the press left focus on no element (non-focusable content, or a button
 * WebKit does not focus), so focus never ends on the page.
 */
export function restoreFocusIfDropped(opener: HTMLElement | null | undefined) {
  const activeElement = document.activeElement;
  if (!activeElement || activeElement === document.body) opener?.focus();
}

/**
 * The search field at the top of a list opened from a button (the Activity block, the Tags
 * button): the combobox for the rows below it. Focus stays here; ↑/↓ move the highlight
 * (`aria-activedescendant`) and Enter picks, as in the typed `@`/`#` lists.
 */
export function FloatingListSearch({
  activeDescendant,
  className = "",
  expanded,
  inputRef,
  label,
  listId,
  onBlur,
  onChange,
  onKeyDown,
  value
}: {
  activeDescendant?: string;
  className?: string;
  /** Whether the list is open (a closed list's field must not read as an open popup). */
  expanded: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** The field's visible placeholder and its accessible name ("Search activities", "Search tags"). */
  label: string;
  listId: string;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  value: string;
}) {
  // The neutral ring shows for keyboard focus only, never after a click or tap (UI review round 2).
  const focusRing = useKeyboardFocusRing({ keyboardOnly: true });
  return (
    <div className={`ui-compound-control df-flist-search ${className}`.trim()} data-focus-ring={focusRing.focusRing} {...focusRing.handlers}>
      <Search aria-hidden="true" size={15} />
      <input
        aria-activedescendant={expanded ? activeDescendant : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={expanded}
        aria-label={label}
        autoComplete="off"
        onBlur={onBlur}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={label}
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        type="text"
        value={value}
      />
    </div>
  );
}

/** An activity the Activities list offers (the `@` list and the Activity block's list). */
export type FloatingListActivity = { id: string; name: string; color: string; icon?: string | null; isPinned?: boolean };

/**
 * One Activities row, typed (`@`) or from the Activity block: the activity's solid block with its
 * icon (the neutral activity dot for "No activity"), its name, "Pinned" for a quick start (the
 * option's accessible description, never part of its name) and, from the block, a check on the
 * block's current activity. The option's name is its visible text (WCAG 2.5.3).
 */
export function FloatingListActivityOption({
  activity,
  current = false,
  highlighted,
  id,
  onHighlight,
  onPick,
  selected
}: {
  /** null is "No activity". */
  activity: FloatingListActivity | null;
  /** The block's current activity (the Activity block's list): a check, hidden from the name. */
  current?: boolean;
  highlighted: boolean;
  id: string;
  onHighlight: () => void;
  onPick: () => void;
  selected: boolean;
}) {
  const pinnedId = activity?.isPinned ? `${id}-pinned` : undefined;
  return (
    <button
      aria-describedby={pinnedId}
      aria-selected={selected}
      className={`df-flist-row df-flist-row--activity${highlighted ? " is-highlighted" : ""}${activity ? "" : " is-none"}`}
      id={id}
      // The field keeps focus (and the phone keyboard stays up).
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHighlight}
      onClick={onPick}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`df-flist-block${activity ? " df-block" : " is-none"}`}
        style={activity ? blockStyle(activity.color, activity.name) : undefined}
      >
        <DayframeIcon glyph={activity ? resolveActivityIcon(activity).glyph : DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH} size={13} />
      </span>
      <span className="df-flist-label">{activity?.name ?? "No activity"}</span>
      {pinnedId ? <span aria-hidden="true" className="df-flist-meta" id={pinnedId}>Pinned</span> : null}
      {current ? <Check aria-hidden="true" className="df-flist-current" size={15} strokeWidth={2.2} /> : null}
    </button>
  );
}

/**
 * One Tags row, typed (`#`) or from the Tags button: the tag glyph, `#name` and its use count, or
 * `Create “#name”` with a neutral "+". From the button the list is multi-select: a chosen tag
 * shows a check and a remove ×, and its option is `aria-selected`; `unavailable` is a tag that
 * cannot be added (the tag limit). The option's name is its visible text (WCAG 2.5.3).
 */
export function FloatingListTagOption({
  checked,
  count,
  create = false,
  disabled = false,
  highlighted,
  id,
  name,
  onHighlight,
  onPick,
  selected,
  tabIndex = -1,
  unavailable = false
}: {
  /** The Tags button's list: whether the tag is on the block (undefined in the typed list). */
  checked?: boolean;
  count?: number | null;
  create?: boolean;
  disabled?: boolean;
  highlighted: boolean;
  id: string;
  name: string;
  onHighlight: () => void;
  onPick: () => void;
  selected: boolean;
  tabIndex?: number;
  unavailable?: boolean;
}) {
  return (
    <button
      aria-disabled={unavailable || undefined}
      aria-selected={selected}
      className={`df-flist-row df-flist-row--tag${highlighted ? " is-highlighted" : ""}${create ? " is-create" : ""}${checked ? " is-checked" : ""}${unavailable ? " is-unavailable" : ""}`}
      disabled={disabled}
      id={id}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHighlight}
      onClick={() => {
        if (!unavailable) onPick();
      }}
      role="option"
      tabIndex={tabIndex}
      type="button"
    >
      <span aria-hidden="true" className={`df-flist-lead${checked ? " df-flist-check" : ""}`}>
        {create
          ? <Plus size={14} strokeWidth={2.2} />
          : checked
            ? <Check size={13} strokeWidth={2.4} />
            : <DayframeIcon glyph="tag" size={14} />}
      </span>
      <span className="df-flist-label">{create ? `Create “#${name}”` : `#${name}`}</span>
      {checked
        ? <X aria-hidden="true" className="df-flist-remove" size={14} strokeWidth={2} />
        : count !== null && count !== undefined && !create
          ? <span aria-hidden="true" className="df-flist-meta">{count}</span>
          : null}
    </button>
  );
}

/** The phone sheet's fixed position from the field and the visual viewport, or null off phones. */
function usePhoneSheet(isOpen: boolean, anchorRef: RefObject<HTMLElement | null> | undefined) {
  const [phone, setPhone] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const sheet = phone && anchorRef !== undefined;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(FLOATING_LIST_PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    // Older engines (and some test doubles) only have addListener.
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  useLayoutEffect(() => {
    if (!sheet || !isOpen) return undefined;
    function update() {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const rect = anchor.getBoundingClientRect();
      const visibleTop = viewportTop + SHEET_MARGIN;
      const visibleBottom = viewportTop + viewportHeight - SHEET_MARGIN;
      const below = visibleBottom - (rect.bottom + SHEET_GAP);
      const above = rect.top - SHEET_GAP - visibleTop;
      const placeBelow = below >= SHEET_MIN_BELOW || below >= above;
      // Clamped to the visible viewport: a page that scrolls (the phone Calendar) can carry the
      // field away, but the sheet's head, search and Close stay on screen (Codex r1 on #488).
      const top = Math.min(visibleBottom, Math.max(visibleTop, rect.bottom + SHEET_GAP));
      const bottomEdge = Math.max(visibleTop, Math.min(visibleBottom, rect.top - SHEET_GAP));
      setPosition({
        bottom: placeBelow ? "auto" : window.innerHeight - bottomEdge,
        left: viewportLeft + SHEET_MARGIN,
        maxHeight: Math.max(0, placeBelow ? visibleBottom - top : bottomEdge - visibleTop),
        right: window.innerWidth - (viewportLeft + (viewport?.width ?? window.innerWidth)) + SHEET_MARGIN,
        top: placeBelow ? top : "auto",
        width: "auto"
      });
    }
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (anchorRef?.current) observer?.observe(anchorRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchorRef, isOpen, sheet]);

  // Until it is measured the sheet stays hidden; after that the surface's own open state rules.
  return sheet ? position ?? { visibility: "hidden" } : null;
}
