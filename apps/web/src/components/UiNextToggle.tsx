"use client";

import { useSyncExternalStore } from "react";
import { UI_PREVIEW_STORAGE_KEY } from "@/lib/ui-preview";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readPreview() {
  return document.documentElement.getAttribute("data-ui") === "next";
}

/**
 * UI review preview switch (29 Oct 2026). Staging and local only: flips :root[data-ui="next"], which
 * ui-next.css reads, so the owner can compare the current look with the proposed tokens on real data.
 * `?ui=next` or `?ui=current` in the address sets it too. Remembered per browser.
 */
export function UiNextToggle() {
  const next = useSyncExternalStore(subscribe, readPreview, () => false);

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
