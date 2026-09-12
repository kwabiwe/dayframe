import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Reports maximum-text contracts", () => {
  it("keeps the shared staging badge compact, unshrunk and fully spoken", () => {
    const dashboard = fs.readFileSync(
      new URL("../DayframeDashboard.tsx", import.meta.url),
      "utf8",
    );
    const theme = fs.readFileSync(
      new URL("../../lib/mobileTheme.ts", import.meta.url),
      "utf8",
    );
    expect(dashboard).toContain("maxFontSizeMultiplier={1}");
    expect(dashboard).toContain("numberOfLines={1}");
    expect(dashboard).toContain('accessibilityLabel="Staging environment"');
    expect(theme).toMatch(
      /environmentBadge:\s*\{[\s\S]*?lineHeight: 12,[\s\S]*?flexShrink: 0,/,
    );
  });

  it("gives the Reports title an explicit line box without removing scaling", () => {
    const theme = fs.readFileSync(
      new URL("../../lib/mobileTheme.ts", import.meta.url),
      "utf8",
    );
    expect(theme).toMatch(
      /reportScreenTitle:\s*\{[\s\S]*?fontSize: 28,[\s\S]*?lineHeight: 36,[\s\S]*?paddingVertical: 1,/,
    );
  });
});
