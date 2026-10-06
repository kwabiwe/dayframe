import { paletteColorFor, paletteKeyFor, type DayframePaletteKey } from "./palette";
import type { DayframeThemeMode } from "./theme";

// Dayframe Blocks tokens shared by web and iOS. See docs/brand-style-guide.md (Dayframe Blocks).
export const DAYFRAME_BLOCKS = {
  // Text and icons on a solid activity block are white or deep ink, whichever measures higher.
  onBlock: { white: "#FFFFFF", ink: "#0B1020" },
  radius: { chip: 8, block: 10, card: 20, sheet: 28, pill: 999 },
  minimumTextContrast: 4.5
} as const;

export type DayframeOnBlockColor = (typeof DAYFRAME_BLOCKS.onBlock)[keyof typeof DAYFRAME_BLOCKS.onBlock];

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The measured on-block text colour for an activity colour in one theme. */
export function onBlockTextColor(value: unknown, mode: DayframeThemeMode, fallbackSeed = ""): DayframeOnBlockColor {
  const fill = paletteColorFor(value, fallbackSeed, mode);
  const { white, ink } = DAYFRAME_BLOCKS.onBlock;
  return contrastRatio(fill, white) >= contrastRatio(fill, ink) ? white : ink;
}

/** Fill and text for a solid activity block, from a stored key or legacy colour. */
export function blockColorsFor(value: unknown, mode: DayframeThemeMode, fallbackSeed = "") {
  const key: DayframePaletteKey = paletteKeyFor(value, fallbackSeed);
  return { fill: paletteColorFor(key, "", mode), text: onBlockTextColor(key, mode) };
}

function relativeLuminance(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Expected a #RRGGBB colour, received ${hex}`);
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
