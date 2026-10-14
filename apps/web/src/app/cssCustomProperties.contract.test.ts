import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A `var(--name)` with no fallback whose property is never defined is invalid at computed-value
// time: the whole declaration drops out. That is how the Calendar drag ghost lost its fill and
// outline (`var(--text)`, which does not exist; the token is `--text-primary`) while its label
// still showed, 14 Oct 2026. Every custom property the stylesheet reads must be defined in it or
// set from code (inline styles, `blockStyle()`, next/font variables).

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

/** Pre-existing undefined tokens (`--category-color` is only read by the unused `.report-category-marker` rule), tracked as a separate follow-up; do not add to this list. */
const KNOWN_UNDEFINED = new Set(["--danger-soft", "--shadow-raised", "--category-color"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function definedProperties() {
  const defined = new Set(css.match(/--[A-Za-z0-9_-]+(?=\s*:)/g) ?? []);
  for (const file of sourceFiles(join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["'`](--[A-Za-z0-9_-]+)["'`]\s*[:,)]/g)) defined.add(match[1]);
    for (const match of source.matchAll(/variable:\s*["'](--[A-Za-z0-9_-]+)["']/g)) defined.add(match[1]);
  }
  return defined;
}

describe("globals.css custom properties", () => {
  it("never reads an undefined custom property without a fallback", () => {
    const defined = definedProperties();
    const undefinedReads = new Set<string>();
    for (const match of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
      const [, name, fallback] = match;
      if (!fallback && !defined.has(name) && !KNOWN_UNDEFINED.has(name)) undefinedReads.add(name);
    }
    expect([...undefinedReads]).toEqual([]);
  });

  it("draws the Calendar drag ghost and resize tip from real tokens", () => {
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return css.slice(start, css.indexOf("}", start));
    };
    const ghost = rule(".calendar-create-ghost");
    const tip = rule(".calendar-resize-tip");
    expect(ghost).toContain("background: color-mix(in srgb, var(--text-primary) 10%, var(--surface))");
    expect(ghost).toContain("box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--text-primary) 45%, transparent)");
    expect(tip).toContain("background: var(--text-primary)");
    expect(`${ghost}${tip}`).not.toMatch(/var\(--text\)/);
  });
});
