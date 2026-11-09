import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Codex r1 on #609: the Calendar's new small controls are 44 × 44 px targets at every width, phones included,
// without growing what they draw (an invisible hit area centred on each).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list includes `selector`. */
function declarations(selector: string) {
  return [...css.matchAll(/(?<=^|[{}])\s*([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").map((each) => each.trim()).includes(selector))
    .map(([, , body]) => body).join("\n");
}

describe("Calendar touch targets (Codex r1 on #609)", () => {
  for (const control of [".timeline-row-yes", ".timeline-places-filter button", ".calendar-places-item"]) {
    it(`gives ${control} a hit area of at least 44 × 44 px`, () => {
      const hit = declarations(`${control}::before`);
      expect(hit).toMatch(/content: "";/);
      expect(hit).toMatch(/position: absolute;/);
      expect(hit).toMatch(/width: max\(100%, 44px\);/);
      expect(hit).toMatch(/height: max\(100%, 44px\);/);
      expect(hit).toMatch(/transform: translate\(-50%, -50%\);/);
      // The control itself is its containing block, so the area is centred on it.
      expect(declarations(control)).toMatch(/position: (relative|absolute);/);
    });
  }
});
