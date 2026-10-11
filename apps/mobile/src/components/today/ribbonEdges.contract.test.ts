import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RIBBON_BLOCK_GAP, RIBBON_MIN_BLOCK_WIDTH, ribbonBlockFrame, ribbonHitAt } from "../../lib/todayRibbon";

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

  it("a tap selects the block drawn under it, even where a minimum-width block meets its neighbour (Codex r2)", () => {
    const track = 300;
    const day = new Date(2026, 9, 7).getTime();
    const dayMs = 86_400_000;
    const at = (hour: number, minute: number) => day + (hour * 60 + minute) * 60_000;
    const block = (key: string, start: number, end: number) => ({ key, kind: "entry", startMs: start, endMs: end });
    const model = { dayStartMs: day, dayMs, blocks: [block("a", at(12, 0), at(12, 1)), block("b", at(12, 1), at(13, 0))] } as never;
    const hit = (x: number) => {
      const result = ribbonHitAt(model, x / track, RIBBON_MIN_BLOCK_WIDTH / track, RIBBON_BLOCK_GAP / track);
      return result.kind === "block" ? (result.block as { key: string }).key : null;
    };
    const a = ribbonBlockFrame(0.5, 60_000 / dayMs, track);
    const b = ribbonBlockFrame((at(12, 1) - day) / dayMs, 59 * 60_000 / dayMs, track);
    // Only a is drawn at 150.6 (b's drawn frame starts after its half-point gap).
    expect(150.6).toBeGreaterThanOrEqual(a.x);
    expect(150.6).toBeLessThan(b.x);
    expect(hit(150.6)).toBe("a");
    // Where both are drawn, the later one is on top, as drawn.
    expect(hit(151.5)).toBe("b");
    expect(hit(160)).toBe("b");
  });

  it("draws the full fill, then a faint inset edge on it; pending outlines stay inside the block", () => {
    expect(source).toMatch(/<Rect fill=\{color\} height=\{height\} rx=\{Math\.min\(6, w \/ 2\)\} ry=\{Math\.min\(6, w \/ 2\)\} width=\{w\} x=\{x\} y=\{y\} \/>/);
    expect(source).toContain("rx={Math.max(0, Math.min(6, w / 2) - 0.5)}");
    expect(source).toMatch(/fill="none"[\s\S]*?stroke=\{colorWithAlpha\(theme\.textPrimary, RIBBON_EDGE_ALPHA\)\}\s*strokeWidth=\{1\}\s*width=\{Math\.max\(0, w - 1\)\}\s*x=\{x \+ 0\.5\}/);
    expect(source).toMatch(/strokeWidth=\{PENDING_STROKE\}\s*width=\{Math\.max\(0, w - PENDING_STROKE\)\}\s*x=\{x \+ PENDING_STROKE \/ 2\}/);
  });
});
