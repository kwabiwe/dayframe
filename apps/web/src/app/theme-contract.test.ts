import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DAYFRAME_PALETTE, DAYFRAME_THEME } from "@dayframe/shared";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

const semanticTokenNames = {
  background: "background",
  surface: "surface",
  surfaceRaised: "surface-raised",
  surfaceInset: "surface-inset",
  surfaceMuted: "surface-muted",
  border: "border",
  borderStrong: "border-strong",
  controlBorder: "control-border",
  textPrimary: "text-primary",
  textSecondary: "text-secondary",
  textMuted: "text-muted",
  accent: "accent",
  accentText: "accent-text",
  accentHover: "accent-hover",
  accentPressed: "accent-pressed",
  accentSoft: "accent-soft",
  onAccent: "on-accent",
  focus: "focus",
  success: "success",
  warning: "warning",
  warningText: "warning-text",
  danger: "danger",
  dangerText: "danger-text",
  onDanger: "on-danger",
  info: "info",
  chartTrack: "chart-track",
  disabled: "disabled",
  overlay: "overlay",
  shadow: "shadow-color"
} as const;

describe("web Midnight Core token mirror", () => {
  it("mirrors shared light semantic and palette values", () => {
    const block = cssBlock(":root[data-theme=\"light\"]");
    expectThemeTokens(block, DAYFRAME_THEME.light);
    for (const color of DAYFRAME_PALETTE) {
      expect(block).toContain(`--palette-${color.key}: ${color.lightHex.toLowerCase()};`);
    }
  });

  it("mirrors shared dark values for explicit and system modes", () => {
    const blocks = [
      cssBlock(":root[data-theme=\"dark\"]"),
      cssBlock(":root:not([data-theme=\"light\"])")
    ];

    for (const block of blocks) {
      expectThemeTokens(block, DAYFRAME_THEME.dark);
      for (const color of DAYFRAME_PALETTE) {
        expect(block).toContain(`--palette-${color.key}: ${color.darkHex.toLowerCase()};`);
      }
    }
  });

  it("keeps the established web compatibility aliases", () => {
    const block = cssBlock(":root[data-theme=\"light\"]");
    expect(block).toContain("--surface-strong: var(--surface-raised);");
    expect(block).toContain("--foreground: var(--text-primary);");
    expect(block).toContain("--muted: var(--text-secondary);");
    expect(block).toContain("--line: var(--border);");
    expect(block).toContain("--line-strong: var(--border-strong);");
  });
});

function expectThemeTokens(
  block: string,
  theme: (typeof DAYFRAME_THEME)[keyof typeof DAYFRAME_THEME]
) {
  for (const [themeName, cssName] of Object.entries(semanticTokenNames)) {
    const value = theme[themeName as keyof typeof theme];
    expect(block).toContain(`--${cssName}: ${String(value).toLowerCase()};`);
  }
}

function cssBlock(selector: string) {
  const selectorIndex = css.indexOf(selector);
  if (selectorIndex < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const openingBrace = css.indexOf("{", selectorIndex);
  let depth = 0;

  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${selector}`);
}
