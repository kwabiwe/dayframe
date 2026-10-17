import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit WUI-038 (owner 17 Oct 2026): 93 stylesheet classes nothing rendered any more, some
// with coral or outline treatments that could resurface by accident, were deleted. Every class the
// stylesheet styles must appear in the web or shared source, so retired surfaces take their CSS
// with them.
const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** Classes styled by a third-party library's own markup, not ours. */
const EXTERNAL = [/^maplibregl-/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("no unused stylesheet classes (WUI-038)", () => {
  it("styles only classes the source renders", () => {
    const source = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "../../packages/shared/src"))]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    // Classes built in template strings (`timeline-entry-${kind}`) count by their prefix.
    const dynamicPrefixes = [...source.matchAll(/([a-z][\w-]*-)\$\{/g)].map((match) => match[1]);
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((match) => match[1]);
    const classes = new Set(selectors.flatMap((selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1])));
    const unused = [...classes].filter((name) => {
      if (EXTERNAL.some((pattern) => pattern.test(name))) return false;
      if (dynamicPrefixes.some((prefix) => name.startsWith(prefix))) return false;
      return !new RegExp(`(?<![\\w-])${name.replace(/-/g, "\\-")}(?![\\w-])`).test(source);
    });
    expect(unused).toEqual([]);
  });
});
