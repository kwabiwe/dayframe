import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P6b (WUI-028, 029, 030, 031; owner 17 Oct 2026).
const root = join(process.cwd(), "src");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const styles = source("app/globals.css");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Every top-level block for the selector, so a later declaration counts too.
  return [...styles.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("\n");
}

/** A theme block's hex tokens (`:root,\n:root[data-theme="light"]` or `:root[data-theme="dark"]`). */
function themeTokens(header: string) {
  // Comments stripped, so a commented-out old value never reads as the token (Codex r3 on #495).
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, " ");
  const start = css.indexOf(`${header} {`);
  expect(start, header).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  // A later declaration of the same token wins, as in CSS.
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name, value]));
}

/** The value of the last `property` declared for `selector` at top level: the one that wins. */
function lastDeclaration(selector: string, property: string) {
  return lastDeclarationIn(rule(selector), property);
}

/** Declarations split one by one, so adjacent duplicates are each seen (Codex r1 on #497). */
function lastDeclarationIn(body: string, property: string) {
  const values = body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(";")
    .map((declaration) => declaration.match(/^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match) && match?.[1] === property)
    .map((match) => match[2]);
  return values.at(-1);
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const toSrgb = (channel: number) => {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
};
const rgb = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);

function luminance(color: number[]) {
  const [r, g, b] = color.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** CSS `color-mix(in oklab, a p, b)`. */
function mixOklab(a: number[], b: number[], p: number) {
  const toLab = (color: number[]) => {
    const [r, g, bl] = color.map(toLinear);
    const [l, m, s] = [
      0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl,
      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl,
      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl
    ].map(Math.cbrt);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  };
  const [x, y] = [toLab(a), toLab(b)];
  const [L, A, B] = x.map((value, index) => value * p + y[index] * (1 - p));
  const [l, m, s] = [L + 0.3963377774 * A + 0.2158037573 * B, L - 0.1055613458 * A - 0.0638541728 * B, L - 0.0894841775 * A - 1.291485548 * B].map((value) => value ** 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map(toSrgb);
}

describe("rows (WUI-028, WUI-029)", () => {
  it("draws List rows as Today's: transparent with hairlines, a 36 px X3 block, two lines, quiet actions", () => {
    const entries = source("components/EntriesTable.tsx");
    // Grouped rows and their expanded occurrences share the anatomy (Codex r1 on #495).
    expect(entries.match(/className="timeline-task-secondary-line"/g)).toHaveLength(2);
    // Secondary text passes 4.5:1 on Midnight and Daylight cards and their hover fill.
    const subline = "color-mix(in oklab, var(--text-secondary) 85%, var(--text-primary))";
    expect(lastDeclaration(".timeline-task-secondary-line", "color")).toBe(subline);
    expect(lastDeclaration(".df-erow-text span", "color")).toBe(subline);
    // The meta and tag spans set their own colour elsewhere; inside the line they inherit it.
    expect(lastDeclaration(".timeline-task-secondary-line .timeline-task-meta,\n.timeline-task-secondary-line .tag-metadata", "color")).toBe("inherit");
    expect(rule(".timeline-task-secondary-line .tag-metadata.is-compact")).toContain("font-size: 12px;");
    expect(rule(".timeline-task-block")).toMatch(/width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: calc\(36px \* 0\.3\);/);
    expect(rule(".df-erow-block")).toContain("border-radius: calc(36px * 0.3);");
    expect(rule(".timeline-list-row:hover > td,\n.timeline-list-row:has(:focus-visible) > td")).toContain("var(--surface-muted)");
    // Actions appear on hover or focus, and always on touch screens and narrow layouts.
    expect(rule(".timeline-list-actions")).toMatch(/opacity: 0;/);
    expect(styles).toMatch(/@media \(hover: none\), \(any-pointer: coarse\), \(max-width: 860px\) \{\s*\.timeline-list-actions \{\s*opacity: 1;/);
  });

  it("gives Places and Settings rows the 56 px management row", () => {
    expect(rule(".df-library .place-list-row")).toMatch(/min-height: 56px;/);
    expect(rule(".settings-group .ui-settings-row")).toMatch(/min-height: 56px;/);
  });
});

describe("states (WUI-030)", () => {
  it("shows page and panel errors on one banner with a 44 px Dismiss", () => {
    const banner = source("components/blocks/ErrorBanner.tsx");
    expect(banner).toContain('className="df-review-error"');
    expect(banner).toContain('className="df-icon-action" data-tip="Dismiss"');
    for (const path of [
      "components/AppShell.tsx",
      "components/EntriesTable.tsx",
      "components/PersistentTimerBar.tsx",
      "components/TagManager.tsx",
      "components/library/ActivitiesLibrary.tsx",
      "components/review/ReviewDeck.tsx",
      "components/today/TodayView.tsx"
    ]) {
      const text = source(path);
      expect(text, path).toContain("<ErrorBanner");
      expect(text, path).not.toContain("swiss-inline-error");
      expect(text, path).not.toMatch(/<p className="df-review-error"/);
    }
    // Places is a Places file, so its delete failure keeps its class and takes the banner look here.
    expect(rule(".swiss-inline-error")).toMatch(/border-radius: 14px;[\s\S]*background: color-mix\(in oklab, var\(--danger\) 12%, var\(--surface\)\);/);
  });

  it("keeps field errors beside their field in 12 px danger text", () => {
    expect(source("components/PersistentTimerBar.tsx")).toMatch(/<p className="ui-field-error" id="active-start-time-error" role="alert">/);
    expect(styles).toMatch(/\.ui-field-error \{\s*min-height: 17px;\s*font-size: 12px;/);
    expect(rule(".ui-field-error")).toContain("var(--danger-text)");
  });

  it("writes empty states as one muted 14 px sentence", () => {
    expect(rule(".df-muted")).toMatch(/color: var\(--text-secondary\);\s*font-size: 14px;/);
    expect(rule(".places-empty-state")).toMatch(/color: var\(--text-secondary\);[\s\S]*font-size: 14px;/);
    expect(styles).not.toMatch(/\.(inline-tag-empty|report-secondary-empty)\b/);
    expect(source("components/InlineTagInput.tsx")).not.toContain("inline-tag-empty");
  });
});

describe("Reports sections (WUI-031)", () => {
  it("draws Tags and More insights as collapsed Blocks cards with Today-style rows", () => {
    const overview = source("components/ReportsOverview.tsx");
    expect(overview).not.toContain("fill-group-surface");
    expect(overview).not.toContain("report-ranked");
    expect(overview).toContain('<details className="df-card df-report-more report-tags"');
    expect(overview).toContain('<details className="df-card df-report-more" aria-labelledby="report-more-title"');
    expect(overview).toContain('<li className="df-erow df-rank-row">');
    expect(overview).toContain('<section className="df-card report-trend"');
    expect(styles).not.toMatch(/\.(fill-group-surface|report-ranked-[\w-]+|report-secondary-[\w-]+|report-section-header)\b/);
  });
});

describe("row sub-line contrast (WCAG 1.4.3, Codex r2 on #495)", () => {
  it("reads the declaration that wins, adjacent duplicates included", () => {
    expect(lastDeclarationIn("color: red; color: var(--text-muted);", "color")).toBe("var(--text-muted)");
    expect(lastDeclarationIn("color: red; /* color: blue; */ background: x;", "color")).toBe("red");
    expect(lastDeclarationIn("background-color: red;", "color")).toBeUndefined();
  });

  it("keeps 12 px sub-lines over 4.5:1 on the card and the hover/focus fill in both themes", () => {
    for (const header of [':root,\n:root[data-theme="light"]', ':root[data-theme="dark"]']) {
      const tokens = themeTokens(header);
      const subline = mixOklab(rgb(tokens["--text-secondary"]), rgb(tokens["--text-primary"]), 0.85);
      for (const fill of ["--surface", "--surface-muted"]) {
        expect(contrast(subline, rgb(tokens[fill])), `${header} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
