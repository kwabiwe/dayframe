import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X3 (owner, Trello): one activity marker shape everywhere — the small rounded-square block, never a
// round dot. Non-activity dots (status, now line, goal dots, avatars) are deliberately not covered.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// Markers rendered today (each is used by a component; see the rendered-use test below).
const ACTIVITY_MARKERS = [
  ".category-data-marker",
  ".swiss-task-suggestions-list i",
  ".df-report-row .df-erow-block",
  ".category-picker-color-swatch",
  ".swiss-focus-dot",
  ".calendar-compact-category-dot",
  ".df-cal-day-bars i",
];

function rulesFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`\\n([^{}\\n]*${escaped}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, "g"))].map((m) => m[2]);
}

describe("activity markers are blocks (X3)", () => {
  it("defines one shared marker radius", () => {
    expect(css).toMatch(/--activity-marker-radius:\s*30%;/);
  });

  it.each(ACTIVITY_MARKERS)("%s uses the block radius and is never round", (selector) => {
    const rules = rulesFor(selector);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.includes("border-radius: var(--activity-marker-radius);"))).toBe(true);
    for (const r of rules) expect(r).not.toMatch(/border-radius:\s*(999px|50%|9999px)/);
  });
});
