import { describe, expect, it } from "vitest";
import { clampSettingsScrollOffset, settingsScrollNeedsClamp } from "./settingsScroll";

describe("settings scroll offset", () => {
  it("clamps reused offsets into a shorter section", () => {
    expect(clampSettingsScrollOffset(1200, 760, 700)).toBe(60);
    expect(settingsScrollNeedsClamp(1200, 760, 700)).toBe(true);
  });

  it("returns to top when content fits the viewport", () => {
    expect(clampSettingsScrollOffset(400, 600, 700)).toBe(0);
    expect(clampSettingsScrollOffset(-20, 1200, 700)).toBe(0);
  });

  it("keeps an already-valid category offset stable", () => {
    expect(clampSettingsScrollOffset(360, 1400, 700)).toBe(360);
    expect(settingsScrollNeedsClamp(360, 1400, 700)).toBe(false);
  });
});
