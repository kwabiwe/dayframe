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
  it("puts the date in the prototype's capitalised eyebrow", () => {
    const eyebrow = rule(".df-eyebrow");
    expect(eyebrow).toContain("text-transform: uppercase;");
    expect(eyebrow).toContain("letter-spacing: 0.08em;");
    expect(eyebrow).toContain("font-size: 11px;");
  });

  it("sets 'framed today' as the prototype's hero-sub, straight under the total", () => {
    const sub = rule(".df-today-sub");
    expect(sub).toContain("font-size: 14px;");
    expect(sub).toContain("margin: 2px 0 0;");
  });

  it("keeps 2 px between activities inside a goal hour cell", () => {
    expect(rule(".df-goal-cell")).toContain("gap: 2px;");
  });
});
