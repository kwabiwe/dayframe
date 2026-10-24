import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Staging feedback H1–H4 (owner, 12 October 2026; H3/H4 are Trello 213).
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("Library › Places dividers (H1)", () => {
  it("insets the row and header rules from both card edges instead of drawing full-width borders", () => {
    expect(rule(".df-library .place-list-row + .place-list-row")).toContain("border-top: 0;");
    expect(rule(".df-library .places-list-section > header")).toContain("border-bottom: 0;");
    const divider = rule(".df-library .places-list-section > header::after,\n.df-library .place-list-row + .place-list-row::before");
    expect(divider).toContain("right: 18px;");
    expect(divider).toContain("left: 18px;");
    expect(divider).toContain("height: 1px;");
    expect(divider).toContain("background: var(--border);");
    expect(rule(".df-library .place-list-row")).toContain("position: relative;");
  });
});

describe("command timer placement (H2)", () => {
  it("draws no rule under the quick starts", () => {
    expect(rule(".swiss-persistent-timer-shell")).not.toMatch(/border(?:-bottom)?\s*:\s*1px/);
  });

  it("places the bar from one shell-owned inset on every page, Calendar included", () => {
    expect(rule(".swiss-app-shell")).toMatch(/--df-cmd-inset-top: 12px;[\s\S]*--df-cmd-inset-x: 24px;/);
    expect(css).toMatch(/@media \(max-width: 860px\) \{\s*\.swiss-app-shell \{\s*--df-cmd-inset-x: 12px;/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.swiss-app-shell \{\s*--df-cmd-inset-top: 10px;/);
    expect(rule(".swiss-persistent-timer-shell")).toContain("padding: var(--df-cmd-inset-top) var(--df-cmd-inset-x) 8px;");
    // Calendar: the shell adds only the top inset, the frame only the side inset.
    expect(rule(".swiss-timeline-surface .swiss-persistent-timer-shell")).toContain("padding: var(--df-cmd-inset-top) 0 0;");
    const frame = [...css.matchAll(/\n\.swiss-main-frame\.is-timeline \{([^}]*)\}/g)].at(-1)?.[1] ?? "";
    expect(frame).toContain("padding-top: 0;");
    expect(frame).toContain("padding-inline: var(--df-cmd-inset-x);");
    // That last frame rule must come after every responsive frame padding so it wins at all widths
    // (a responsive frame rule that sets no padding, such as the phone Calendar's overflow, may follow).
    const lastFrame = css.lastIndexOf("\n.swiss-main-frame.is-timeline {");
    const responsivePaddings = [...css.matchAll(/\n {2}\.swiss-main-frame\.is-timeline \{([^}]*)\}/g)]
      .filter((match) => /padding/.test(match[1]))
      .map((match) => match.index ?? -1);
    expect(lastFrame).toBeGreaterThan(Math.max(...responsivePaddings));
    // No page-specific padding around the bar itself, and no fixed shell paddings left behind.
    expect(css).not.toContain(".swiss-timeline-surface .df-cmd-wrap {");
    for (const match of css.matchAll(/\.swiss-persistent-timer-shell \{([^}]*)\}/g)) {
      expect(match[1]).not.toMatch(/padding:\s*\d/);
    }
  });
});

describe("command timer Description (H3, Trello 213)", () => {
  it("draws no grey box at rest or after pointer focus, idle or running", () => {
    expect(rule(".swiss-timer-description-control .ui-compound-control:focus-within")).toContain("border-color: transparent;");
    expect(rule(".df-cmd-field .inline-tag-input-anchor")).toContain("border-color: transparent;");
    expect(css).not.toMatch(/\.df-cmd\.is-live[^{]*\.(?:inline-tag-input-anchor|ui-compound-control)[^{]*\{/);
    // The earlier whole-bar ring (Codex r1: :focus-visible also matches clicks on text inputs) is gone.
    expect(css).not.toContain(".df-cmd:has(");
  });

  it("shows the shared neutral perimeter on the compound wrapper for keyboard-origin focus only", () => {
    // Only while the Description input itself has keyboard-origin focus; the nested tag picker's
    // search keeps the ordinary field border (Codex r2).
    const keyboard = rule(
      ".swiss-timer-description-control .inline-tag-picker-search:focus-within,\n" +
        '.swiss-timer-description-control[data-focus-ring="keyboard"] .inline-tag-input-anchor:has(.inline-tag-description-input:focus)'
    );
    expect(keyboard).toContain("border-color: var(--focus);");
    // It must follow the transparent and invalid rules it overrides.
    expect(css.indexOf('[data-focus-ring="keyboard"] .inline-tag-input-anchor:has(')).toBeGreaterThan(
      css.indexOf('.swiss-timer-description-control .ui-compound-control:has(input[aria-invalid="true"]):focus-within {')
    );
    expect(rule('.swiss-timer-description-control .ui-compound-control:has(input[aria-invalid="true"]):focus-within')).toContain(
      "box-shadow: inset 0 -2px 0 var(--danger);"
    );
  });

  it("keeps the live ring on the bar", () => {
    expect(rule(".df-cmd.is-live")).toMatch(/inset 0 0 0 2px color-mix\(in oklab, var\(--block/);
  });
});

describe("flat Calendar blocks (H4, Trello 213; Calendar v3, 24 Oct 2026)", () => {
  it("draws a translucent tint and a colour bar with no outline, inner highlight or shade", () => {
    const block = css.match(/\/\* Calendar v3 \(owner, 24 Oct 2026; calendar-v3-mockup\)[^*]*\*\/\s*\.calendar-time-block \{([^}]*)\}/)?.[1] ?? "";
    expect(block).toContain("--calendar-block-fill: color-mix(in srgb, var(--calendar-block-accent) var(--calendar-dense-tint), transparent);");
    expect(block).toContain("box-shadow: none;");
    expect(block).toContain("border: 0;");
    expect(block).toContain("background-color: var(--calendar-block-fill);");
    for (const match of css.matchAll(/\n\.calendar-time-block(?::[\w-]+(?:\([^)]*\))?)*(?:\.is-selected)? \{([^}]*)\}/g)) {
      expect(match[1]).not.toMatch(/box-shadow:[^;]*inset/);
    }
  });

  it("keeps the running block's breathing ring", () => {
    expect(rule(".calendar-time-block.is-running::after")).toMatch(/inset 0 0 0 2px[\s\S]*animation: df-live-breathe/);
  });
});
