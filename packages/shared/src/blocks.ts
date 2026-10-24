import { paletteColorFor, paletteKeyFor, type DayframePaletteKey } from "./palette";
import type { DayframeThemeMode } from "./theme";

// Dayframe Blocks tokens shared by web and iOS. See docs/brand-style-guide.md (Dayframe Blocks).
export const DAYFRAME_BLOCKS = {
  // Text and icons on a solid activity block are white or deep ink, whichever measures higher.
  onBlock: { white: "#FFFFFF", ink: "#0B1020" },
  // `card` is the web card; ordinary iPhone cards are 22 (the prototype's ios.html draws them at
  // 22 px against its shared 20 px token), so they read `phoneCard`. The live/idle card (26) and
  // the Review deck card (28) keep their own sizes, as in the prototype.
  radius: { chip: 8, block: 10, card: 20, phoneCard: 22, sheet: 28, pill: 999 },
  minimumTextContrast: 4.5
} as const;

/** Corner share of a small activity marker (X3): a rounded-square block, never a round dot. Web uses
 * the same 30% as `--activity-marker-radius`. */
export const ACTIVITY_MARKER_RADIUS_RATIO = 0.3;

/** Corner radius for a small activity/category marker of the given side length. */
export function activityMarkerRadius(size: number) {
  return Math.round(size * ACTIVITY_MARKER_RADIUS_RATIO * 2) / 2;
}

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

/**
 * Calendar v3 (owner, 24 Oct 2026): blocks are a translucent tint of their activity colour, opaque over
 * the surface (a little stronger) under Reduce Transparency. Suggestions are lighter.
 */
export const CALENDAR_V3_TINT = {
  light: 0.18,
  dark: 0.28,
  reviewLight: 0.1,
  reviewDark: 0.14,
  reduceTransparencyBoost: 0.1
} as const;

/**
 * Calendar v3's block text: a darker shade of the block's own hue in light mode (a lighter one in dark),
 * starting at the mock-up's 52 % / 62 % of the colour and deepened toward black (or lifted toward white)
 * just until it measures at least 4.5:1 on every surface the block can be drawn on — its tint over the
 * canvas, the opaque Reduce Transparency tint over the surface, and a nested block's tint over its
 * parent's — so titles and icon lines meet AA for every palette colour.
 */
export function calendarBlockInk(fill: string, mode: DayframeThemeMode, { background, surface, review = false }: { background: string; surface: string; review?: boolean }) {
  const tint = review
    ? (mode === "dark" ? CALENDAR_V3_TINT.reviewDark : CALENDAR_V3_TINT.reviewLight)
    : (mode === "dark" ? CALENDAR_V3_TINT.dark : CALENDAR_V3_TINT.light);
  const overCanvas = mixHex(background, fill, tint);
  const backgrounds = [
    overCanvas,
    mixHex(surface, fill, tint + CALENDAR_V3_TINT.reduceTransparencyBoost),
    mixHex(overCanvas, fill, tint)
  ];
  const toward = mode === "dark" ? "#FFFFFF" : "#000000";
  const start = mode === "dark" ? 0.38 : 0.48;
  for (let amount = start; amount < 1; amount += 0.02) {
    const color = mixHex(fill, toward, amount);
    if (backgrounds.every((candidate) => contrastRatio(color, candidate) >= DAYFRAME_BLOCKS.minimumTextContrast)) return color;
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
