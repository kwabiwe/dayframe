import type { DayframeThemeMode } from "./theme";

// Keep this order stable: it is part of the deterministic fallback mapping.
export const DAYFRAME_PALETTE = [
  { key: "lime", label: "Mint", hex: "#39D99A", lightHex: "#20B978", darkHex: "#39D99A" },
  { key: "teal", label: "Teal", hex: "#24C7B1", lightHex: "#0FAF9B", darkHex: "#24C7B1" },
  { key: "sky", label: "Sky", hex: "#63B3FF", lightHex: "#5AA7EE", darkHex: "#63B3FF" },
  { key: "blue", label: "Blue", hex: "#4B93F5", lightHex: "#3B82F6", darkHex: "#4B93F5" },
  { key: "violet", label: "Violet", hex: "#7D6EE6", lightHex: "#7564E8", darkHex: "#7D6EE6" },
  { key: "rose", label: "Rose", hex: "#E87AAE", lightHex: "#D95F99", darkHex: "#E87AAE" },
  { key: "amber", label: "Amber", hex: "#F2BA38", lightHex: "#E8A91E", darkHex: "#F2BA38" },
  { key: "orange", label: "Orange", hex: "#FF934F", lightHex: "#E9792F", darkHex: "#FF934F" },
  { key: "red", label: "Coral", hex: "#FF6248", lightHex: "#F45D43", darkHex: "#FF6248" },
  { key: "steel", label: "Steel", hex: "#7F91AB", lightHex: "#65758B", darkHex: "#7F91AB" },
  { key: "moss", label: "Moss", hex: "#7FB36A", lightHex: "#5F944D", darkHex: "#7FB36A" },
  { key: "graphite", label: "Graphite", hex: "#566176", lightHex: "#475569", darkHex: "#566176" }
] as const;

export type DayframePaletteKey = (typeof DAYFRAME_PALETTE)[number]["key"];

export const DEFAULT_PALETTE_KEY: DayframePaletteKey = "lime";

const legacyColorMap: Record<string, DayframePaletteKey> = {
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
