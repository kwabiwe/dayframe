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

  it("keeps all 12 category colours perceptually distinct in both appearances", () => {
    for (const mode of ["lightHex", "darkHex"] as const) {
      for (let firstIndex = 0; firstIndex < DAYFRAME_PALETTE.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < DAYFRAME_PALETTE.length; secondIndex += 1) {
          const first = DAYFRAME_PALETTE[firstIndex];
          const second = DAYFRAME_PALETTE[secondIndex];
          expect(
            oklabDistance(first[mode], second[mode]),
            `${first.label} and ${second.label} are too similar in ${mode}`
          ).toBeGreaterThanOrEqual(0.09);
        }
      }
    }
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

function oklabDistance(first: string, second: string) {
  const firstLab = oklab(first);
  const secondLab = oklab(second);
  return Math.hypot(
    firstLab[0] - secondLab[0],
    firstLab[1] - secondLab[1],
    firstLab[2] - secondLab[2]
  );
}

function oklab(hex: string): [number, number, number] {
  const [red, green, blue] = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}
