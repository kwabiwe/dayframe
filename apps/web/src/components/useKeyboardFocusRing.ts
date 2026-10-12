"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";

/**
 * Trello 213 (Codex r1): a field that should show its neutral focus perimeter only for keyboard,
 * shortcut, programmatic or assistive-technology focus — never after a click or tap. Browsers match
 * `:focus-visible` on text inputs for pointer focus too, so the pointer origin is tracked here:
 *
 * - a pointer press inside the wrapper marks the next focus as pointer-origin and hides the ring;
 * - any keydown (Tab, a shortcut such as N) clears that mark before focus moves, so the focus it
 *   causes shows the ring; typing in an already focused field does not change the ring;
 * - focus arriving without a pointer press (assistive technology, `element.focus()`) shows it;
 * - focus leaving the wrapper clears both.
 *
 * Spread `handlers` on the wrapper and expose `focusRing` as `data-focus-ring`.
 */
export function useKeyboardFocusRing() {
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const pointerOriginRef = useRef(false);

  useEffect(() => {
    const clearPointerOrigin = () => {
      pointerOriginRef.current = false;
    };
    window.addEventListener("keydown", clearPointerOrigin, true);
    return () => window.removeEventListener("keydown", clearPointerOrigin, true);
  }, []);

  return {
    focusRing: keyboardFocus ? ("keyboard" as const) : undefined,
    handlers: {
      onPointerDownCapture: () => {
        pointerOriginRef.current = true;
        setKeyboardFocus(false);
      },
      onFocus: () => {
        setKeyboardFocus(!pointerOriginRef.current);
      },
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        pointerOriginRef.current = false;
        setKeyboardFocus(false);
      }
    }
  };
}
