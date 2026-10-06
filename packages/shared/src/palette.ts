import type { DayframeThemeMode } from "./theme";

// Keep this order stable: it is part of the deterministic fallback mapping.
// `hex` is the stored identity value. `lightHex`/`darkHex` are the Dayframe Blocks
// display values for each theme; text on them comes from `onBlockTextColor`.
export const DAYFRAME_PALETTE = [
  { key: "mint-soft", label: "Mint light", hex: "#BAF3DB", lightHex: "#A8EBCD", darkHex: "#B6F0D6" },
  { key: "yellow-soft", label: "Yellow light", hex: "#F8E6A0", lightHex: "#F5DC85", darkHex: "#F8E39A" },
  { key: "orange-soft", label: "Orange light", hex: "#FEDEC8", lightHex: "#FDCDAD", darkHex: "#FFD9BF" },
  { key: "red-soft", label: "Red light", hex: "#FFD5D2", lightHex: "#FFC3BE", darkHex: "#FFD0CC" },
  { key: "violet-soft", label: "Purple light", hex: "#DFD8FD", lightHex: "#D2C8FC", darkHex: "#DCD4FE" },
  { key: "lime", label: "Green", hex: "#4BCE97", lightHex: "#0FBF95", darkHex: "#16D2A6" },
  { key: "amber", label: "Yellow", hex: "#F5CD47", lightHex: "#F5AE00", darkHex: "#FFBD1F" },
  { key: "orange", label: "Orange", hex: "#FEA362", lightHex: "#F57A2A", darkHex: "#FF8A3D" },
  { key: "red", label: "Red", hex: "#F87168", lightHex: "#EE5446", darkHex: "#FF6A5E" },
  { key: "purple", label: "Purple", hex: "#9F8FEF", lightHex: "#9277F0", darkHex: "#B39BFF" },
  { key: "green", label: "Green", hex: "#1F845A", lightHex: "#13804F", darkHex: "#1E9C68" },
  { key: "olive", label: "Olive", hex: "#946F00", lightHex: "#8F6B08", darkHex: "#B58A12" },
  { key: "rust", label: "Rust", hex: "#C25100", lightHex: "#CC5F27", darkHex: "#E2733A" },
  { key: "crimson", label: "Crimson", hex: "#C9372C", lightHex: "#B93228", darkHex: "#C93A30" },
  { key: "violet", label: "Violet", hex: "#6E5DC6", lightHex: "#6A48E0", darkHex: "#7552E8" },
  { key: "blue-soft", label: "Blue light", hex: "#CCE0FF", lightHex: "#B8D2FF", darkHex: "#C8DCFF" },
  { key: "sky-soft", label: "Sky light", hex: "#C6EDFB", lightHex: "#ACE2F7", darkHex: "#C0EAFA" },
  { key: "lime-soft", label: "Lime light", hex: "#D3F1A7", lightHex: "#C3E98A", darkHex: "#D0EFA0" },
  { key: "rose-soft", label: "Pink light", hex: "#FDD0EC", lightHex: "#FBBDE2", darkHex: "#FDCCEA" },
  { key: "steel-soft", label: "Grey light", hex: "#DCDFE4", lightHex: "#CDD2DB", darkHex: "#D8DCE3" },
  { key: "blue", label: "Blue", hex: "#579DFF", lightHex: "#2D7CEB", darkHex: "#3B8BF6" },
  { key: "sky", label: "Sky", hex: "#6CC3E0", lightHex: "#1FB2DC", darkHex: "#38C6EE" },
  { key: "chartreuse", label: "Lime", hex: "#94C748", lightHex: "#8CBE22", darkHex: "#A6D63B" },
  { key: "rose", label: "Pink", hex: "#E774BB", lightHex: "#F0468F", darkHex: "#FF5CA8" },
  { key: "steel", label: "Grey", hex: "#8590A2", lightHex: "#A2A9B8", darkHex: "#B9BFCC" },
  { key: "blue-bold", label: "Blue bold", hex: "#0C66E4", lightHex: "#3654D6", darkHex: "#4466EE" },
  { key: "teal", label: "Teal", hex: "#227D9B", lightHex: "#0F8E9C", darkHex: "#14A6B6" },
  { key: "moss", label: "Moss", hex: "#5B7F24", lightHex: "#6A9A38", darkHex: "#7FB24A" },
  { key: "magenta", label: "Magenta", hex: "#AE4787", lightHex: "#C435A7", darkHex: "#E04CC2" },
  { key: "graphite", label: "Graphite", hex: "#626F86", lightHex: "#66719A", darkHex: "#7C86A8" }
] as const;

export type DayframePaletteKey = (typeof DAYFRAME_PALETTE)[number]["key"];

// Picker presentation is intentionally separate from DAYFRAME_PALETTE's stable
// fallback order. Five columns produce two blocks of five hue families, with
// each family reading light-to-dark down the column.
export const DAYFRAME_PALETTE_PICKER_KEYS = [
  "mint-soft", "yellow-soft", "orange-soft", "red-soft", "violet-soft",
  "lime", "amber", "orange", "red", "purple",
  "green", "olive", "rust", "crimson", "violet",
  "blue-soft", "sky-soft", "lime-soft", "rose-soft", "steel-soft",
  "blue", "sky", "chartreuse", "rose", "steel",
  "blue-bold", "teal", "moss", "magenta", "graphite"
] as const satisfies readonly DayframePaletteKey[];

export const DAYFRAME_PALETTE_PICKER = DAYFRAME_PALETTE_PICKER_KEYS.map((key) => {
  const color = DAYFRAME_PALETTE.find((candidate) => candidate.key === key);
  if (!color) throw new Error(`Missing Dayframe palette colour: ${key}`);
  return color;
});

export const DEFAULT_PALETTE_KEY: DayframePaletteKey = "lime";

const legacyColorMap: Record<string, DayframePaletteKey> = {
  "coral": "red",
  // Previous Dayframe palette. Preserve colour-family identity during migration.
  "#3ed598": "lime",
  "#23a65c": "lime",
  "#12b8b0": "teal",
  "#008a83": "teal",
  "#71c5f4": "sky",
  "#269ed1": "sky",
  "#416fe3": "blue",
  "#3154c8": "blue",
  "#8d63e6": "violet",
  "#7a45c7": "violet",
  "#df5fa8": "rose",
  "#c83c83": "rose",
  "#f2c14e": "amber",
  "#c89100": "amber",
  "#d98235": "orange",
  "#c7651a": "orange",
  "#ff6248": "red",
  "#f45d43": "red",
  "#9aa8bc": "steel",
  "#738196": "steel",
  "#8fa84a": "moss",
  "#6f8425": "moss",
  "#4c586c": "graphite",
  "#3e4859": "graphite",
  // Earlier Midnight Core display values, retained across the distinctness adjustment.
  "#39d99a": "lime",
  "#20b978": "lime",
  "#24c7b1": "teal",
  "#0faf9b": "teal",
  "#63b3ff": "sky",
  "#5aa7ee": "sky",
  "#4b93f5": "blue",
  "#3b82f6": "blue",
  "#7d6ee6": "violet",
  "#7564e8": "violet",
  "#e87aae": "rose",
  "#d95f99": "rose",
  "#f2ba38": "amber",
  "#e8a91e": "amber",
  "#ff934f": "orange",
  "#e9792f": "orange",
  "#7f91ab": "steel",
  "#65758b": "steel",
  "#7fb36a": "moss",
  "#5f944d": "moss",
  "#566176": "graphite",
  // Dayframe Soft Pop values, retained so stored legacy hex values keep their key.
  "#bfe8d9": "lime",
  "#84d8c9": "teal",
  "#8ec5f2": "sky",
  "#7fa7e8": "blue",
  "#b58ee8": "violet",
  "#e8a7bf": "rose",
  "#ffd979": "amber",
  "#ff987d": "orange",
  "#f0776b": "red",
  "#57cfc2": "steel",
  "#b7d99b": "moss",
  "#1d2638": "graphite",
  // Earlier imported and seeded values.
  "#c6ff4a": "lime",
  "#16a34a": "lime",
  "#22c55e": "lime",
  "#0f766e": "teal",
  "#14b8a6": "teal",
  "#0891b2": "sky",
  "#94bff0": "sky",
  "#2563eb": "blue",
  "#1d4ed8": "blue",
  "#82a8e8": "blue",
  "#7c3aed": "violet",
  "#9333ea": "violet",
  "#b691e6": "violet",
  "#db2777": "rose",
  "#e7a6bc": "rose",
  "#f59e0b": "amber",
  "#ffd46e": "amber",
  "#ea580c": "orange",
  "#ff9a7d": "orange",
  "#dc2626": "red",
  "#ea7a73": "red",
  "#64748b": "steel",
  "#dce1e6": "steel",
  "#475569": "graphite"
};

export function isPaletteKey(value: unknown): value is DayframePaletteKey {
  return typeof value === "string" && DAYFRAME_PALETTE.some((color) => color.key === value);
}

export function paletteKeyFor(value: unknown, fallbackSeed = ""): DayframePaletteKey {
  if (isPaletteKey(value)) return value;

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    const legacyKey = legacyColorMap[normalizedValue];
    if (legacyKey) return legacyKey;

    const paletteColor = DAYFRAME_PALETTE.find((color) =>
      [color.hex, color.lightHex, color.darkHex].some(
        (hex) => hex.toLowerCase() === normalizedValue
      )
    );
    if (paletteColor) return paletteColor.key;
  }

  return DAYFRAME_PALETTE[deterministicPaletteIndex(String(value ?? fallbackSeed))].key;
}

export function normalizePaletteKey(value: unknown, fallbackSeed = ""): DayframePaletteKey {
  return paletteKeyFor(value, fallbackSeed);
}

export function paletteColorFor(
  value: unknown,
  fallbackSeed = "",
  mode: DayframeThemeMode = "dark"
) {
  const key = paletteKeyFor(value, fallbackSeed);
  const color = DAYFRAME_PALETTE.find((item) => item.key === key) ?? DAYFRAME_PALETTE[0];
  return mode === "light" ? color.lightHex : color.darkHex;
}

export function paletteCssColorFor(value: unknown, fallbackSeed = "") {
  const key = paletteKeyFor(value, fallbackSeed);
  const color = DAYFRAME_PALETTE.find((item) => item.key === key) ?? DAYFRAME_PALETTE[0];
  return `light-dark(${color.lightHex}, ${color.darkHex})`;
}

export function deterministicPaletteIndex(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % DAYFRAME_PALETTE.length;
}
