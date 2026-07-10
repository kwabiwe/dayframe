import { describe, expect, it } from "vitest";
import {
  DAYFRAME_PALETTE,
  DAYFRAME_THEME,
  paletteColorFor,
  paletteCssColorFor,
  paletteKeyFor
} from "./index";

describe("Midnight Core theme", () => {
  it("keeps the approved dark and light semantic anchors", () => {
    expect(DAYFRAME_THEME.dark).toMatchObject({
      background: "#050914",
      surface: "#151B27",
      surfaceRaised: "#1B2230",
      accent: "#FF6248",
      onAccent: "#050914",
      focus: "#7D6EE6",
      chartTrack: "#252E40"
    });
    expect(DAYFRAME_THEME.light).toMatchObject({
      background: "#F4F6F9",
      surface: "#FFFFFF",
      surfaceRaised: "#FFFFFF",
      accent: "#F45D43",
      onAccent: "#111827",
      focus: "#7564E8",
      chartTrack: "#E5E9F0"
    });
  });

  it("keeps foreground and interactive-boundary roles at accessible contrast", () => {
    for (const theme of Object.values(DAYFRAME_THEME)) {
      expect(contrast(theme.accentText, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.warningText, theme.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.dangerText, theme.surfaceInset)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.controlBorder, theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.controlBorder, theme.surfaceInset)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onAccent, theme.accentHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onAccent, theme.accentPressed)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(DAYFRAME_THEME.light.accentText, DAYFRAME_THEME.light.accentSoft))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("preserves palette keys and deterministic order", () => {
    expect(DAYFRAME_PALETTE.map((color) => color.key)).toEqual([
      "lime",
      "teal",
      "sky",
      "blue",
      "violet",
      "rose",
      "amber",
      "orange",
      "red",
      "steel",
      "moss",
      "graphite"
    ]);
  });

  it("resolves mode-aware display colours without changing stored keys", () => {
    expect(paletteColorFor("red", "", "dark")).toBe("#FF6248");
    expect(paletteColorFor("red", "", "light")).toBe("#F45D43");
    expect(paletteCssColorFor("red")).toBe("var(--palette-red)");
  });

  it("round-trips every light and dark display colour to its stable key", () => {
    for (const color of DAYFRAME_PALETTE) {
      expect(paletteKeyFor(color.lightHex)).toBe(color.key);
      expect(paletteKeyFor(color.darkHex)).toBe(color.key);
    }
  });

  it("recognizes every previous Soft Pop display hex", () => {
    const legacyValues = {
      "#BFE8D9": "lime",
      "#84D8C9": "teal",
      "#8EC5F2": "sky",
      "#7FA7E8": "blue",
      "#B58EE8": "violet",
      "#E8A7BF": "rose",
      "#FFD979": "amber",
      "#FF987D": "orange",
      "#F0776B": "red",
      "#57CFC2": "steel",
      "#B7D99B": "moss",
      "#1D2638": "graphite"
    } as const;

    for (const [hex, key] of Object.entries(legacyValues)) {
      expect(paletteKeyFor(hex)).toBe(key);
    }
  });
});

function contrast(first: string, second: string) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
