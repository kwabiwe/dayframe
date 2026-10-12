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
 * The one floating list under a text field (Suggestions, Tags, Activities in the command timer
 * and the block editors): the same raised surface, a sentence-case heading that names the
 * listbox, the same 44 px rows and the same neutral highlight (`df-flist*` in globals.css). Rows
 * are the caller's `role="option"` buttons with the `df-flist-row` class; their content differs.
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
