import type { DayframeThemeMode } from "./theme";

// Keep this order stable: it is part of the deterministic fallback mapping.
export const DAYFRAME_PALETTE = [
  { key: "mint-soft", label: "Mint light", hex: "#BAF3DB", lightHex: "#BAF3DB", darkHex: "#BAF3DB" },
  { key: "yellow-soft", label: "Yellow light", hex: "#F8E6A0", lightHex: "#F8E6A0", darkHex: "#F8E6A0" },
  { key: "orange-soft", label: "Orange light", hex: "#FEDEC8", lightHex: "#FEDEC8", darkHex: "#FEDEC8" },
  { key: "red-soft", label: "Red light", hex: "#FFD5D2", lightHex: "#FFD5D2", darkHex: "#FFD5D2" },
  { key: "violet-soft", label: "Purple light", hex: "#DFD8FD", lightHex: "#DFD8FD", darkHex: "#DFD8FD" },
  { key: "lime", label: "Green", hex: "#4BCE97", lightHex: "#4BCE97", darkHex: "#4BCE97" },
  { key: "amber", label: "Yellow", hex: "#F5CD47", lightHex: "#F5CD47", darkHex: "#F5CD47" },
  { key: "orange", label: "Orange", hex: "#FEA362", lightHex: "#FEA362", darkHex: "#FEA362" },
  { key: "red", label: "Red", hex: "#F87168", lightHex: "#F87168", darkHex: "#F87168" },
  { key: "purple", label: "Purple", hex: "#9F8FEF", lightHex: "#9F8FEF", darkHex: "#9F8FEF" },
  { key: "green", label: "Green", hex: "#1F845A", lightHex: "#1F845A", darkHex: "#1F845A" },
  { key: "olive", label: "Olive", hex: "#946F00", lightHex: "#946F00", darkHex: "#946F00" },
  { key: "rust", label: "Rust", hex: "#C25100", lightHex: "#C25100", darkHex: "#C25100" },
  { key: "crimson", label: "Crimson", hex: "#C9372C", lightHex: "#C9372C", darkHex: "#C9372C" },
  { key: "violet", label: "Violet", hex: "#6E5DC6", lightHex: "#6E5DC6", darkHex: "#6E5DC6" },
  { key: "blue-soft", label: "Blue light", hex: "#CCE0FF", lightHex: "#CCE0FF", darkHex: "#CCE0FF" },
  { key: "sky-soft", label: "Sky light", hex: "#C6EDFB", lightHex: "#C6EDFB", darkHex: "#C6EDFB" },
  { key: "lime-soft", label: "Lime light", hex: "#D3F1A7", lightHex: "#D3F1A7", darkHex: "#D3F1A7" },
  { key: "rose-soft", label: "Pink light", hex: "#FDD0EC", lightHex: "#FDD0EC", darkHex: "#FDD0EC" },
  { key: "steel-soft", label: "Grey light", hex: "#DCDFE4", lightHex: "#DCDFE4", darkHex: "#DCDFE4" },
  { key: "blue", label: "Blue", hex: "#579DFF", lightHex: "#579DFF", darkHex: "#579DFF" },
  { key: "sky", label: "Sky", hex: "#6CC3E0", lightHex: "#6CC3E0", darkHex: "#6CC3E0" },
  { key: "chartreuse", label: "Lime", hex: "#94C748", lightHex: "#94C748", darkHex: "#94C748" },
  { key: "rose", label: "Pink", hex: "#E774BB", lightHex: "#E774BB", darkHex: "#E774BB" },
  { key: "steel", label: "Grey", hex: "#8590A2", lightHex: "#8590A2", darkHex: "#8590A2" },
  { key: "blue-bold", label: "Blue bold", hex: "#0C66E4", lightHex: "#0C66E4", darkHex: "#0C66E4" },
  { key: "teal", label: "Teal", hex: "#227D9B", lightHex: "#227D9B", darkHex: "#227D9B" },
  { key: "moss", label: "Moss", hex: "#5B7F24", lightHex: "#5B7F24", darkHex: "#5B7F24" },
  { key: "magenta", label: "Magenta", hex: "#AE4787", lightHex: "#AE4787", darkHex: "#AE4787" },
  { key: "graphite", label: "Graphite", hex: "#626F86", lightHex: "#626F86", darkHex: "#626F86" }
] as const;

export type DayframePaletteKey = (typeof DAYFRAME_PALETTE)[number]["key"];

export const DEFAULT_PALETTE_KEY: DayframePaletteKey = "lime";

const legacyColorMap: Record<string, DayframePaletteKey> = {
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
