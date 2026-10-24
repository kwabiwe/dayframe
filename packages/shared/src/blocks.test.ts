import { describe, expect, it } from "vitest";
import {
  activityMarkerRadius,
  DAYFRAME_BLOCKS,
  DAYFRAME_PALETTE,
  DAYFRAME_PALETTE_PICKER_KEYS,
  DAYFRAME_THEME,
  ACTIVITY_CONTROL_MINIMUM_CONTRAST,
  activityControlColor,
  blockColorsFor,
  calendarBlockInk,
  calendarNestedBase,
  CALENDAR_V3_TINT,
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
        if (ratio < DAYFRAME_BLOCKS.minimumTextContrast) failures.push(`${color.key} ${mode} ${fill} on ${text}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("gives the dial's ring and knobs 3:1 against the track and the sheet in both themes", () => {
    for (const color of DAYFRAME_PALETTE) {
      for (const mode of modes) {
        // The dial's track (muted in Light, inset in Dark) and the sheet.
        const track = mode === "dark" ? DAYFRAME_THEME[mode].surfaceInset : DAYFRAME_THEME[mode].surfaceMuted;
        const backgrounds = [track, DAYFRAME_THEME[mode].surfaceRaised];
        const ring = activityControlColor(color.key, mode, backgrounds);
        for (const background of backgrounds) {
          expect(contrastRatio(ring, background), `${color.key} ${mode} ${ring} on ${background}`).toBeGreaterThanOrEqual(ACTIVITY_CONTROL_MINIMUM_CONTRAST);
        }
        const fill = mode === "light" ? color.lightHex : color.darkHex;
        // A colour that already measures 3:1 is used unchanged.
        if (backgrounds.every((background) => contrastRatio(fill, background) >= ACTIVITY_CONTROL_MINIMUM_CONTRAST)) {
          expect(ring.toLowerCase()).toBe(fill.toLowerCase());
        }
      }
    }
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

  it("keeps every stored identity value unchanged and resolving to its own key", () => {
    expect(Object.fromEntries(DAYFRAME_PALETTE.map((color) => [color.key, color.hex]))).toEqual({
      "mint-soft": "#BAF3DB", "yellow-soft": "#F8E6A0", "orange-soft": "#FEDEC8", "red-soft": "#FFD5D2", "violet-soft": "#DFD8FD",
      lime: "#4BCE97", amber: "#F5CD47", orange: "#FEA362", red: "#F87168", purple: "#9F8FEF",
      green: "#1F845A", olive: "#946F00", rust: "#C25100", crimson: "#C9372C", violet: "#6E5DC6",
      "blue-soft": "#CCE0FF", "sky-soft": "#C6EDFB", "lime-soft": "#D3F1A7", "rose-soft": "#FDD0EC", "steel-soft": "#DCDFE4",
      blue: "#579DFF", sky: "#6CC3E0", chartreuse: "#94C748", rose: "#E774BB", steel: "#8590A2",
      "blue-bold": "#0C66E4", teal: "#227D9B", moss: "#5B7F24", magenta: "#AE4787", graphite: "#626F86"
    });
    const all = DAYFRAME_PALETTE.flatMap((color) => [color.hex, color.lightHex, color.darkHex].map((hex) => hex.toLowerCase()));
    expect(new Set(all).size).toBe(90);
    for (const color of DAYFRAME_PALETTE) expect(paletteKeyFor(color.hex)).toBe(color.key);
  });

  it("keeps every pair of activity colours distinguishable within a theme", () => {
    const close: string[] = [];
    for (const mode of modes) {
      for (let first = 0; first < DAYFRAME_PALETTE.length; first += 1) {
        for (let second = first + 1; second < DAYFRAME_PALETTE.length; second += 1) {
          const a = DAYFRAME_PALETTE[first];
          const b = DAYFRAME_PALETTE[second];
          const distance = deltaE2000(display(a, mode), display(b, mode));
          if (distance < 9.5) close.push(`${mode} ${a.key}/${b.key} ${distance.toFixed(1)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("keeps every activity colour clearly apart from live coral", () => {
    const close: string[] = [];
    for (const mode of modes) {
      for (const color of DAYFRAME_PALETTE) {
        const distance = deltaE2000(display(color, mode), DAYFRAME_THEME[mode].accent);
        if (distance < 10) close.push(`${mode} ${color.key} ${distance.toFixed(1)}`);
      }
    }
    expect(close).toEqual([]);
  });

  it("keeps each picker hue family ordered light to dark in both themes", () => {
    const columns = [0, 1, 2, 3, 4].flatMap((column) => [
      [0, 1, 2].map((row) => DAYFRAME_PALETTE_PICKER_KEYS[row * 5 + column]),
      [3, 4, 5].map((row) => DAYFRAME_PALETTE_PICKER_KEYS[row * 5 + column])
    ]);
    for (const mode of modes) {
      for (const family of columns) {
        const lightness = family.map((key) => labLightness(display(DAYFRAME_PALETTE.find((color) => color.key === key)!, mode)));
        expect(lightness[0], `${mode} ${family.join(">")}`).toBeGreaterThan(lightness[1]);
        expect(lightness[1], `${mode} ${family.join(">")}`).toBeGreaterThan(lightness[2]);
      }
    }
  });

  it("returns the fill and text pair for any stored or legacy value", () => {
    expect(blockColorsFor("blue", "dark")).toEqual({ fill: "#3B8BF6", text: DAYFRAME_BLOCKS.onBlock.ink });
    expect(blockColorsFor("#2563eb", "light")).toEqual(blockColorsFor("blue", "light"));
  });

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("shapes activity markers as small rounded squares, never round dots (X3)", () => {
    expect(activityMarkerRadius(10)).toBe(3);
    expect(activityMarkerRadius(8)).toBe(2.5);
    expect(activityMarkerRadius(12)).toBeLessThan(12 / 2);
  });

  it("defines the Blocks radius scale", () => {
    expect(DAYFRAME_BLOCKS.radius).toEqual({ chip: 8, block: 10, card: 20, phoneCard: 22, sheet: 28, pill: 999 });
  });
});

function display(color: (typeof DAYFRAME_PALETTE)[number], mode: (typeof modes)[number]) {
  return mode === "light" ? color.lightHex : color.darkHex;
}

function toLab(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as const;
}

function labLightness(hex: string) {
  return toLab(hex)[0];
}

// CIEDE2000 colour difference (Sharma, Wu and Dalal, 2005).
function deltaE2000(first: string, second: string) {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  const rad = Math.PI / 180;
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => { const angle = Math.atan2(b, a) / rad; return angle < 0 ? angle + 360 : angle; };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  let dh = h2p - h1p;
  if (c1p * c2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = l2 - l1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * rad) / 2);
  const meanL = (l1 + l2) / 2;
  const meanCp = (c1p + c2p) / 2;
  let meanH = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) meanH = meanH < 360 ? meanH + 360 : meanH - 360;
    meanH /= 2;
  }
  const t = 1 - 0.17 * Math.cos((meanH - 30) * rad) + 0.24 * Math.cos(2 * meanH * rad)
    + 0.32 * Math.cos((3 * meanH + 6) * rad) - 0.2 * Math.cos((4 * meanH - 63) * rad);
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt = -2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((meanH - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

describe("calendarBlockInk (Calendar v3)", () => {
  it("meets AA on the tint, the Reduce Transparency tint and a nested tint for every palette colour in both themes", () => {
    for (const mode of modes) {
      const theme = DAYFRAME_THEME[mode];
      for (const colour of DAYFRAME_PALETTE) {
        const fill = mode === "dark" ? colour.darkHex : colour.lightHex;
        for (const review of [false, true]) {
          const ink = calendarBlockInk(fill, mode, { background: theme.background, surface: theme.surface, review });
          const tint = review ? (mode === "dark" ? CALENDAR_V3_TINT.reviewDark : CALENDAR_V3_TINT.reviewLight) : (mode === "dark" ? CALENDAR_V3_TINT.dark : CALENDAR_V3_TINT.light);
          const over = (base: string, amount: number) => mix(base, fill, amount);
          for (const surface of [over(theme.background, tint), over(theme.surface, tint + CALENDAR_V3_TINT.reduceTransparencyBoost), mix(calendarNestedBase(over(theme.background, tint), theme.background), fill, tint)]) {
            expect(contrastRatio(ink, surface), `${colour.key} ${mode}${review ? " review" : ""}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("meets AA when nested over a block of any other colour, three levels deep (Codex r6 on #580)", () => {
    for (const mode of modes) {
      const theme = DAYFRAME_THEME[mode];
      const tint = mode === "dark" ? CALENDAR_V3_TINT.dark : CALENDAR_V3_TINT.light;
      const fills = [...DAYFRAME_PALETTE.map((colour) => (mode === "dark" ? colour.darkHex : colour.lightHex)), mode === "dark" ? "#323946" : "#EEF2F6"];
      const onCanvas = fills.map((fill) => mix(theme.background, fill, tint));
      const nestedOn = (under: string, fill: string) => mix(calendarNestedBase(under, theme.background), fill, tint);
      const level2 = onCanvas.flatMap((under) => fills.map((fill) => nestedOn(under, fill)));
      // A sample of the third level keeps the run short; the wash brings deeper levels closer to the canvas.
      const level3 = level2.filter((_, index) => index % 7 === 0).flatMap((under) => fills.filter((_, index) => index % 5 === 0).map((fill) => nestedOn(under, fill)));
      for (const fill of fills) {
        const ink = calendarBlockInk(fill, mode, { background: theme.background, surface: theme.surface });
        for (const under of [...onCanvas, ...level2, ...level3]) {
          expect(contrastRatio(ink, nestedOn(under, fill)), `${fill} ${mode} over ${under}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  }, 60_000);

  it("is cheap enough to run per block on every render", () => {
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      calendarBlockInk(`#${(0x204060 + index * 4111).toString(16).padStart(6, "0").slice(-6)}`, index % 2 ? "dark" : "light", { background: "#F4F6F9", surface: "#FFFFFF" });
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps the block's own hue: a darker shade in light mode, a lighter one in dark", () => {
    const light = calendarBlockInk("#2D7CEB", "light", { background: "#F4F6F9", surface: "#FFFFFF" });
    const dark = calendarBlockInk("#3B8BF6", "dark", { background: "#050914", surface: "#151B27" });
    // Darker than the colour itself in light mode, lighter in dark, and still blue (blue the largest channel).
    expect(contrastRatio(light, "#FFFFFF")).toBeGreaterThan(contrastRatio("#2D7CEB", "#FFFFFF"));
    expect(contrastRatio(dark, "#000000")).toBeGreaterThan(contrastRatio("#3B8BF6", "#000000"));
    for (const ink of [light, dark]) {
      const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(ink.slice(offset, offset + 2), 16));
      expect(blue).toBeGreaterThan(Math.max(red, green));
    }
  });
});

function mix(from: string, to: string, amount: number) {
  const channels = (hex: string) => [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16));
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
