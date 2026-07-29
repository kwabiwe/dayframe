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
      focus: "#71C5F4",
      chartTrack: "#252E40"
    });
    expect(DAYFRAME_THEME.light).toMatchObject({
      background: "#F4F6F9",
      surface: "#FFFFFF",
      surfaceRaised: "#FFFFFF",
      accent: "#F45D43",
      onAccent: "#111827",
      focus: "#2563EB",
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
      expect(contrast(theme.focus, theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.focus, theme.surfaceInset)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onAccent, theme.accentHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onAccent, theme.accentPressed)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(DAYFRAME_THEME.light.accentText, DAYFRAME_THEME.light.accentSoft))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("preserves palette keys and deterministic order", () => {
    expect(DAYFRAME_PALETTE.map((color) => color.key)).toEqual([
      "mint-soft", "yellow-soft", "orange-soft", "red-soft", "violet-soft",
      "mint",
      "amber",
      "orange",
      "red",
      "purple",
      "green", "olive", "rust", "crimson", "violet",
      "blue-soft", "sky-soft", "lime-soft", "rose-soft", "steel-soft",
      "blue", "sky", "lime", "rose",
      "steel",
      "blue-bold", "teal", "moss", "magenta",
      "graphite"
    ]);
  });

  it("resolves mode-aware display colours without changing stored keys", () => {
    expect(paletteColorFor("red", "", "dark")).toBe("#F87168");
    expect(paletteColorFor("red", "", "light")).toBe("#F87168");
    expect(paletteCssColorFor("red")).toBe("light-dark(#F87168, #F87168)");
  });

  it("round-trips every light and dark display colour to its stable key", () => {
    for (const color of DAYFRAME_PALETTE) {
      expect(paletteKeyFor(color.lightHex)).toBe(color.key);
      expect(paletteKeyFor(color.darkHex)).toBe(color.key);
    }
  });

  it("offers all 30 intentional shade choices without duplicate values", () => {
    expect(DAYFRAME_PALETTE).toHaveLength(30);
    expect(new Set(DAYFRAME_PALETTE.map((color) => color.hex)).size).toBe(30);
  });

  it("recognizes the previous Midnight Core display hex values", () => {
    const previousValues = {
      "#39D99A": "lime",
      "#20B978": "lime",
      "#24C7B1": "teal",
      "#0FAF9B": "teal",
      "#63B3FF": "sky",
      "#5AA7EE": "sky",
      "#4B93F5": "blue",
      "#3B82F6": "blue",
      "#7D6EE6": "violet",
      "#7564E8": "violet",
      "#E87AAE": "rose",
      "#D95F99": "rose",
      "#F2BA38": "amber",
      "#E8A91E": "amber",
      "#FF934F": "orange",
      "#E9792F": "orange",
      "#7F91AB": "steel",
      "#65758B": "steel",
      "#7FB36A": "moss",
      "#5F944D": "moss",
      "#566176": "graphite",
      "#475569": "graphite"
    } as const;

    for (const [hex, key] of Object.entries(previousValues)) {
      expect(paletteKeyFor(hex)).toBe(key);
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
