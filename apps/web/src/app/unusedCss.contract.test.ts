import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit WUI-038 (owner 17 Oct 2026): about 120 stylesheet classes nothing rendered any more, some
// with coral or outline treatments that could resurface by accident, were deleted. Every class the
// stylesheet styles must appear in the web or shared source, so retired surfaces take their CSS
// with them.
const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

/** Classes styled by a third-party library's own markup, not ours. */
const EXTERNAL = [/^maplibregl-/];

/**
 * The class names the source builds from a variable, each a verified builder with bounded variants
 * (Primitives' button/dialog variants, the brand size). A template string elsewhere (an id such as
 * `report-${key}-title`) exempts nothing (Codex r1 on #497).
 */
const CLASS_BUILDERS = ["ui-button-", "ui-icon-button-", "ui-dialog--", "dayframe-brand-"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** CSS hex and character escapes in an identifier (`\31 0px` is "10px"). */
function unescapeIdentifier(name: string) {
  return name.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex: string | undefined, char: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (char ?? ""));
}

/** Every class a stylesheet's selectors name: comments, strings and attribute selectors skipped. */
export function styledClasses(stylesheet: string) {
  const clean = stylesheet.replace(/\/\*[\s\S]*?\*\//g, " ");
  const classes = new Set<string>();
  for (const [, selectorText] of clean.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selectors = selectorText
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "\"\"")
      .replace(/\[[^\]]*\]/g, "[]");
    for (const [, name] of selectors.matchAll(/\.((?:[_a-zA-Z-]|\\[0-9a-fA-F]{1,6}\s?|\\[^0-9a-fA-F\s])(?:[\w-]|\\[0-9a-fA-F]{1,6}\s?|\\[^0-9a-fA-F\s])*)/g)) {
      classes.add(unescapeIdentifier(name));
    }
  }
  return classes;
}

function unusedClasses(stylesheet: string, source: string) {
  return [...styledClasses(stylesheet)].filter((name) => {
    if (EXTERNAL.some((pattern) => pattern.test(name))) return false;
    if (CLASS_BUILDERS.some((prefix) => name.startsWith(prefix))) return false;
    return !new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(source);
  });
}

const source = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "../../packages/shared/src"))]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("no unused stylesheet classes (WUI-038)", () => {
  it("styles only classes the source renders", () => {
    expect(unusedClasses(css, source)).toEqual([]);
  });

  it("keeps every class builder real", () => {
    for (const prefix of CLASS_BUILDERS) expect(source, prefix).toContain(`\`${prefix}\${`);
  });

  it("reads selectors without inventing or missing classes", () => {
    const probe = `
      /* .commented { color: red; } */
      a[href$=".pdf"], .df-real:is(.df-inner, :hover) { color: red; }
      .\\31 0px { width: 10px; }
      @media (max-width: 560px) { .df-phone { color: red; } }
      .report-definitely-never-rendered { color: red; }
    `;
    expect([...styledClasses(probe)].sort()).toEqual(["10px", "df-inner", "df-phone", "df-real", "report-definitely-never-rendered"]);
    expect(unusedClasses(probe, "df-real df-inner df-phone 10px")).toEqual(["report-definitely-never-rendered"]);
  });
});
