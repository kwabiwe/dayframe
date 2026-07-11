import { describe, expect, it } from "vitest";
import { createNavigationColors } from "./navigationTheme";

describe("createNavigationColors", () => {
  it.each([
    ["dark", "#050914", "#1B2230", "#F7F8FC", "#2D394B"],
    ["light", "#F4F6F8", "#FFFFFF", "#111827", "#D6DCE5"]
  ] as const)("keeps the %s native scene on the resolved canvas", (mode, background, card, text, border) => {
    const theme = {
      accent: "#FF6B5F",
      background,
      surfaceRaised: card,
      textPrimary: text,
      border
    };

    expect(createNavigationColors(theme)).toEqual({
      primary: "#FF6B5F",
      background,
      card,
      text,
      border,
      notification: "#FF6B5F"
    });
  });
});
