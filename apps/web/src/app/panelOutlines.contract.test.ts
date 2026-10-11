import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner panel sweep (Trello, 11 Oct): web panels and cards are fill-led like the prototype's
// web.html `.card`; only floating chrome keeps a faint edge.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule (media queries and later overrides included) whose selector list targets `selector`. */
function rulesFor(selector: string) {
  const bodies: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    const selectors = match[1].split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

const PANELS = [
  ".df-card",
  ".df-library .places-list-section",
  ".auth-card",
  ".landing-preview-scene",
  ".landing-preview-block",
  ".landing-feature-strip article",
  ".landing-assurance"
];

describe("web panels without outlines", () => {
  it.each(PANELS)("%s draws no outline in any rule", (selector) => {
    const bodies = rulesFor(selector);
    expect(bodies.length, selector).toBeGreaterThan(0);
    for (const body of bodies) {
      // No border (shorthand or longhand) or outline other than none/0, and no inset perimeter.
      expect(body).not.toMatch(/(?:^|[;\s])(?:border(?:-(?:top|right|bottom|left|width|style|color))?|outline)\s*:\s*(?!none|0\b|transparent)/);
      expect(body).not.toMatch(/inset\s+0\s+0\s+0\s+\d/);
    }
  });

  it("floating chrome keeps its faint edge: the command bar and the phone tab bar", () => {
    expect(rulesFor(".df-cmd").join("\n")).toMatch(/inset 0 0 0 1px var\(--border\)/);
    expect(rulesFor(".df-tabbar").join("\n")).toMatch(/inset 0 0 0 1px var\(--border\)/);
  });
});
