"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  type RefObject
} from "react";

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
 */
export function FloatingList({
  anchorRef,
  children,
  className = "",
  heading,
  headClassName = "",
  hints,
  id,
  isOpen,
  onClose,
  onKeyDown,
  panelRef,
  rowsClassName = "",
  style
}: {
  anchorRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  heading: FloatingListHeading;
  headClassName?: string;
  /** The footer's keyboard hints (outside the listbox, so they are never options). */
  hints?: readonly FloatingListHint[];
  /** The listbox's id (what the field's `aria-controls` names). */
  id?: string;
  isOpen: boolean;
  /** Closes the list: the phone sheet's Close control. */
  onClose: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  panelRef?: Ref<HTMLDivElement>;
  rowsClassName?: string;
  style?: CSSProperties;
}) {
  const sheetStyle = usePhoneSheet(isOpen, anchorRef);
  const sheet = Boolean(sheetStyle);
  return (
    <div
      aria-hidden={!isOpen}
      className={`ui-floating-surface df-flist ${className}${isOpen ? " is-open" : ""}${sheet ? " is-sheet" : ""}`}
      inert={!isOpen}
      onKeyDown={onKeyDown}
      ref={panelRef}
      style={sheetStyle ? { ...style, ...sheetStyle } : style}
    >
      <div className={`df-flist-head ${headClassName}`.trim()}>
        <span aria-hidden="true">{heading}</span>
        <button
          aria-label={`Close ${heading.toLocaleLowerCase()}`}
          className="df-flist-close"
          hidden={!sheet}
          // The field keeps focus (and the keyboard stays up) when Close is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // A row ↓ moved focus to is about to be hidden: focus goes back to the field (the
            // anchor's combobox) first, so it is never lost and the list stays closed.
            const surface = event.currentTarget.closest(".df-flist");
            if (surface?.contains(document.activeElement)) {
              anchorRef?.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
            }
            onClose();
          }}
          tabIndex={-1}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div aria-label={heading} className={`df-flist-rows ${rowsClassName}`.trim()} id={id} role="listbox">
        {children}
      </div>
      {hints?.length ? (
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
      const below = viewportTop + viewportHeight - SHEET_MARGIN - (rect.bottom + SHEET_GAP);
      const above = rect.top - SHEET_GAP - (viewportTop + SHEET_MARGIN);
      const placeBelow = below >= SHEET_MIN_BELOW || below >= above;
      setPosition({
        bottom: placeBelow ? "auto" : window.innerHeight - (rect.top - SHEET_GAP),
        left: viewportLeft + SHEET_MARGIN,
        maxHeight: Math.max(0, placeBelow ? below : above),
        right: window.innerWidth - (viewportLeft + (viewport?.width ?? window.innerWidth)) + SHEET_MARGIN,
        top: placeBelow ? rect.bottom + SHEET_GAP : "auto",
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
