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

const NAME = "--[A-Za-z0-9_-]+";

/** CSS without comments, strings and url(...) bodies, so literal "var(--x)" text is never read as code. */
function stripCssNoise(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/g, "url()")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, "\"\"");
}

/** Custom properties a stylesheet declares (`--x: …` inside a block) or registers (`@property --x`). */
export function definedInCss(source: string) {
  const clean = stripCssNoise(source);
  const defined = new Set<string>();
  // A declaration starts after `{` or `;` (selectors like `.chip--live:hover` never do).
  for (const match of clean.matchAll(new RegExp(`(?:^|[{;])\\s*(${NAME})\\s*:`, "gm"))) defined.add(match[1]);
  for (const match of clean.matchAll(new RegExp(`@property\\s+(${NAME})\\s*\\{`, "g"))) defined.add(match[1]);
  return defined;
}

/** Custom properties code writes: style-object keys, `style.setProperty("--x", …)`, next/font `variable`. */
export function definedInCode(source: string) {
  const defined = new Set<string>();
  for (const match of source.matchAll(new RegExp(`["'\`](${NAME})["'\`]\\s*:`, "g"))) defined.add(match[1]);
  for (const match of source.matchAll(new RegExp(`\\.setProperty\\(\\s*["'\`](${NAME})["'\`]`, "g"))) defined.add(match[1]);
  for (const match of source.matchAll(new RegExp(`variable:\\s*["'](${NAME})["']`, "g"))) defined.add(match[1]);
  return defined;
}

/** `var(--x)` reads with no fallback whose property is not in `defined`. */
export function undefinedReads(source: string, defined: Set<string>) {
  const reads = new Set<string>();
  for (const match of stripCssNoise(source).matchAll(new RegExp(`var\\(\\s*(${NAME})\\s*(,)?`, "g"))) {
    const [, name, fallback] = match;
    if (!fallback && !defined.has(name)) reads.add(name);
  }
  return [...reads].sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function appDefinitions() {
  const defined = definedInCss(css);
  for (const file of sourceFiles(join(root, "src"))) {
    for (const name of definedInCode(readFileSync(file, "utf8"))) defined.add(name);
  }
  return defined;
}

describe("custom property scanner", () => {
  it("recognises only real declarations, registrations and code writes", () => {
    expect([...definedInCss(".a { --x: 1px; color: red; --y:2px }")].sort()).toEqual(["--x", "--y"]);
    expect([...definedInCss("@property --angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }")]).toContain("--angle");
    // A BEM-style selector is not a definition.
    expect(definedInCss(".chip--live:hover { color: var(--text-primary); } .x--more:focus { }").has("--live")).toBe(false);
    expect(definedInCss(".x--more:focus { }").has("--more")).toBe(false);
    // Reading a property in code is not a write.
    expect(definedInCode('getComputedStyle(el).getPropertyValue("--text-primary")').has("--text-primary")).toBe(false);
    expect(definedInCode('el.style.setProperty("--x", "1px"); const s = { "--block": c };')).toEqual(new Set(["--x", "--block"]));
  });

  it("flags undefined reads but not fallbacks, strings, urls or comments", () => {
    const defined = new Set(["--defined"]);
    expect(undefinedReads(".a { color: var(--missing); background: var(--defined); }", defined)).toEqual(["--missing"]);
    expect(undefinedReads(".a { color: var(--missing, red); }", defined)).toEqual([]);
    expect(undefinedReads('.a::after { content: "var(--in-string)"; background: url("x-var(--in-url).svg"); } /* var(--in-comment) */', defined)).toEqual([]);
    // Removing a real definition makes its reads fail.
    expect(undefinedReads(".a { color: var(--text-primary); }", definedInCss(".chip--live:hover { }"))).toEqual(["--text-primary"]);
  });
});

describe("globals.css custom properties", () => {
  it("never reads an undefined custom property without a fallback", () => {
    // No exceptions: the last three (--danger-soft, --shadow-raised, --category-color) were fixed
    // on 14 Oct 2026.
    expect(undefinedReads(css, appDefinitions())).toEqual([]);
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
    expect(definedInCss(css).has("--text-primary")).toBe(true);
    expect(`${ghost}${tip}`).not.toMatch(/var\(--text\)/);
  });
});

describe("soft danger fill keeps its text readable (Codex r1 on #425)", () => {
  it("is a 10% danger tint over the muted surface", () => {
    expect(css).toContain("--danger-soft: color-mix(in srgb, var(--danger) 10%, var(--surface-muted));");
  });
});
