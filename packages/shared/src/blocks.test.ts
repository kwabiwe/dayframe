import { describe, expect, it } from "vitest";
import {
  DAYFRAME_BLOCKS,
  DAYFRAME_PALETTE,
  blockColorsFor,
  contrastRatio,
  onBlockTextColor,
  paletteKeyFor
} from "./index";

const modes = ["light", "dark"] as const;

describe("Dayframe Blocks activity colours", () => {
  it("gives every palette entry readable on-block text in both themes", () => {
    const failures: string[] = [];
    for (const color of DAYFRAME_PALETTE) {
      for (const mode of modes) {
        const fill = mode === "light" ? color.lightHex : color.darkHex;
        const text = onBlockTextColor(color.key, mode);
        const ratio = contrastRatio(fill, text);
        if (ratio < 4.5) failures.push(`${color.key} ${mode} ${fill} on ${text}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("chooses whichever of white and deep ink measures higher", () => {
    for (const color of DAYFRAME_PALETTE) {
      for (const mode of modes) {
        const fill = mode === "light" ? color.lightHex : color.darkHex;
        const white = contrastRatio(fill, DAYFRAME_BLOCKS.onBlock.white);
        const ink = contrastRatio(fill, DAYFRAME_BLOCKS.onBlock.ink);
        expect(onBlockTextColor(color.key, mode)).toBe(white >= ink ? DAYFRAME_BLOCKS.onBlock.white : DAYFRAME_BLOCKS.onBlock.ink);
      }
    }
  });

  it("keeps per-theme display values unique so each still resolves to its stored key", () => {
    const values = DAYFRAME_PALETTE.flatMap((color) => [color.lightHex.toLowerCase(), color.darkHex.toLowerCase()]);
    expect(new Set(values).size).toBe(60);
    for (const color of DAYFRAME_PALETTE) {
      expect(paletteKeyFor(color.lightHex)).toBe(color.key);
      expect(paletteKeyFor(color.darkHex)).toBe(color.key);
    }
  });

  it("keeps the stored identity values unchanged", () => {
    expect(DAYFRAME_PALETTE.find((color) => color.key === "red")?.hex).toBe("#F87168");
    expect(DAYFRAME_PALETTE.find((color) => color.key === "lime")?.hex).toBe("#4BCE97");
  });

  it("returns the fill and text pair for any stored or legacy value", () => {
    expect(blockColorsFor("blue", "dark")).toEqual({ fill: "#3B8BF6", text: DAYFRAME_BLOCKS.onBlock.ink });
    expect(blockColorsFor("#2563eb", "light")).toEqual(blockColorsFor("blue", "light"));
  });

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("defines the Blocks radius scale", () => {
    expect(DAYFRAME_BLOCKS.radius).toEqual({ chip: 8, block: 10, card: 20, sheet: 28, pill: 999 });
  });
});
