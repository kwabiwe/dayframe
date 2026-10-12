import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner feedback (12 Oct 2026): the command timer's Suggestions and # Tags cards looked unrelated.
// Suggestions, Tags and the @ Activities list are one FloatingList with one style; only the row
// content differs. Naming: sentence case, the plural noun ("Suggestions", "Tags", "Activities").
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("one floating list (FloatingList)", () => {
  it("is used by Suggestions, Tags and Activities, with sentence-case headings", () => {
    expect(source("TaskSuggestionsPanel.tsx")).toContain('heading="Suggestions"');
    const tagInput = source("InlineTagInput.tsx");
    expect(tagInput).toContain('heading="Tags"');
    expect(tagInput).toContain('heading="Activities"');
    expect(tagInput).not.toContain(">TAGS<");
    expect(tagInput).not.toContain("inline-tag-suggestions-title");
    expect(source("FloatingList.tsx")).toContain('heading: "Suggestions" | "Tags" | "Activities"');
  });

  it("shares one container, heading and row treatment", () => {
    expect(rule(".df-flist")).toMatch(/max-width: calc\(100vw - 24px\);/);
    const head = rule(".df-flist-head");
    expect(head).toMatch(/font-size: 12px;/);
    expect(head).toMatch(/text-transform: none;/);
    expect(head).toMatch(/letter-spacing: 0;/);
    expect(head).not.toContain("border");
    const row = rule(".df-flist .df-flist-row");
    expect(row).toMatch(/min-height: 44px;/);
    expect(row).toMatch(/padding: 6px 10px;/);
    expect(row).toMatch(/font-size: 13px;/);
    expect(css).toMatch(/\.df-flist \.df-flist-row:hover,\n\.df-flist \.df-flist-row\.is-highlighted,\n\.df-flist \.df-flist-row:focus-visible \{\s*background: var\(--surface-muted\);/);
    // Focus is the neutral grey treatment, never blue or coral.
    expect(css).toMatch(/\n\.df-flist \.df-flist-row:focus-visible \{\s*outline: 0;\s*box-shadow: inset 0 0 0 2px var\(--web-focus-border\);/);
    // The old per-list heads and rows are gone, so the lists cannot drift apart again.
    expect(css).not.toContain(".swiss-task-suggestions-header {");
    expect(css).not.toContain(".inline-tag-suggestions-title");
    expect(css).not.toContain(".inline-tag-suggestions button");
    expect(css).not.toContain(".swiss-task-suggestions-list button");
  });

  it("appears with opacity only, and at once under Reduce Motion", () => {
    expect(rule(".df-flist.ui-floating-surface,\n.df-flist.ui-floating-surface.is-open")).toMatch(/transform: none;/);
    expect(rule(".df-flist.ui-floating-surface")).toMatch(/transition: opacity 120ms ease-out, visibility 0s linear 120ms;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.df-flist\.ui-floating-surface,\n\s*\.df-flist\.ui-floating-surface\.is-open \{\s*transition: none;/);
  });

  it("keeps the Tags and Activities lists inside the viewport with internal scrolling", () => {
    const lists = rule(".inline-tag-suggestions,\n.inline-activity-suggestions");
    expect(lists).toMatch(/max-height: min\(19rem, calc\(100dvh - 10rem\)\);/);
    expect(lists).toMatch(/overflow-y: auto;/);
    expect(css).toContain(".inline-activity-suggestions.is-portalled {");
  });
});
