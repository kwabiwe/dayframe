import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const iosRoot = fileURLToPath(new URL("../../modules/dayframe-calendar/ios/", import.meta.url));
const swiftSources = readdirSync(iosRoot)
  .filter((name) => name.endsWith(".swift"))
  .map((name) => [name, readFileSync(`${iosRoot}${name}`, "utf8")] as const);

describe("native Calendar draws Dayframe registry glyphs (UIA-064)", () => {
  it("uses no SF Symbols for zoom, place or tag", () => {
    for (const [name, source] of swiftSources) {
      expect(source, name).not.toContain("systemName:");
      for (const symbol of ['"plus"', '"minus"', '"mappin.and.ellipse"', '"tag.fill"']) {
        expect(source, `${name} ${symbol}`).not.toContain(symbol);
      }
    }
  });

  it("draws the bundled registry glyphs and keeps the accessibility labels", () => {
    const rootView = readFileSync(`${iosRoot}DayframeCalendarRootView.swift`, "utf8");
    expect(rootView).toContain('DayframeCalendarGlyph(name: direction > 0 ? "zoom-in" : "zoom-out"');
    expect(rootView).toContain('DayframeCalendarGlyph(name: "place"');
    expect(rootView).toContain('DayframeCalendarGlyph(name: "tag"');
    expect(rootView).toContain('.accessibilityLabel(direction > 0 ? "Zoom in" : "Zoom out")');

    const manifest = JSON.parse(readFileSync(`${iosRoot}Glyphs/manifest.json`, "utf8")) as Record<string, { glyph: string }>;
    expect(Object.fromEntries(Object.entries(manifest).map(([key, value]) => [key, value.glyph]))).toEqual({
      place: "map-pin",
      tag: "tag",
      "zoom-in": "plus",
      "zoom-out": "minus"
    });
    for (const stem of Object.keys(manifest)) {
      for (const suffix of ["", "@2x", "@3x"]) expect(existsSync(`${iosRoot}Glyphs/${stem}${suffix}.png`)).toBe(true);
    }
    const podspec = readFileSync(`${iosRoot}DayframeCalendar.podspec`, "utf8");
    expect(podspec).toContain("s.resource_bundles = { 'DayframeCalendarGlyphs' => ['Glyphs/*.png'] }");
  });
});
