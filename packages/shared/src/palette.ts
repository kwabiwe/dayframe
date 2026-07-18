import type { DayframeThemeMode } from "./theme";

// Keep this order stable: it is part of the deterministic fallback mapping.
export const DAYFRAME_PALETTE = [
  { key: "lime", label: "Mint", hex: "#3ED598", lightHex: "#23A65C", darkHex: "#3ED598" },
  { key: "teal", label: "Teal", hex: "#12B8B0", lightHex: "#008A83", darkHex: "#12B8B0" },
  { key: "sky", label: "Sky", hex: "#71C5F4", lightHex: "#269ED1", darkHex: "#71C5F4" },
  { key: "blue", label: "Blue", hex: "#416FE3", lightHex: "#3154C8", darkHex: "#416FE3" },
  { key: "violet", label: "Violet", hex: "#8D63E6", lightHex: "#7A45C7", darkHex: "#8D63E6" },
  { key: "rose", label: "Rose", hex: "#DF5FA8", lightHex: "#C83C83", darkHex: "#DF5FA8" },
  { key: "amber", label: "Amber", hex: "#F2C14E", lightHex: "#C89100", darkHex: "#F2C14E" },
  { key: "orange", label: "Orange", hex: "#D98235", lightHex: "#C7651A", darkHex: "#D98235" },
  { key: "red", label: "Coral", hex: "#FF6248", lightHex: "#F45D43", darkHex: "#FF6248" },
  { key: "steel", label: "Steel", hex: "#9AA8BC", lightHex: "#738196", darkHex: "#9AA8BC" },
  { key: "moss", label: "Moss", hex: "#8FA84A", lightHex: "#6F8425", darkHex: "#8FA84A" },
  { key: "graphite", label: "Graphite", hex: "#4C586C", lightHex: "#3E4859", darkHex: "#4C586C" }
] as const;

export type DayframePaletteKey = (typeof DAYFRAME_PALETTE)[number]["key"];

export const DEFAULT_PALETTE_KEY: DayframePaletteKey = "lime";

const legacyColorMap: Record<string, DayframePaletteKey> = {
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
  return `var(--palette-${paletteKeyFor(value, fallbackSeed)})`;
}

export function deterministicPaletteIndex(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % DAYFRAME_PALETTE.length;
}
