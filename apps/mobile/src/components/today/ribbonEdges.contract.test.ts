import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RIBBON_BLOCK_GAP, RIBBON_MIN_BLOCK_WIDTH, ribbonBlockFrame, ribbonHitAt } from "../../lib/todayRibbon";

// X2 (owner, Trello): iPhone ribbon blocks never touch and carry a very faint inner edge from the
// primary text colour (light on Midnight, dark on Daylight), never a darker outline.
const source = readFileSync(new URL("./TodayRibbon.tsx", import.meta.url), "utf8");

describe("iPhone Today ribbon blocks (X2)", () => {
  it("neighbours are 1 pt apart, also after a minimum-width block (X2, Codex r3)", () => {
    const track = 300;
    const dayMs = 86_400_000;
    const at = (hour: number, minute: number) => (hour * 60 + minute) * 60_000;
    const blocks = [
      { startMs: at(2, 24), endMs: at(4, 48) },
      { startMs: at(4, 48), endMs: at(7, 12) },
      { startMs: at(12, 0), endMs: at(12, 1) },
      { startMs: at(12, 1), endMs: at(13, 0) },
      { startMs: at(18, 0), endMs: at(18, 1) }
    ];
    const model = { blocks, dayStartMs: 0, dayMs } as never;
    const frame = (index: number) => ribbonBlockFrame(model, blocks[index], track);
    expect(frame(1).x - (frame(0).x + frame(0).width)).toBeCloseTo(RIBBON_BLOCK_GAP);
    // The exact fixture: 12:00–12:01 reaches only to 12:01 (0.2 pt), so after the gap it is not
    // drawn at all, rather than drawn under 12:01–13:00 (as before, when only 0.2 pt of it showed).
    expect(frame(2).width).toBe(0);
    // Alone, a short block keeps the minimum width (less the gap).
    expect(frame(4).width).toBeCloseTo(RIBBON_MIN_BLOCK_WIDTH - RIBBON_BLOCK_GAP);
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
    const b = ribbonBlockFrame(model, { startMs: at(12, 1), endMs: at(13, 0) }, track);
    // Nothing of a is drawn; b's fill starts after its half-point gap.
    expect(ribbonBlockFrame(model, { startMs: at(12, 0), endMs: at(12, 1) }, track).width).toBe(0);
    expect(hit(b.x + 0.1)).toBe("b");
    expect(hit(160)).toBe("b");
    // Between them (the gap), the nearest reach still answers.
    expect(hit(150.6)).toBe("b");
    expect(hit(150.1)).toBe("a");
  });

  it("a block narrower than its stroke is drawn as fill alone (Codex r4)", () => {
    expect(source).toContain("if (block.kind === \"pending\" && w < PENDING_STROKE * 2) {");
    expect(source).toContain("if (block.kind !== \"pending\" && w < 2) {");
  });

  it("draws the full fill, then a faint inset edge on it; pending outlines stay inside the block", () => {
    expect(source).toMatch(/<Rect fill=\{color\} height=\{height\} rx=\{Math\.min\(6, w \/ 2\)\} ry=\{Math\.min\(6, w \/ 2\)\} width=\{w\} x=\{x\} y=\{y\} \/>/);
    expect(source).toContain("rx={Math.max(0, Math.min(6, w / 2) - 0.5)}");
    expect(source).toMatch(/fill="none"[\s\S]*?stroke=\{colorWithAlpha\(theme\.textPrimary, RIBBON_EDGE_ALPHA\)\}\s*strokeWidth=\{1\}\s*width=\{Math\.max\(0, w - 1\)\}\s*x=\{x \+ 0\.5\}/);
    expect(source).toMatch(/strokeWidth=\{PENDING_STROKE\}\s*width=\{Math\.max\(0, w - PENDING_STROKE\)\}\s*x=\{x \+ PENDING_STROKE \/ 2\}/);
  });
});
