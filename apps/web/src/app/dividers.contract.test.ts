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
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(readFileSync(join(root, "src/app/globals.css"), "utf8"));

const GEOMETRY = "inset-inline: var(--divider-inset-start, var(--divider-inset)) var(--divider-inset);";

type Rule = { selector: string; body: string };

/** Innermost rules (media queries included), selectors normalised to single spaces. */
function rules(source = css): Rule[] {
  const found: Rule[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
    expect(first).toMatch(/--divider-inset-start: 52px;/);
    expect(first).toMatch(/background-position: var\(--divider-inset-start\) 0;/);
    expect(last).toMatch(/--divider-inset: 10px;/);
    expect(last).toMatch(/background-size: calc\(100% - var\(--divider-inset\)\) 1px;/);
  });

  it("keeps the Calendar List's gaps at the row's outer edges in both directions", () => {
    // `:dir()` is rewritten by the CSS build into a `:lang()` list that ignores the dir attribute.
    expect(css).not.toMatch(/:dir\(/);
    // Resolve each cell's background line (position and size) for a 100 px cell, in physical pixels.
    const resolve = (value: string, vars: Record<string, number>, width: number) => {
      const withVars = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => `${vars[name]}px`);
      const calc = withVars.match(/^calc\(100% - (\d+)px\)$/);
      if (calc) return width - Number(calc[1]);
      if (withVars === "100%") return width;
      return Number(withVars.replace(/px$/, ""));
    };
    const declaration = (body: string, property: string) => body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim();
    const cellLine = (cell: "first" | "middle" | "last", rtl: boolean) => {
      const base = ruleBody(".timeline-list-row + .timeline-list-row > td");
      const own = cell === "middle" ? "" : ruleBody(`.timeline-list-row + .timeline-list-row > td:${cell}-child`);
      const flipped = rtl && cell !== "middle" ? ruleBody(`[dir="rtl"] .timeline-list-row + .timeline-list-row > td:${cell}-child`) : "";
      const vars: Record<string, number> = {};
      for (const match of own.matchAll(/(--divider-inset(?:-start)?):\s*(\d+)px;/g)) vars[match[1]] = Number(match[2]);
      const pick = (property: string) => declaration(flipped, property) ?? declaration(own, property) ?? declaration(base, property)!;
      const position = pick("background-position").replace(/^top left$/, "0 0").split(/\s+/)[0];
      const size = pick("background-size").replace(/\s+1px$/, "");
      const start = resolve(position, vars, 100);
      return [start, start + resolve(size, vars, 100)];
    };
    for (const rtl of [false, true]) {
      // Physical order, left to right.
      const cells = (rtl ? ["last", "middle", "first"] : ["first", "middle", "last"]) as Array<"first" | "middle" | "last">;
      const spans = cells.map((cell, index) => cellLine(cell, rtl).map((x) => x + index * 100));
      const label = rtl ? "rtl" : "ltr";
      expect(spans[0][0], `${label}: gap at the row's left edge`).toBeGreaterThan(0);
      expect(spans[2][1], `${label}: gap at the row's right edge`).toBeLessThan(300);
      // Inside the row the line is continuous: every inner cell edge is reached.
      expect(spans[0][1], label).toBe(100);
      expect(spans[1], label).toEqual([100, 200]);
      expect(spans[2][0], label).toBe(200);
      // The leading gap is past the 28 px block (52 px), the trailing one 10 px.
      expect(rtl ? 300 - spans[2][1] : spans[0][0], label).toBe(52);
      expect(rtl ? spans[0][0] : 300 - spans[2][1], label).toBe(10);
    }
  });

  it("insets the List's sideways scroll viewport, so its clip edge never touches the panel", () => {
    // The table is at least 760 px wide beside the Places column, so the row lines run into the scroller's
    // clip edge, which must therefore sit inside the panel on both sides. On phones it fits the screen
    // (UI review W1, owner 29 Oct 2026).
    const tableRules = rules().filter((rule) => rule.selector === ".timeline-list-table").map((rule) => rule.body);
    expect(tableRules.some((body) => /min-width: 760px;/.test(body))).toBe(true);
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\.timeline-list-table \{\s*min-width: 0;/);
    const scroller = rules().filter((rule) => rule.selector === ".timeline-list-scroll").map((rule) => rule.body).join("");
    const inset = Number(scroller.match(/--timeline-list-clip-inset:\s*(\d+)px;/)?.[1]);
    expect(inset).toBeGreaterThanOrEqual(10);
    expect(scroller).toMatch(/margin-inline: var\(--timeline-list-clip-inset\);/);
    // No later rule (a media query included) takes the inset away.
    for (const body of rules().filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(".timeline-list-scroll")).map((rule) => rule.body)) {
      expect(body).not.toMatch(/(?:^|[;\s])margin(?:-inline)?(?:-(?:start|end))?\s*:\s*0/);
      expect(body).not.toMatch(/--timeline-list-clip-inset:\s*0/);
    }
    // At rest nothing moves: the table and the sticky "N to check" bar give the inset back.
    expect(tableRules.join(""))
      .toMatch(/padding: 0 calc\(12px - var\(--timeline-list-clip-inset\)\) 12px;/);
    // The chip sits at the heading's right end, clear of the day's total (UI review W10, owner 29 Oct 2026).
    expect(ruleBody(".timeline-checks-bar.is-sticky")).toMatch(/padding: 0 calc\(76px - var\(--timeline-list-clip-inset\)\) 0 0;/);
  });

  it("insets dialog header and action lines by the dialog's own padding", () => {
    for (const selector of [".ui-dialog-header::after", ".ui-dialog-actions::before"]) {
      expect(ruleBody(selector), selector).toContain("--divider-inset: var(--web-dialog-padding-inline);");
      expect(ruleBody(selector), selector).toContain(GEOMETRY);
    }
  });
});

function sourceFiles(dir: string, pattern = /\.tsx$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, pattern);
    return pattern.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Files allowed to keep a Tailwind divider, with the reason. */
const MARKUP_EXEMPT: Record<string, string> = {
  "components/TimeReviewViews.tsx": "the Calendar time axis's hour lines are grid structure",
  "components/MetricStrip.tsx": "not rendered anywhere",
  "components/TimeAllocationPie.tsx": "not rendered anywhere"
};

/** The body of the stylesheet's `@media (forced-colors: active)` block(s). */
function forcedColorsCss() {
  let out = "";
  for (const match of css.matchAll(/@media \(forced-colors: active\) \{/g)) {
    let depth = 1;
    let index = match.index! + match[0].length;
    const start = index;
    while (depth && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    out += css.slice(start, index - 1);
  }
  return out;
}

describe("dividers in forced colours", () => {
  it("draws every shared hairline as a system-coloured border, since forced colours repaint backgrounds", () => {
    const forced = rules(forcedColorsCss());
    const hairline = forced.find((rule) => /border-top: 1px solid CanvasText;/.test(rule.body) && /height: 0;/.test(rule.body));
    expect(hairline, "the forced-colours hairline rule").toBeTruthy();
    const covered = new Set(hairline!.selector.split(",").map((part) => part.trim()));
    const shared = rules()
      .filter((rule) => rule.body.includes(GEOMETRY))
      .flatMap((rule) => rule.selector.split(",").map((part) => part.trim()));
    expect(shared.length).toBeGreaterThan(10);
    expect(shared.filter((selector) => !covered.has(selector))).toEqual([]);
  });

  it("redraws the Calendar List's background line as a logical cell border (gradients drop in forced colours)", () => {
    const forced = rules(forcedColorsCss());
    const body = (selector: string) => forced.find((rule) => rule.selector === selector)?.body ?? "";
    expect(body(".timeline-list-row + .timeline-list-row > td::before")).toMatch(/border-top: 1px solid CanvasText;/);
    expect(body(".timeline-list-row + .timeline-list-row > td::before")).toMatch(/inset-inline: 0;/);
    expect(body(".timeline-list-row + .timeline-list-row > td:first-child::before")).toMatch(/inset-inline-start: 52px;/);
    expect(body(".timeline-list-row + .timeline-list-row > td:last-child::before")).toMatch(/inset-inline-end: 10px;/);
  });
});

describe("component stylesheets", () => {
  it("draw no full-width hairline outside the shared mechanism", () => {
    const sheets = sourceFiles(join(root, "src"), /\.css$/).filter((path) => !path.endsWith("globals.css"));
    for (const path of sheets) {
      const offenders = rules(stripComments(readFileSync(path, "utf8")))
        .filter(drawsLine)
        .filter(({ body }) => !body.includes(GEOMETRY))
        .map(({ selector }) => selector);
      expect(offenders, path).toEqual([]);
    }
  });
});

describe("markup dividers", () => {
  it("uses `.df-divider-top` rather than a full-width Tailwind border between blocks", () => {
    const src = join(root, "src");
    const offenders: string[] = [];
    for (const path of sourceFiles(src)) {
      const relative = path.slice(src.length + 1);
      const text = readFileSync(path, "utf8");
      // Tailwind top/bottom borders and dividers in any width (border-t, border-b-2, border-y, divide-y-[2px], …),
      // logical block borders, and inline style borders.
      const lines = text.split("\n").filter((line) =>
        /(?:^|["'`\s:])(?:border-(?:[tby]|block(?:-start|-end|-[se])?)|divide-y)(?:-(?!0\b)[\w[\]().%-]+)?(?=["'`\s])/.test(line)
        || /\bborder(?:Top|Bottom|Block(?:Start|End)?)(?:Width|Style|Color)?\s*:/.test(line)
        || /(?:^|["'`;\s])border-(?:top|bottom|block(?:-start|-end)?)\s*:/.test(line));
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
    expect(hitArea?.body).toMatch(/height: max\(100%, 44px\);/);
    // A long "Log …" answer can wrap "Not now" onto a new row: the rows must sit far enough apart that
    // the 44 px hit areas never overlap (jsdom has no layout to hit-test, so this is checked in CSS).
    const pillHeight = Number(sizing!.body.match(/min-height:\s*(\d+)px/)![1]);
    for (const container of [".timeline-check-answers", ".location-correction-question-answers"]) {
      const gap = ruleBody(container).match(/(?:^|[;\s])gap:\s*(\d+)px(?:\s+(\d+)px)?;/);
      expect(gap, container).toBeTruthy();
      expect(Number(gap![1]), `${container} row gap`).toBeGreaterThanOrEqual(44 - pillHeight);
      expect(Number(gap![2] ?? gap![1]), `${container} column gap`).toBe(8);
    }
  });
});

describe("Settings › Log trips automatically (UI review W15; Codex r1 on #631)", () => {
  it("reads as a row of its card at every width: its siblings' text start and divider insets", () => {
    expect(css).toMatch(/\.settings-group \.df-set-trips \{[^}]*background: transparent;[^}]*padding: 8px 18px 8px 48px;/);
    expect(css).toMatch(/\.settings-group \.df-set-trips::before \{[^}]*--divider-inset: 18px;[^}]*--divider-inset-start: 52px;/);
    const phone = css.slice(css.indexOf(".settings-group .ui-settings-row:not(.has-icon) + .ui-settings-row:not(.has-icon)::before {\n    --divider-inset: 16px;"));
    expect(phone).toMatch(/\.settings-group \.df-set-trips \{\s*padding: 14px 16px 14px 46px;/);
    expect(phone).toMatch(/\.settings-group \.df-set-trips::before \{\s*--divider-inset: 16px;\s*--divider-inset-start: 16px;/);
  });
});
