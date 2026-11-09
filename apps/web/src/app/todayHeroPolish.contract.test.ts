import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner Trello card "Prototype vs actual web app: Today" (W9): the hero follows the prototype.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("web Today hero (W9)", () => {
  // UI review (owner 29 Oct 2026): sentence case at the meta size, no tracked capitals.
  it("puts the date in a quiet sentence-case eyebrow", () => {
    const eyebrow = rule(".df-eyebrow");
    expect(eyebrow).toContain("text-transform: none;");
    expect(eyebrow).toContain("letter-spacing: 0;");
    expect(eyebrow).toContain("font-size: var(--type-meta);");
  });

  it("sets 'framed today' as the prototype's hero-sub, straight under the total", () => {
    const sub = rule(".df-today-sub");
    expect(sub).toContain("font-size: 14px;");
    expect(sub).toContain("margin: 2px 0 0;");
  });

  it("keeps a contrast-safe colour for the small capitals (4.5:1 on a Midnight card)", () => {
    expect(rule(".df-eyebrow")).toContain("color: var(--text-secondary);");
  });

  it("separates activities inside a goal hour cell without changing their widths (Codex r1)", () => {
    expect(rule(".df-goal-cell")).not.toContain("gap:");
    expect(rule(".df-goal-cell > span + span")).toContain("box-shadow: inset 2px 0 0 var(--surface-muted);");
    // Coral first, so it paints on top of the separator on a very short live slice (Codex r2).
    expect(rule(".df-goal-cell > span + span.is-live")).toContain("inset -2px 0 0 var(--accent), inset 2px 0 0 var(--surface-muted)");
  });
});
