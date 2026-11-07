import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P4 (WUI-017, 018, 019, 046; owner 17 Oct 2026): one field, one label system, one
// segmented control, 44 px text fields on touch screens.
const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const guide = readFileSync(join(process.cwd(), "../../docs/brand-style-guide.md"), "utf8");

/** Every block whose whole selector list is exactly `selector` (it starts a rule), joined. */
function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("\n");
}

describe("fields (web UI audit P4)", () => {
  it("keeps the legacy field fallback and reserves space for the Blocks keyboard ring", () => {
    expect(styles).toMatch(/--web-control-border-width: 1px;/);
    for (const selector of ["input,\nselect,\ntextarea", ".ui-control", ".ui-compound-control", ".place-search-control"]) {
      const body = rule(selector);
      expect(body, selector).not.toBe("");
      expect(body, selector).toMatch(/border: var\(--web-control-border-width\) solid var\(--control-border\);/);
    }
    // The activity-list search is a compound control with a single focus owner.
    expect(rule(".df-flist-search")).not.toMatch(/box-shadow/);
    expect(styles).not.toMatch(/\.df-pe \.(ui-control|place-search-control)[^{]*\{[^}]*border-color: transparent/);
    expect(styles).not.toMatch(/\.auth-card \.(ui-control|auth-password-field) \{[^}]*border-color: transparent/);
  });

  it("uses the shared height and keyboard ring for the resumed web controls", () => {
    const source = (path: string) => readFileSync(join(process.cwd(), "src/components", path), "utf8");
    expect(source("PersistentTimerBar.tsx")).toContain('className="ui-control df-start-time-input"');
    expect(source("library/ActivitiesLibrary.tsx")).toMatch(/<input\s+aria-invalid=\{problem \? true : undefined\}\s+className="ui-control"/);
    expect(source("TagManager.tsx").match(/<input(?: autoFocus)? className="ui-control"/g)).toHaveLength(2);

    for (const selector of [".df-palette-input input", ".df-start-date-trigger.timeline-period-trigger", ".category-picker-create-form input", ".category-picker-create-form .category-picker-create-actions button"]) {
      expect(rule(selector), selector).toContain("min-height: var(--web-control-height);");
    }
    for (const selector of [".df-start-time-input", ".df-ce-field input", ".df-tag-new-field input,\n.df-tag-rename input"]) {
      expect(rule(selector), selector).not.toMatch(/min-height|border:|box-shadow:/);
    }

    expect(rule(".df-palette-input")).not.toMatch(/border:|box-shadow:/);
    expect(rule(".df-palette-input:focus-within")).toBe("");
    expect(rule(".df-palette-input:has(> input[data-kb-focus])")).toContain("inset 0 0 0 2px var(--web-focus-border)");
    expect(rule(".df-start-date-trigger.timeline-period-trigger")).not.toContain("box-shadow");
    expect(rule(".df-start-date-trigger.timeline-period-trigger:focus-visible")).toContain("inset 0 0 0 2px var(--web-focus-border)");
    expect(rule(".category-picker-create-name-control:focus-within")).toBe("");
    expect(rule(".category-picker-create-name-control:has(> input[data-kb-focus])")).toContain("inset 0 0 0 2px var(--web-focus-border)");
    const createError = rule('.category-picker-create-name-control:has(> input[aria-invalid="true"])::after');
    expect(createError).toContain("inset-block-end: 4px;");
    expect(createError).toContain("border-block-end: 2px solid var(--danger);");
  });

  it("keeps field boundaries, keyboard focus, and invalid cues in forced colours", () => {
    const forced = styles.match(/@media \(forced-colors: active\) \{\s*:root :is\(\.df-start-date-trigger,[\s\S]*?\n\}/)?.[0] ?? "";
    expect(forced).toContain("border: 1px solid CanvasText;");
    expect(forced).toContain("outline: 2px solid Highlight;");
    expect(forced).toContain("outline-offset: 1px;");
    expect(forced.match(/border-block-end: 2px dashed CanvasText;/g)).toHaveLength(2);
    for (const selector of [".df-start-time-input", ".df-ce-field input", ".df-tag-new-field input", ".df-tag-rename input", ".df-palette-input", ".category-picker-create-name-control", ".df-start-date-trigger:focus-visible"]) {
      expect(forced, selector).toContain(selector);
    }
  });

  it("uses one 10 px field radius at every width", () => {
    expect(styles).toMatch(/--web-radius-control: 10px;/);
    expect(styles).not.toMatch(/--web-radius-control: (12|16)px;/);
  });

  it("rings the palette search and List inline edits on focus instead of an underline or nothing", () => {
    expect(rule(".df-palette-input")).toMatch(/background: var\(--surface-inset\);/);
    expect(rule(".df-palette-input")).not.toMatch(/inset 0 -1px/);
    // Inputs whose wrapper owns the ring never draw their own (Codex r2 on #472).
    expect(styles).toMatch(/:is\(\s*\.ui-compound-control > input,[\s\S]*?\):focus \{\s*box-shadow: none;/);
    expect(styles).toMatch(/:is\([^)]*\.category-picker-create-name-control > input,[\s\S]*?\):focus \{\s*box-shadow: none;/);
    expect(styles).toMatch(/\[data-focus-ring="keyboard"\] \.inline-tag-input-anchor:has\(\.inline-tag-description-input:focus\):has\(input\[aria-invalid="true"\]\) \{\s*box-shadow: inset 0 0 0 1px var\(--focus\), inset 0 -2px 0 var\(--danger\);/);
    // The timer's Description draws nothing on pointer focus (Trello 213).
    expect(rule(".swiss-timer-description-control .ui-compound-control:focus-within")).toMatch(/box-shadow: none;/);
    expect(rule(".timeline-inline-time:has(.timeline-inline-time-input:focus-visible)")).toMatch(/inset 0 0 0 2px var\(--web-focus-border\)/);
    expect(rule(".timeline-inline-description.is-editing:has(.timeline-inline-description-input:focus)")).toMatch(/inset 0 0 0 2px var\(--web-focus-border\)/);
  });

  it("has one segmented control look (WUI-019)", () => {
    for (const selector of [".ui-segmented-control", ".date-sheet-segments", ".df-pe-seg", ".df-seg"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(/background: var\(--surface\);/);
      expect(body, selector).toMatch(/box-shadow: inset 0 0 0 1px var\(--border\);/);
    }
    for (const selector of [
      '.ui-segmented-control button[aria-pressed="true"]',
      '.date-sheet-segments button[aria-pressed="true"]',
      '.df-seg a[aria-current="page"]'
    ]) {
      expect(rule(selector), selector).toMatch(/background: var\(--surface-muted\);/);
    }
    // Never an inverted or coral chosen segment, and no host overrides.
    expect(styles).not.toMatch(/(segmented-control|date-sheet-segments) button\[aria-pressed="true"\] \{[^}]*background: var\(--(foreground|accent)\)/);
    expect(styles).not.toMatch(/\.(settings-appearance-row|timeline-range-controls|df-set-card)[^{]*\.ui-segmented-control button\[aria-pressed="true"\]/);
  });

  it("makes segments and text fields 44 px on touch screens, last in the cascade (WUI-019, WUI-046)", () => {
    const coarse = styles.match(/@media \(any-pointer: coarse\) \{\s*\.df-seg a,[\s\S]*?\n\}/)?.[0] ?? "";
    // After every base size it overrides (Codex r1 on #472: `.df-pe-seg span` came later and won).
    expect(styles.lastIndexOf(coarse)).toBeGreaterThan(styles.lastIndexOf(".df-pe-seg span {"));
    expect(styles.trimEnd().endsWith(coarse.trimEnd())).toBe(true);
    for (const selector of [".ui-segmented-control button", ".df-pe-seg span", ".df-flist-search input"]) {
      expect(coarse, selector).toContain(selector);
    }
    expect(coarse).toMatch(/min-height: 44px;/);
  });

  it("states one label rule in the brand guide (WUI-018)", () => {
    expect(guide).not.toMatch(/never an all-caps eyebrow/);
    expect(guide).toMatch(/\| Section and floating-list head \| 11 px uppercase/);
    expect(guide).toMatch(/\| Field label \| 12 px \| 500/);
  });
});
