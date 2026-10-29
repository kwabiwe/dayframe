import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner rules, 28 Oct 2026: (1) a divider line never touches its container's edges; it is inset on
// both sides, app-wide (lists, sheets, dialogs, menus, popovers, the profile panel). (2) The Calendar
// row's compact "Yes" pill is the size for inline question and sheet answer pills.
//
// Every horizontal hairline in the stylesheet is either drawn with the shared inset mechanism
// (`--divider-inset`, see the comment at the top of globals.css) or listed below with the reason it
// may span its box. A new full-width row divider fails here until it uses the mechanism.

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const GEOMETRY = "inset-inline: var(--divider-inset-start, var(--divider-inset)) var(--divider-inset);";

type Rule = { selector: string; body: string };

/** Innermost rules (media queries included), selectors normalised to single spaces. */
function rules(): Rule[] {
  const found: Rule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) continue;
    found.push({ selector, body: match[2] });
  }
  return found;
}

function ruleBody(selector: string) {
  return rules().find((rule) => rule.selector === selector)?.body ?? "";
}

const LINE = String.raw`var\(--(?:line|border)(?:-strong)?\)`;
const DRAWS_LINE = [
  // A 1 px top or bottom border.
  new RegExp(String.raw`(?:^|[;\s])border-(?:top|bottom|block(?:-start|-end)?)\s*:\s*1px\s+solid\s+${LINE}`),
  // A box-shadow hairline.
  new RegExp(String.raw`box-shadow\s*:[^;]*\b0 -?1px 0 ${LINE}`),
  // A background-image line.
  new RegExp(String.raw`background-image\s*:\s*linear-gradient\(${LINE}`)
];

function drawsLine({ selector, body }: Rule) {
  if (DRAWS_LINE.some((pattern) => pattern.test(body))) return true;
  // A 1 px pseudo-element filled with the line colour.
  return /::(?:before|after)/.test(selector) && /(?:^|[;\s])height:\s*1px/.test(body)
    && new RegExp(String.raw`background:\s*${LINE}`).test(body);
}

/** Full-width lines that are not row dividers, or rows already inset by their container's padding. */
const EXEMPT: Record<string, string> = {
  ".df-shortcuts kbd": "a keycap's lower edge",
  ".landing-hero": "signed-out landing page: a section rule in the centred page column, not in a surface",
  ".landing-footer": "signed-out landing page: the footer rule in the centred page column",
  ".swiss-persistent-timer-shell::after": "the sticky timer band's scroll edge (owner design C1): a frame",
  ".calendar-grid-corner, .calendar-day-heading": "calendar grid lines are structure, not row dividers",
  ".timeline-list-table th": "the table header underline; the header row is visually hidden in Blocks",
  ".timeline-list-day-heading > td": "legacy day heading; `.timeline-list-table .timeline-list-day-heading > td` removes it",
  ".report-data-table": "inside the Reports card, whose padding insets the line",
  ".report-data-table th, .report-data-table td": "a data table inside the Reports card's padding",
  ".report-pagination": "inside the Reports card, whose padding insets the line",
  ".df-srow + .df-srow": "`.df-simple-list` pads its rows 14 px from the card on both sides",
  ".df-shortcuts > div": "inside the Keyboard shortcuts dialog's content padding",
  ".df-getting-around-rows li": "inside the Reports card's padding",
  ".df-rf-more": "inside the Filter dialog's content padding",
  ".timeline-list-row + .timeline-list-row > td": "the List's line; its first and last cells inset it (checked below)"
};

describe("row dividers are inset on both sides", () => {
  it("registers the inset values as non-inheriting, so a list's inset never reaches a menu or dialog inside it", () => {
    expect(css).toMatch(/@property --divider-inset \{[^}]*syntax: "<length>";[^}]*inherits: false;[^}]*initial-value: 16px;/);
    expect(css).toMatch(/@property --divider-inset-start \{[^}]*inherits: false;/);
  });

  it("draws every hairline with the shared inset, unless it is a listed frame", () => {
    const offenders = rules()
      .filter(drawsLine)
      .filter(({ selector, body }) => !(selector in EXEMPT) && !body.includes(GEOMETRY))
      .map(({ selector }) => selector);
    expect(offenders).toEqual([]);
  });

  it("keeps the exemption list honest: each listed rule still exists and still draws a line", () => {
    const drawing = new Set(rules().filter(drawsLine).map(({ selector }) => selector));
    for (const selector of Object.keys(EXEMPT)) expect(drawing.has(selector), selector).toBe(true);
  });

  it("never sets an inset to zero or places a shared hairline with left/right", () => {
    expect(css).not.toMatch(/--divider-inset(?:-start)?:\s*0(?:px)?\s*;/);
    for (const { selector, body } of rules().filter((rule) => rule.body.includes(GEOMETRY))) {
      expect(body, selector).not.toMatch(/(?:^|[;\s])(?:left|right|inset)\s*:/);
    }
  });

  it("insets the Calendar List's line past the block and before the row's end, as Today's rows", () => {
    const first = ruleBody(".timeline-list-row + .timeline-list-row > td:first-child");
    const last = ruleBody(".timeline-list-row + .timeline-list-row > td:last-child");
    expect(first).toMatch(/--divider-inset-start: 60px;/);
    expect(first).toMatch(/background-position: var\(--divider-inset-start\) 0;/);
    expect(last).toMatch(/--divider-inset: 10px;/);
    expect(last).toMatch(/background-size: calc\(100% - var\(--divider-inset\)\) 1px;/);
  });

  it("insets dialog header and action lines by the dialog's own padding", () => {
    for (const selector of [".ui-dialog-header::after", ".ui-dialog-actions::before"]) {
      expect(ruleBody(selector), selector).toContain("--divider-inset: var(--web-dialog-padding-inline);");
      expect(ruleBody(selector), selector).toContain(GEOMETRY);
    }
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Files allowed to keep a Tailwind divider, with the reason. */
const MARKUP_EXEMPT: Record<string, string> = {
  "components/TimeReviewViews.tsx": "the Calendar time axis's hour lines are grid structure",
  "components/location/LocationReviewPanel.tsx": "trip stops inside a p-4 section, which insets the lines",
  "components/MetricStrip.tsx": "not rendered anywhere",
  "components/TimeAllocationPie.tsx": "not rendered anywhere"
};

describe("markup dividers", () => {
  it("uses `.df-divider-top` rather than a full-width Tailwind border between blocks", () => {
    const src = join(root, "src");
    const offenders: string[] = [];
    for (const path of sourceFiles(src)) {
      const relative = path.slice(src.length + 1);
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n").filter((line) => /(?:^|["'`\s])(?:border-[tb]|divide-y)(?=["'`\s])/.test(line));
      if (relative === "components/TimeReviewViews.tsx") {
        // Only the axis marks may keep one.
        if (lines.some((line) => !line.includes("absolute left-0 right-0 border-t"))) offenders.push(relative);
        continue;
      }
      if (lines.length && !(relative in MARKUP_EXEMPT)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});

describe("compact answer pills", () => {
  it("sizes inline question and sheet answers as the Calendar row's Yes pill", () => {
    const sizing = rules().find((rule) => rule.selector.startsWith(".timeline-row-yes,") && /min-height:\s*32px/.test(rule.body));
    expect(sizing?.selector).toContain(".timeline-check-answers > .ui-button");
    expect(sizing?.selector).toContain(".location-correction-question-answers > .ui-button");
    const hitArea = rules().find((rule) => rule.selector.startsWith(".timeline-row-yes::before,"));
    expect(hitArea?.selector).toContain(".timeline-check-answers > .ui-button::before");
    expect(hitArea?.selector).toContain(".location-correction-question-answers > .ui-button::before");
    expect(hitArea?.body).toMatch(/width: max\(100%, 44px\);/);
  });
});
