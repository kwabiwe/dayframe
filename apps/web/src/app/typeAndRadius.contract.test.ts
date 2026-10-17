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
      ["--type-panel", "17px"],
      ["--type-panel-lg", "18px"],
      ["--type-sheet", "20px"],
      ["--type-screen", "30px"],
      ["--r-chip", "10px"],
      ["--r-block", "var(--activity-marker-radius)"],
      ["--r-card", "22px"],
      ["--r-sheet", "24px"],
      ["--r-pill", "999px"]
    ]) {
      expect(styles).toContain(`${token}: ${value};`);
    }
  });

  it("never sizes type in rem, which changes with the 14 / 16 px root", () => {
    expect(styles).not.toMatch(/font-size:\s*[\d.]+rem/);
  });

  it("keeps screen titles at 30 px at every width, the status pages' too", () => {
    for (const selector of [".df-page-head h1", ".df-review-head h1", ".df-status-card h1"]) {
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
