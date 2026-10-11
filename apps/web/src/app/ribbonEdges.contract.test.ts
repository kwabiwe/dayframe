import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X2 (owner, Trello): ribbon blocks never touch and carry a very faint inner edge that is light on
// Midnight and dark on Daylight (derived from the primary text), never a darker outline.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("web Today ribbon blocks (X2)", () => {
  it("keep 1 px apart with a faint inner edge", () => {
    const start = css.indexOf("\n.df-ribbon-block {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("border-inline: 0.5px solid transparent;");
    expect(rule).toContain("background-clip: padding-box;");
    expect(rule).toContain("box-sizing: border-box;");
    expect(rule).toMatch(/box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--text-primary\) 14%, transparent\);/);
  });
});
