import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X2 (owner, Trello): iPhone ribbon blocks never touch and carry a very faint inner edge from the
// primary text colour (light on Midnight, dark on Daylight), never a darker outline.
const source = readFileSync(new URL("./TodayRibbon.tsx", import.meta.url), "utf8");

describe("iPhone Today ribbon blocks (X2)", () => {
  it("keep 1 pt apart with a faint inner edge drawn inside the block", () => {
    expect(source).toContain("const RIBBON_BLOCK_GAP = 1;");
    expect(source).toContain("const x = block.left * width + RIBBON_BLOCK_GAP / 2;");
    expect(source).toContain("block.width * width - RIBBON_BLOCK_GAP");
    expect(source).toMatch(/stroke=\{colorWithAlpha\(theme\.textPrimary, RIBBON_EDGE_ALPHA\)\}\s*strokeWidth=\{1\}\s*width=\{Math\.max\(0, w - 1\)\}\s*x=\{x \+ 0\.5\}\s*y=\{y \+ 0\.5\}/);
  });
});
