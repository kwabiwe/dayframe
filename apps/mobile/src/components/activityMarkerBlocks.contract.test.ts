import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X3 (owner, Trello): iPhone activity markers are small rounded-square blocks, never round dots.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("iPhone activity markers are blocks (X3)", () => {
  it.each([
    ["./settings/ActivityEditorSheet.tsx", "swatch: { borderColor: \"transparent\", borderRadius: activityMarkerRadius(36), borderWidth: 0, height: 36, width: 36 }"]
  ])("%s uses the shared block marker radius", (path, rule) => {
    expect(read(path)).toContain(rule);
  });

  it("Location evidence draws the entry sheet's activity chips (icon on a tint), not dots of its own", () => {
    const editor = read("./location/LocationReviewCorrectionEditor.tsx");
    expect(editor).toContain("<ActivityChip");
    expect(editor).not.toMatch(/dot: \{ width: 8/);
  });

  it("native Calendar weekday activity bars use the block corner, not a capsule", () => {
    const swift = read("../../modules/dayframe-calendar/ios/DayframeCalendarRootView.swift");
    expect(swift).toMatch(/RoundedRectangle\(cornerRadius: 1\.2, style: \.continuous\)\s*\.fill\(Color\(dayframeCSS: color\)\)\s*\.frame\(width: 5, height: 4\)/);
    expect(swift).not.toMatch(/RoundedRectangle\(cornerRadius: 2, style: \.continuous\)\s*\.fill\(Color\(dayframeCSS: color\)\)\s*\.frame\(width: 5, height: 4\)/);
    expect(1.2).toBeCloseTo(4 * 0.3);
  });
});
