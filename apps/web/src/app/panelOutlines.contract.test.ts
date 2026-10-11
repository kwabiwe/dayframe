import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner panel sweep (Trello, 11 Oct): web panels and cards are fill-led like the prototype's
// web.html `.card`; only floating chrome keeps a faint edge.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("web panels without outlines", () => {
  it.each([".df-card", ".df-library .places-list-section", ".auth-card"])("%s has no outline", (selector) => {
    const body = rule(selector);
    expect(body).not.toMatch(/inset 0 0 0 1px/);
    expect(body).not.toMatch(/\bborder:/);
  });

  it("floating chrome keeps its faint edge", () => {
    expect(rule(".df-cmd")).toMatch(/inset 0 0 0 1px var\(--border\)/);
  });
});
