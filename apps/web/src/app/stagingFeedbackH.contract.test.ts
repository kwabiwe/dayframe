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
    expect(rule(".swiss-persistent-timer-shell")).toContain("padding: var(--df-cmd-inset-top) var(--df-cmd-inset-x) 0;");
    // Calendar: the shell adds only the top inset, the frame only the side inset.
    expect(rule(".swiss-timeline-surface .swiss-persistent-timer-shell")).toContain("padding: var(--df-cmd-inset-top) 0 0;");
    const frame = [...css.matchAll(/\n\.swiss-main-frame\.is-timeline \{([^}]*)\}/g)].at(-1)?.[1] ?? "";
    expect(frame).toContain("padding-top: 0;");
    expect(frame).toContain("padding-inline: var(--df-cmd-inset-x);");
    // That last frame rule must come after every responsive frame padding so it wins at all widths.
    const lastFrame = css.lastIndexOf("\n.swiss-main-frame.is-timeline {");
    const lastResponsiveFrame = css.lastIndexOf("\n  .swiss-main-frame.is-timeline {");
    expect(lastFrame).toBeGreaterThan(lastResponsiveFrame);
    // No page-specific padding around the bar itself, and no fixed shell paddings left behind.
    expect(css).not.toContain(".swiss-timeline-surface .df-cmd-wrap {");
    for (const match of css.matchAll(/\.swiss-persistent-timer-shell \{([^}]*)\}/g)) {
      expect(match[1]).not.toMatch(/padding:\s*\d/);
    }
  });
});

describe("command timer Description (H3, Trello 213)", () => {
  it("never draws a grey box around the Description, idle or running", () => {
    expect(rule(".swiss-timer-description-control .ui-compound-control:focus-within")).toContain("border-color: transparent;");
    expect(rule(".df-cmd-field .inline-tag-input-anchor")).toContain("border-color: transparent;");
    expect(css).not.toMatch(/\.df-cmd\.is-live[^{]*\.(?:inline-tag-input-anchor|ui-compound-control)[^{]*\{/);
  });

  it("keeps the live ring and moves keyboard focus to a neutral ring around the whole bar", () => {
    expect(rule(".df-cmd.is-live")).toMatch(/inset 0 0 0 2px color-mix\(in oklab, var\(--block/);
    expect(rule(".df-cmd:has(.df-cmd-field .inline-tag-description-input:focus-visible)")).toMatch(
      /outline: 2px solid var\(--focus\);[\s\S]*outline-offset: 2px;/
    );
  });
});

describe("flat Calendar blocks (H4, Trello 213)", () => {
  it("draws no inner highlight, shade or edge on solid Calendar blocks", () => {
    const block = rule(".calendar-time-block.df-block");
    expect(block).toContain("box-shadow: none;");
    expect(block).not.toMatch(/inset/);
    for (const match of css.matchAll(/\n\.calendar-time-block\.df-block(?::[\w-]+(?:\([^)]*\))?)*(?:\.is-selected)? \{([^}]*)\}/g)) {
      expect(match[1]).not.toMatch(/box-shadow:[^;]*inset/);
    }
  });

  it("keeps the running block's breathing ring", () => {
    expect(rule(".calendar-time-block.df-block.is-running::after")).toMatch(/inset 0 0 0 2px[\s\S]*animation: df-live-breathe/);
  });
});
