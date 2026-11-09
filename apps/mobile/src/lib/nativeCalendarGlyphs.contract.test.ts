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
    // The header's one-tap toggle shows where it goes (owner item J), and the icon lines under a block's title.
    expect(rootView).toContain('DayframeCalendarGlyph(name: presentation.isList ? "view-day" : "view-list"');
    expect(rootView).toContain('.accessibilityLabel(presentation.isList ? "Show as day" : "Show as list")');
    expect(rootView).toContain("DayframeCalendarGlyph(name: detailGlyph(detail.glyph), size: iconSize, followsTextSize: false)");

    const manifest = JSON.parse(readFileSync(`${iosRoot}Glyphs/manifest.json`, "utf8")) as Record<string, { glyph: string }>;
    // Plus every activity glyph as "activity-<glyph>" (location v4 C6: icon-only narrow columns).
    const own = Object.fromEntries(Object.entries(manifest).filter(([key]) => !key.startsWith("activity-")).map(([key, value]) => [key, value.glyph]));
    expect(Object.entries(manifest).filter(([key]) => key.startsWith("activity-")).every(([key, value]) => key === `activity-${value.glyph}`)).toBe(true);
    expect(own).toEqual({
      check: "check",
      health: "heart-pulse",
      place: "map-pin",
      tag: "tag",
      time: "clock",
      trip: "route",
      "view-day": "calendar-days",
      "view-list": "list"
    });
    for (const stem of Object.keys(manifest)) {
      for (const suffix of ["", "@2x", "@3x"]) expect(existsSync(`${iosRoot}Glyphs/${stem}${suffix}.png`)).toBe(true);
    }
    const podspec = readFileSync(`${iosRoot}DayframeCalendar.podspec`, "utf8");
    expect(podspec).toContain("s.resource_bundles = { 'DayframeCalendarGlyphs' => ['Glyphs/*.png'] }");
  });
});
