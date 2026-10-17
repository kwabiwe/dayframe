import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Web UI audit P8 (WUI-036, WUI-037; owner 17 Oct 2026): type and radius tokens in px, 30 px screen
// titles, and a ratchet so Blocks rules stop adding literal sizes. Existing literals migrate as each
// family is touched (no big-bang sweep); lower the baselines when they do.
const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

const LITERAL_FONT_SIZE_BASELINE = 158;
const LITERAL_RADIUS_BASELINE = 121;

/** Literal (non-token) values of a property in rules whose every selector is a Blocks (`.df-`) one. */
function blocksLiterals(property: "font-size" | "border-radius") {
  const values: string[] = [];
  for (const [, selectorText, body] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorText.split(",").map((selector) => selector.trim()).filter(Boolean);
    if (!selectors.length || !selectors.every((selector) => selector.includes(".df-"))) continue;
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

  it("keeps screen titles at 30 px at every width", () => {
    for (const selector of [".df-page-head h1", ".df-review-head h1"]) {
      const blocks = [...styles.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))];
      const sizes = blocks.flatMap(([, body]) => [...body.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim()));
      expect(sizes, selector).toEqual(["var(--type-screen)"]);
    }
    expect(styles).not.toMatch(/\.df-cal-head h1\s*\{[^}]*font-size/);
  });

  it("does not add literal font sizes or radii to Blocks rules", () => {
    expect(blocksLiterals("font-size").length).toBeLessThanOrEqual(LITERAL_FONT_SIZE_BASELINE);
    expect(blocksLiterals("border-radius").length).toBeLessThanOrEqual(LITERAL_RADIUS_BASELINE);
  });
});
