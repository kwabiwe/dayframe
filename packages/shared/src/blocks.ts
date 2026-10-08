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

/** Non-text contrast (WCAG 1.4.11) for a thin activity-coloured control such as a ring or knob. */
export const ACTIVITY_CONTROL_MINIMUM_CONTRAST = 3;

/**
 * An activity colour for a thin control (the duration dial's ring and knobs): the display colour
 * when it measures at least 3:1 against every background it sits on, otherwise that colour
 * deepened toward deep ink (light theme) or lifted toward white (dark) just until it does.
 */
export function activityControlColor(value: unknown, mode: DayframeThemeMode, backgrounds: readonly string[], fallbackSeed = "") {
  const fill = paletteColorFor(value, fallbackSeed, mode);
  const toward = mode === "light" ? DAYFRAME_BLOCKS.onBlock.ink : DAYFRAME_BLOCKS.onBlock.white;
  for (let step = 0; step <= 20; step += 1) {
    const color = mixHex(fill, toward, step / 20);
    if (backgrounds.every((background) => contrastRatio(color, background) >= ACTIVITY_CONTROL_MINIMUM_CONTRAST)) return color;
  }
  return toward;
}

function mixHex(from: string, to: string, amount: number) {
  const channels = (hex: string) => [0, 2, 4].map((offset) => Number.parseInt(hex.replace("#", "").slice(offset, offset + 2), 16));
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
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
