"use client";

import type { CSSProperties, KeyboardEventHandler, ReactNode, Ref } from "react";

/**
 * The one floating list under a text field (Suggestions, Tags, Activities in the command timer
 * and the block editors): the same raised surface, a sentence-case heading that also names the
 * listbox, the same 44 px rows and the same neutral highlight (`df-flist*` in globals.css). Rows
 * are the caller's `role="option"` buttons with the `df-flist-row` class; their content differs.
 * It stays mounted while closed (hidden, inert) so it can fade: opacity only, none under Reduce
 * Motion.
 */
export function FloatingList({
  children,
  className = "",
  heading,
  headClassName = "",
  id,
  isOpen,
  onKeyDown,
  panelRef,
  rowsClassName = "",
  style
}: {
  children: ReactNode;
  className?: string;
  heading: "Suggestions" | "Tags" | "Activities";
  headClassName?: string;
  id?: string;
  isOpen: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  panelRef?: Ref<HTMLDivElement>;
  rowsClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden={!isOpen}
      aria-label={heading}
      className={`ui-floating-surface df-flist ${className}${isOpen ? " is-open" : ""}`}
      id={id}
      inert={!isOpen}
      onKeyDown={onKeyDown}
      ref={panelRef}
      role="listbox"
      style={style}
    >
      <div aria-hidden="true" className={`df-flist-head ${headClassName}`.trim()}>{heading}</div>
      <div className={`df-flist-rows ${rowsClassName}`.trim()}>{children}</div>
    </div>
  );
}
