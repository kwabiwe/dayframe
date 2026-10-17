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
  it("draws every field with an inset fill and no idle outline (WUI-017)", () => {
    for (const selector of ["input,\nselect,\ntextarea", ".ui-control", ".ui-compound-control", ".df-ce-field input"]) {
      const body = rule(selector);
      expect(body, selector).not.toBe("");
      expect(body, selector).toMatch(/border: var\(--web-control-border-width\) solid transparent;/);
    }
    expect(rule(".df-ce-field input")).toMatch(/background: var\(--surface-inset\);/);
    expect(styles).not.toMatch(/\.df-ce-field input \{[^}]*1px solid/);
  });

  it("uses one 10 px field radius at every width", () => {
    expect(styles).toMatch(/--web-radius-control: 10px;/);
    expect(styles).not.toMatch(/--web-radius-control: (12|16)px;/);
  });

  it("rings the palette search and List inline edits on focus instead of an underline or nothing", () => {
    expect(rule(".df-palette-input")).toMatch(/background: var\(--surface-inset\);/);
    expect(rule(".df-palette-input")).not.toMatch(/inset 0 -1px/);
    expect(rule(".df-palette-input:focus-within")).toMatch(/box-shadow: inset 0 0 0 2px var\(--web-focus-border\);/);
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

  it("makes segments and text fields 44 px on touch screens (WUI-019, WUI-046)", () => {
    const coarse = styles.match(/@media \(any-pointer: coarse\) \{\s*\.df-seg a,[\s\S]*?\n\}/)?.[0] ?? "";
    for (const selector of [".ui-segmented-control button", ".df-pe-seg span", ".df-flist-search input", ".df-logas input"]) {
      expect(coarse, selector).toContain(selector);
    }
    expect(coarse).toMatch(/min-height: 44px;/);
  });

  it("states one label rule in the brand guide (WUI-018)", () => {
    expect(guide).not.toMatch(/never an all-caps eyebrow/);
    expect(guide).toMatch(/\| Section and floating-list head \| 11 px uppercase/);
    expect(guide).toMatch(/\| Field label \| 12 px \| 650/);
  });
});
