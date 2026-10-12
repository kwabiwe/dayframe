import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X2 (owner, Trello): ribbon blocks never touch and carry a very faint inner edge that is light on
// Midnight and dark on Daylight (derived from the primary text), never a darker outline.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("web Today ribbon blocks (X2)", () => {
  it("keep 1 px apart with a faint inner edge", () => {
    const start = css.indexOf("\n.df-ribbon-block {");
    const rule = css.slice(start, css.indexOf("}", start));
    // A clip, not a border: border widths under 1 px snap to a whole device pixel (Codex r4).
    expect(rule).toContain("clip-path: inset(0 0.5px round 6px);");
    expect(rule).not.toMatch(/border(?:-inline)?\s*:/);
    expect(rule).toMatch(/box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--text-primary\) 14%, transparent\);/);
  });

  it("no ribbon block variant resets the clip with the background shorthand (Codex r1)", () => {
    for (const match of css.matchAll(/\n\.df-ribbon-block[^{]*\{([^}]*)\}/g)) {
      expect(match[1]).not.toMatch(/(^|[;\s])background\s*:/);
    }
  });
});
