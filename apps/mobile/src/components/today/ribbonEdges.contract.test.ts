import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RIBBON_MIN_BLOCK_WIDTH, ribbonBlockFrame } from "../../lib/todayRibbon";

// X2 (owner, Trello): iPhone ribbon blocks never touch and carry a very faint inner edge from the
// primary text colour (light on Midnight, dark on Daylight), never a darker outline.
const source = readFileSync(new URL("./TodayRibbon.tsx", import.meta.url), "utf8");

describe("iPhone Today ribbon blocks (X2)", () => {
  it("neighbours are 1 pt apart, and a minimum-width block keeps its gap inside its hit width", () => {
    const track = 300;
    const a = ribbonBlockFrame(0.1, 0.1, track); // 30..60
    const b = ribbonBlockFrame(0.2, 0.1, track); // 60..90
    expect(b.x - (a.x + a.width)).toBeCloseTo(1);
    // A block shorter than the minimum: drawn inside [left, left + min] with half a point clear each side.
    const tiny = ribbonBlockFrame(0.5, 0.001, track);
    expect(tiny.x).toBeCloseTo(150.5);
    expect(tiny.x + tiny.width).toBeCloseTo(150 + RIBBON_MIN_BLOCK_WIDTH - 0.5);
    const next = ribbonBlockFrame(0.5 + RIBBON_MIN_BLOCK_WIDTH / track, 0.1, track);
    expect(next.x - (tiny.x + tiny.width)).toBeCloseTo(1);
  });

  it("draws the full fill, then a faint inset edge on it; pending outlines stay inside the block", () => {
    expect(source).toMatch(/<Rect fill=\{color\} height=\{height\} rx=\{6\} width=\{w\} x=\{x\} y=\{y\} \/>/);
    expect(source).toMatch(/fill="none"[\s\S]*?stroke=\{colorWithAlpha\(theme\.textPrimary, RIBBON_EDGE_ALPHA\)\}\s*strokeWidth=\{1\}\s*width=\{Math\.max\(0, w - 1\)\}\s*x=\{x \+ 0\.5\}/);
    expect(source).toMatch(/strokeWidth=\{PENDING_STROKE\}\s*width=\{Math\.max\(0, w - PENDING_STROKE\)\}\s*x=\{x \+ PENDING_STROKE \/ 2\}/);
  });
});
