import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X4: the Undo toast pops in with the prototype's spring and only fades under Reduce Motion.
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("web Undo toast motion (X4)", () => {
  it("pops in with the pop spring from 16 px below at 96 %", () => {
    expect(css).toMatch(/\.df-toast \{[^}]*animation: df-toast-in var\(--df-toast-pop-ms, 320ms\) var\(--df-toast-pop,/);
    expect(css).toMatch(/@keyframes df-toast-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(16px\) scale\(0\.96\);/);
  });

  it("only fades under Reduce Motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-toast \{\s*animation: df-toast-fade-in 140ms ease-out both;\s*\}\s*\.df-toast\.is-exiting \{\s*animation: df-toast-fade-out 80ms ease-in both;/);
  });
});
