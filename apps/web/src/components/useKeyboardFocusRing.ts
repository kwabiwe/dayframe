"use client";

import { useEffect, useState, type FocusEvent } from "react";

/**
 * Trello 213 (Codex r1, r2): a field whose neutral focus perimeter shows for keyboard, shortcut,
 * programmatic and assistive-technology focus, never after a click or tap. Browsers match
 * `:focus-visible` on text inputs for pointer focus too, so the last input modality is tracked at
 * document level, the way focus-visible polyfills do:
 *
 * - `keydown` → "keyboard" (Tab, or a shortcut such as N that then moves focus);
 * - `pointerdown` (mouse, pen or touch) → "pointer", held through the gesture's focus hand-off:
 *   after `pointerup`/`pointercancel` it expires to "unknown" only once two animation frames and a
 *   task have passed, so focus a click schedules (a picker focusing its search in a frame, a
 *   `setTimeout(0)` restore, WebKit's blur to body first) still counts as pointer focus;
 * - "unknown" (nothing recent: script or assistive-technology focus) shows the ring.
 *
 * A gesture that focuses nothing (a click in a gutter) therefore cannot leave a stale pointer mark.
 */
type Modality = "keyboard" | "pointer" | "unknown";

let modality: Modality = "unknown";
let gesture = 0;
let listeners = 0;

function onKeyDown() {
  gesture += 1;
  modality = "keyboard";
}

function onPointerDown() {
  gesture += 1;
  modality = "pointer";
}

function onPointerEnd() {
  const ended = gesture;
  const expire = () => {
    // A newer key or pointer press owns the modality now.
    if (gesture === ended && modality === "pointer") modality = "unknown";
  };
  const frame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback: () => void) => window.setTimeout(callback, 16);
  frame(() => frame(() => window.setTimeout(expire, 0)));
}

function install() {
  listeners += 1;
  if (listeners > 1) return;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerEnd, true);
  document.addEventListener("pointercancel", onPointerEnd, true);
}

function uninstall() {
  listeners -= 1;
  if (listeners > 0) return;
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("pointerup", onPointerEnd, true);
  document.removeEventListener("pointercancel", onPointerEnd, true);
  modality = "unknown";
}

/** Spread `handlers` on the wrapper and expose `focusRing` as `data-focus-ring`. */
export function useKeyboardFocusRing() {
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  useEffect(() => {
    install();
    return uninstall;
  }, []);

  return {
    focusRing: keyboardFocus ? ("keyboard" as const) : undefined,
    handlers: {
      // A press inside the field hides the ring at once, even if focus does not move.
      onPointerDownCapture: () => setKeyboardFocus(false),
      onFocus: () => setKeyboardFocus(modality !== "pointer"),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setKeyboardFocus(false);
      }
    }
  };
}
