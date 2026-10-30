"use client";

import { useSyncExternalStore } from "react";
import { UI_PREVIEW_STORAGE_KEY } from "@/lib/ui-preview";
import { useKeyboardFocusMarks } from "@/components/useKeyboardFocusRing";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // The init script may set data-ui after React has read it (hydration), and nothing else would say so: watch the
  // attribute itself, so the Proposed structure (the day row, the timer bar) always follows it (owner bug, 30 Oct 2026).
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui"] });
  return () => {
    listeners.delete(listener);
    observer.disconnect();
  };
}

function readPreview() {
  return document.documentElement.getAttribute("data-ui") === "next";
}

/**
 * Whether the staging preview shows the Proposed UI (round 2, 30 Oct 2026). False on the server and in production, so
 * structural Proposed changes only take over after hydration on staging.
 */
export function useUiNext() {
  return useSyncExternalStore(subscribe, readPreview, () => false);
}

/**
 * UI review preview switch (29 Oct 2026). Staging and local only: flips :root[data-ui="next"], which
 * ui-next.css reads, so the owner can compare the current look with the proposed tokens on real data.
 * `?ui=next` or `?ui=current` in the address sets it too. Remembered per browser.
 */
export function UiNextToggle() {
  const next = useSyncExternalStore(subscribe, readPreview, () => false);
  // Proposed fields ring for keyboard focus only (ui-next.css reads `data-kb-focus`).
  useKeyboardFocusMarks();

  function choose(value: boolean) {
    if (value) document.documentElement.setAttribute("data-ui", "next");
    else document.documentElement.removeAttribute("data-ui");
    try {
      localStorage.setItem(UI_PREVIEW_STORAGE_KEY, value ? "next" : "current");
    } catch {
      // Private windows: the switch still works for this page.
    }
    listeners.forEach((listener) => listener());
  }

  return (
    <div className="ui-preview-toggle" role="group" aria-label="UI preview">
      <button aria-pressed={!next} onClick={() => choose(false)} type="button">
        Current
      </button>
      <button aria-pressed={next} onClick={() => choose(true)} type="button">
        Proposed
      </button>
    </div>
  );
}
