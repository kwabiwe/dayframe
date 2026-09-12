import { describe, expect, it } from "vitest";
import { MOBILE_TEXT_CAP, mobileTextProps } from "./mobileTypography";

describe("scoped mobile typography roles", () => {
  it("keeps system scaling enabled and applies the documented per-role cap", () => {
    for (const [role, cap] of Object.entries(MOBILE_TEXT_CAP)) {
      expect(mobileTextProps(role as keyof typeof MOBILE_TEXT_CAP)).toEqual({
        allowFontScaling: true,
        maxFontSizeMultiplier: cap,
      });
    }
    expect(mobileTextProps("body").maxFontSizeMultiplier).toBe(0);
  });
});
