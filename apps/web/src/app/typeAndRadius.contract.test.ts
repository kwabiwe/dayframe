import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P8 (WUI-036, WUI-037; owner 17 Oct 2026): type and radius tokens in px, 30 px screen
// titles, and a ratchet so Blocks rules stop adding literal sizes. Existing literals migrate as each
// family is touched (no big-bang sweep); lower the baselines when they do.
const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const LITERAL_FONT_SIZE_BASELINE = 157;
const LITERAL_RADIUS_BASELINE = 121;

/** A selector list split at its top-level commas only (`:is(:hover, :focus)` stays whole). */
function splitSelectors(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
}

/** Every declaration with the selector (or at-rule prelude) it sits directly under, nesting included. */
export function cssDeclarations(css: string) {
  const out: { selector: string; prop: string; value: string; siblings: { prop: string; value: string }[] }[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const stack: { selector: string; decls: { prop: string; value: string }[] }[] = [];
  let buffer = "";
  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    const frame = stack[stack.length - 1];
    const match = /^([-a-z]+)\s*:\s*([\s\S]+)$/i.exec(text);
    if (frame && match) frame.decls.push({ prop: match[1].toLowerCase(), value: match[2].replace(/\s*!important$/, "").trim() });
  };
  for (const char of clean) {
    if (char === "{") {
      stack.push({ selector: buffer.trim().replace(/\s+/g, " "), decls: [] });
      buffer = "";
    } else if (char === "}") {
      flush();
      const frame = stack.pop();
      if (frame) for (const decl of frame.decls) out.push({ selector: frame.selector, ...decl, siblings: frame.decls });
    } else if (char === ";") {
      flush();
    } else {
      buffer += char;
    }
  }
  return out;
}

/** Literal (non-token) values of a property in any rule that styles a Blocks (`.df-`) element. */
export function blocksLiterals(css: string, property: "font-size" | "border-radius") {
  const values: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const [, selectorText, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitSelectors(selectorText);
    // Mixed lists count too: the declaration still styles the Blocks element.
    if (!selectors.some((selector) => selector.includes(".df-"))) continue;
    for (const [, prop, value] of body.matchAll(/(?:^|;)\s*(font-size|border-radius)\s*:\s*([^;]+)/g)) {
      if (prop !== property) continue;
      const trimmed = value.trim();
      if (/^(var\(|inherit$|0$)/.test(trimmed)) continue;
      values.push(`${selectors.join(", ")}: ${trimmed}`);
    }
  }
  return values;
}

describe("type and radius tokens (WUI-036, WUI-037)", () => {
  it("defines the roles in px", () => {
    for (const [token, value] of [
      ["--type-label", "11px"],
      ["--type-meta", "12px"],
      ["--type-body", "14px"],
      ["--type-panel", "15px"],
      ["--type-panel-lg", "16px"],
      ["--type-sheet", "17px"],
      ["--type-screen", "24px"],
      ["--type-total", "34px"],
      ["--fw-regular", "400"],
      ["--fw-medium", "500"],
      ["--fw-strong", "600"],
      ["--r-chip", "10px"],
      ["--r-block", "var(--activity-marker-radius)"],
      ["--r-card", "16px"],
      ["--r-sheet", "24px"],
      ["--r-pill", "999px"]
    ]) {
      expect(styles).toContain(`${token}: ${value};`);
    }
  });

  it("never sizes type in rem, which changes with the 14 / 16 px root", () => {
    expect(styles).not.toMatch(/font-size:\s*[\d.]+rem/);
  });

  it("keeps screen titles on the one screen token at every width, the status pages' too", () => {
    for (const selector of [".df-page-head h1", ".df-status-card h1"]) {
      const blocks = [...styles.matchAll(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))];
      const sizes = blocks.flatMap(([, body]) => [...body.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim()));
      expect(sizes, selector).toEqual(["var(--type-screen)"]);
    }
    expect(styles).not.toMatch(/\.df-cal-head h1\s*\{[^}]*font-size/);
  });

  it("does not add literal font sizes or radii to Blocks rules", () => {
    expect(blocksLiterals(styles, "font-size").length).toBeLessThanOrEqual(LITERAL_FONT_SIZE_BASELINE);
    expect(blocksLiterals(styles, "border-radius").length).toBeLessThanOrEqual(LITERAL_RADIUS_BASELINE);
  });

  // UI review (owner 29 Oct 2026): the system font uses three weights only, through the tokens; the
  // display face (Bricolage, bundled at 700 and 800) uses its 700 cut. No half-pixel type sizes.
  it("weights text through the three tokens, and the display face at 700", () => {
    const strays = cssDeclarations(styles)
      .filter(({ prop }) => prop === "font-weight")
      .filter(({ value, siblings }) => {
        if (/^var\(--fw-(regular|medium|strong)\)$/.test(value) || value === "inherit") return false;
        return !(value === "700" && siblings.some((d) => d.prop === "font-family" && /^var\(--font-display/.test(d.value)));
      })
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(strays).toEqual([]);
  });

  it("smooths text and never uses half-pixel type sizes", () => {
    expect(styles).toMatch(/body\s*\{[^}]*-webkit-font-smoothing:\s*antialiased;[^}]*-moz-osx-font-smoothing:\s*grayscale;/);
    // The Calendar's compact block title keeps its 11.5 spec (Calendar v3, owner 24 Oct 2026), and only it.
    const halves = cssDeclarations(styles)
      .filter(({ prop, value }) => prop === "font-size" && /\d\.\d/.test(value))
      .filter(({ selector, value }) => !(value === "11.5px" && splitSelectors(selector).every((part) => /\.calendar-entry-title$/.test(part))))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(halves).toEqual([]);
  });

  it("reads nested rules and grouped selectors in those checks (Codex r1 on #628)", () => {
    const probe = `
      .parent { font-weight: 900; .child { font-weight: var(--fw-medium); } }
      .df-x { font-family: var(--font-display); font-weight: 700; }
      .other, .calendar-entry-title { font-size: 11.5px; }
      .calendar-entry-title { font-size: 99.5px; }
    `;
    const declarations = cssDeclarations(probe);
    expect(declarations.find((d) => d.prop === "font-weight" && d.value === "900")?.selector).toBe(".parent");
    expect(declarations.filter((d) => d.prop === "font-size").map((d) => `${d.selector}: ${d.value}`))
      .toEqual([".other, .calendar-entry-title: 11.5px", ".calendar-entry-title: 99.5px"]);
  });

  it("counts Blocks rules with functional pseudo-classes, mixed lists and media nesting (Codex r1 on #496)", () => {
    const probe = `
      /* .df-commented { font-size: 99px; } */
      .df-new:is(:hover, :focus) { font-size: 99px; border-radius: 99px; }
      .legacy, .df-mixed { font-size: 13px; }
      @media (max-width: 560px) { .df-phone { border-radius: 7px; } }
      .df-token { font-size: var(--type-body); border-radius: var(--r-card); }
      .legacy-only { font-size: 15px; }
    `;
    expect(blocksLiterals(probe, "font-size")).toEqual([".df-new:is(:hover, :focus): 99px", ".legacy, .df-mixed: 13px"]);
    expect(blocksLiterals(probe, "border-radius")).toEqual([".df-new:is(:hover, :focus): 99px", ".df-phone: 7px"]);
  });
});
