"use client";

import { useKeyboardFocusMarks } from "@/components/useKeyboardFocusRing";

/** Marks keyboard focus page-wide (`data-kb-focus`), so fill-led fields ring only for the keyboard (UI review round 2). */
export function KeyboardFocusMarks() {
  useKeyboardFocusMarks();
  return null;
}
