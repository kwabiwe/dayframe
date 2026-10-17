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
    expect(source("FloatingList.tsx")).toContain('export type FloatingListHeading = "Suggestions" | "Tags" | "Activities";');
  });

  it("shares one container, heading and row treatment", () => {
    expect(rule(".df-flist")).toMatch(/max-width: calc\(100vw - 24px\);/);
    // The rows' highlight sits inset from the panel edge.
    expect(rule(".df-flist")).toMatch(/padding: 6px;/);
    // Owner design A (13 Oct 2026): a small uppercase muted header, tracked, no rule under it.
    const head = rule(".df-flist-head");
    expect(head).toMatch(/font-size: 11px;/);
    expect(head).toMatch(/text-transform: uppercase;/);
    expect(head).toMatch(/letter-spacing: 0\.06em;/);
    expect(head).toMatch(/color: var\(--muted\);/);
    expect(head).not.toContain("border");
    // 36 px rows, 44 px on phones and touch screens (AGENTS touch targets).
    expect(rule(".df-flist")).toMatch(/--df-flist-row: 36px;/);
    expect(css).toMatch(/@media \(max-width: 560px\), \(any-pointer: coarse\) \{\s*\.df-flist \{\s*--df-flist-row: 44px;/);
    const row = rule(".df-flist .df-flist-row");
    expect(row).toMatch(/min-height: var\(--df-flist-row\);/);
    expect(row).toMatch(/border-radius: 8px;/);
    expect(row).toMatch(/padding: 0 10px;/);
    expect(row).toMatch(/font-size: 13px;/);
    expect(css).toMatch(/\.df-flist \.df-flist-row:hover,\n\.df-flist \.df-flist-row\.is-highlighted,\n\.df-flist \.df-flist-row:focus-visible \{\s*background: var\(--surface-muted\);/);
    // Focus is the neutral grey treatment, never blue or coral.
    expect(css).toMatch(/\n\.df-flist \.df-flist-row:focus-visible \{\s*outline: 0;\s*box-shadow: inset 0 0 0 2px var\(--web-focus-border\);/);
    // Right-aligned muted metadata.
    const meta = rule(".df-flist-meta");
    expect(meta).toMatch(/margin-left: auto;/);
    expect(meta).toMatch(/color: var\(--muted\);/);
    // The old per-list heads and rows are gone, so the lists cannot drift apart again.
    expect(css).not.toContain(".swiss-task-suggestions-header {");
    expect(css).not.toContain(".inline-tag-suggestions-title");
    expect(css).not.toContain(".inline-tag-suggestions button");
    expect(css).not.toContain(".swiss-task-suggestions-list button");
    expect(css).not.toContain(".df-flist-row--activity > span:last-child");
  });

  it("builds every row of the three lists from the same parts", () => {
    const suggestions = source("TaskSuggestionsPanel.tsx");
    const tagInput = source("InlineTagInput.tsx");
    const list = source("FloatingList.tsx");
    expect(suggestions).toContain('className="df-flist-row df-flist-row--suggestion"');
    // Tag and activity rows are one component each, shared by the typed lists and the buttons' lists.
    expect(list).toContain("`df-flist-row df-flist-row--tag");
    expect(list).toContain("`df-flist-row df-flist-row--activity");
    expect(tagInput).toContain("<FloatingListTagOption");
    expect(tagInput).toContain("<FloatingListActivityOption");
    expect(tagInput).not.toContain("`df-flist-row df-flist-row--");
    for (const host of [suggestions, list]) {
      expect(host).toContain('className="df-flist-label"');
      expect(host).toContain('className="df-flist-meta"');
    }
    // Metadata is real data: the activity name, the tag's use count, a pinned (quick start) marker.
    expect(suggestions).toMatch(/df-flist-meta">\{suggestion\.categoryName/);
    expect(tagInput).toContain("count: tag.usageCount");
    expect(list).toContain('<span aria-hidden="true" className="df-flist-meta" id={pinnedId}>Pinned</span>');
    expect(list).toContain("aria-describedby={pinnedId}");
    // No stray rules: the footer, the head and the rows draw no border.
    for (const selector of [".df-flist-foot", ".df-flist-head", ".df-flist .df-flist-row", ".df-flist-meta"]) {
      expect(rule(selector), selector).not.toMatch(/border(?:-top|-bottom)?:\s*1px/);
    }
  });

  it("ends each list with one footer row of keyboard hints", () => {
    const list = source("FloatingList.tsx");
    expect(list).toContain('<p className="df-flist-foot">');
    expect(list).toContain('<kbd aria-hidden="true">{hint.glyph}</kbd>');
    expect(list).toContain('<span className="sr-only">{hint.spoken}</span>');
    const hints = (key: string) => {
      const block = list.slice(list.indexOf(`  ${key}: [`), list.indexOf("]", list.indexOf(`  ${key}: [`)));
      return [...block.matchAll(/glyph: "([^"]+)", label: "([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`).join(" · ");
    };
    expect(hints("suggestionsStart")).toBe("@ activity · # tag · ↵ start");
    expect(hints("activities")).toBe("↑↓ choose · ↵ pick");
    expect(hints("tags")).toBe("↵ add · ⌫ remove");
    expect(source("InlineTagInput.tsx")).toContain("hints={FLOATING_LIST_HINTS.tags}");
    expect(source("InlineTagInput.tsx")).toContain("hints={FLOATING_LIST_HINTS.activities}");
    expect(source("PersistentTimerBar.tsx")).toContain("hints={active ? FLOATING_LIST_HINTS.suggestionsUse : FLOATING_LIST_HINTS.suggestionsStart}");
  });

  it("reads Create “#name” in the Tags list and the Tags button's list, never the old Add/filter wording", () => {
    const tagInput = source("InlineTagInput.tsx");
    // One Create row for both paths (FloatingListTagOption); the button's list adds it after the matches.
    expect(source("FloatingList.tsx")).toContain("{create ? `Create “#${name}”` : `#${name}`}");
    expect(tagInput).toContain("create: true, id: \"create\", label: pickerCreateName");
    expect(tagInput).not.toContain('placeholder="Add/filter tags"');
    // Create rows are neutral like the others, no divider above: coral stays for recording and the primary action.
    expect(rule(".df-flist .df-flist-row.is-create")).toMatch(/color: var\(--foreground\);/);
    expect(rule(".df-flist .df-flist-row.is-create")).not.toContain("border-top");
    expect(rule(".df-flist-lead")).toMatch(/color: var\(--muted\);/);
    expect(css).not.toMatch(/\.is-create[^{]*\{[^}]*accent/);
    expect(css).not.toContain(".inline-tag-picker-create");
    // The Create row's name is its visible phrase (WCAG 2.5.3); the old "Create new tag, …" is gone.
    expect(tagInput).not.toContain("Create new tag, ");
    expect(tagInput).not.toContain("Existing tag, ");
  });

  it("opens the same lists from the Activity block and the Tags button (owner, 14 Oct 2026)", () => {
    const picker = source("CategoryPicker.tsx");
    const tagInput = source("InlineTagInput.tsx");
    // The old "Activity for this block" chip grid and the tag picker dialog are gone.
    expect(picker).not.toContain("Activity for this block");
    expect(picker).not.toContain("df-actmenu");
    expect(picker).not.toContain('"chip"');
    expect(css).not.toContain(".df-actmenu");
    expect(css).not.toContain(".df-rchip.category-picker-create-option");
    expect(tagInput).not.toContain("inline-tag-picker-header");
    expect(tagInput).not.toContain("inline-tag-picker-list");
    expect(css).not.toContain(".inline-tag-picker-header");
    expect(css).not.toContain(".inline-tag-check");
    // Both are the FloatingList with a search field, the shared rows and the shared hints.
    expect(picker).toContain('heading="Activities"');
    expect(picker).toContain("<FloatingListSearch");
    expect(picker).toContain("<FloatingListActivityOption");
    expect(picker).toContain("hints={FLOATING_LIST_HINTS.activities}");
    expect(picker).toContain('label="Search activities"');
    expect(tagInput).toContain("<FloatingListSearch");
    expect(tagInput).toContain('label="Search tags"');
    expect(tagInput).toContain("hints={FLOATING_LIST_HINTS.tagsPicker}");
    const list = source("FloatingList.tsx");
    const hints = list.slice(list.indexOf("  tagsPicker: ["), list.indexOf("]", list.indexOf("  tagsPicker: [")));
    expect([...hints.matchAll(/glyph: "([^"]+)", label: "([^"]+)"/g)].map((match) => `${match[1]} ${match[2]}`).join(" · "))
      .toBe("↵ add · ⌫ remove");
    // The block's list filters with the `@` list's resolver and lines up with the Description.
    expect(picker).toContain("activitiesForMention(query.trim(), categories)");
    expect(source("PersistentTimerBar.tsx")).toContain("anchorRef={suggestionsRef}");
    // The search field is the combobox; a closed list's field never reads as an open popup.
    expect(list).toContain('role="combobox"');
    expect(list).toContain("aria-expanded={expanded}");
    expect(list).toContain("aria-multiselectable={multiselectable || undefined}");
  });

  it("appears with opacity only, and at once under Reduce Motion", () => {
    expect(rule(".df-flist.ui-floating-surface,\n.df-flist.ui-floating-surface.is-open")).toMatch(/transform: none;/);
    expect(rule(".df-flist.ui-floating-surface")).toMatch(/transition: opacity 120ms ease-out, visibility 0s linear 120ms;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.df-flist\.ui-floating-surface,\n\s*\.df-flist\.ui-floating-surface\.is-open \{\s*transition: none;/);
  });

  it("is a full-width phone sheet with a 44 px Close and rows scrolling inside (AGENTS phone overlay rule)", () => {
    const sheet = rule(".df-flist.ui-floating-surface.is-sheet");
    expect(sheet).toMatch(/position: fixed;/);
    expect(sheet).toMatch(/max-width: calc\(100vw - 24px\);/);
    const close = rule(".df-flist.is-sheet .df-flist-close");
    expect(close).toMatch(/width: 44px;/);
    expect(close).toMatch(/height: 44px;/);
    expect(rule(".df-flist.is-sheet .df-flist-rows")).toMatch(/overflow-y: auto;/);
    const list = source("FloatingList.tsx");
    expect(list).toContain('FLOATING_LIST_PHONE_QUERY = "(max-width: 560px)"');
    // Height from the visual viewport, so the sheet stays above the on-screen keyboard.
    expect(list).toContain("window.visualViewport");
    expect(list).toContain("maxHeight:");
    for (const host of ["TaskSuggestionsPanel.tsx", "InlineTagInput.tsx"]) expect(source(host)).toContain("anchorRef={anchorRef}");
    // The timer's sticky shell rises above the phone tab bar while one of its sheets is open.
    expect(rule(".swiss-persistent-timer-shell:has(.df-flist.is-sheet.is-open)")).toMatch(/z-index: 45;/);
  });

  it("keeps the Tags and Activities lists inside the viewport with internal scrolling", () => {
    const lists = rule(".inline-tag-suggestions,\n.inline-activity-suggestions,\n.inline-tag-picker");
    expect(lists).toMatch(/max-height: min\(19rem, calc\(100dvh - 10rem\)\);/);
    // The rows scroll inside the bounded surface; the head and the footer hints stay in view.
    expect(lists).toMatch(/overflow: hidden;/);
    const rows = rule(".df-flist-rows");
    expect(rows).toMatch(/min-height: 0;/);
    expect(rows).toMatch(/overflow-y: auto;/);
    expect(css).toContain(".inline-activity-suggestions.is-portalled {");
  });
});
