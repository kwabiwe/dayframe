import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner design C1 (13 Oct 2026): the sticky timer band is opaque canvas with no rule at rest; a
// 1 px hairline fades in only once content has scrolled under it (useBandScrolled).
describe("the band's styles and wiring", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("is an opaque canvas band with room under the pills and no rule at rest", () => {
    const band = rule(".swiss-persistent-timer-shell");
    expect(band).toMatch(/background: var\(--background\);/);
    expect(band).toMatch(/position: sticky;/);
    expect(band).not.toMatch(/border(?:-bottom)?\s*:\s*1px/);
    const hairline = rule(".swiss-persistent-timer-shell::after");
    expect(hairline).toMatch(/height: 1px;/);
    expect(hairline).toMatch(/background: var\(--line\);/);
    expect(hairline).toMatch(/opacity: 0;/);
    expect(hairline).toMatch(/transition: opacity 160ms ease-out;/);
    expect(rule('.swiss-persistent-timer-shell[data-scrolled="true"]::after')).toMatch(/opacity: 1;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.swiss-persistent-timer-shell::after \{\s*transition: none;/);
  });

  it("keeps the opaque canvas in every rule that styles the band, Calendar included (Codex r1)", () => {
    // Every rule whose selector targets the band itself (not its ::after or descendants): any
    // background it sets is the canvas, so no later override (Calendar's used to be transparent)
    // can make the band see-through.
    const bodies = [...css.matchAll(/\n\s*([^{}\n]*\.swiss-persistent-timer-shell)\s*\{([^}]*)\}/g)];
    expect(bodies.length).toBeGreaterThan(2);
    const backgrounds = bodies
      .map(([, selector, body]) => [selector.trim(), /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+);/.exec(body)?.[1]?.trim()])
      .filter(([, value]) => value !== undefined);
    expect(backgrounds.map(([selector]) => selector)).toContain(".swiss-timeline-surface .swiss-persistent-timer-shell");
    for (const [selector, value] of backgrounds) expect(value, selector).toBe("var(--background)");
    expect(css).not.toMatch(/\.swiss-persistent-timer-shell\s*\{[^}]*background:\s*transparent/);
  });

  it("is driven by AppShell from the page's own main element", () => {
    const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("useBandScrolled(timerBandRef, pageMainRef, pathname)");
    expect(shell).toContain('data-scrolled={contentUnderBand ? "true" : undefined}');
    // One tree for every page (UI review round 2): one band and one main; Calendar's main is its own panel, which its
    // grid scrolls inside.
    expect(shell).toContain('<main className={isTimeline ? "swiss-timeline-main" : undefined} ref={pageMainRef}>');
    expect(shell.match(/data-scrolled=\{contentUnderBand \? "true" : undefined\}/g)).toHaveLength(1);
  });
});
