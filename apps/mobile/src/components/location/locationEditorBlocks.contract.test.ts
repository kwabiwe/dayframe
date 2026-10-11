import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const editor = readFileSync(resolve(__dirname, "LocationReviewCorrectionEditor.tsx"), "utf8");
const screen = readFileSync(resolve(__dirname, "../../../app/review/[id].tsx"), "utf8");

describe("Location evidence editor in Blocks (UIA-027)", () => {
  it("selects neutrally and draws neutral map marks, never coral", () => {
    expect(editor).not.toMatch(/theme\.accent(Text|Soft)?\b/);
    expect(editor).toContain("accentColor={theme.textPrimary}");
    expect(editor).toContain('appearance={theme.mode === "dark" ? "dark" : "light"}');
    expect(editor).toContain("{ backgroundColor: selected ? theme.textPrimary : theme.surfaceMuted }");
  });

  it("uses the shared Settings switch and no spinner", () => {
    expect(editor).not.toMatch(/<Switch\b/);
    expect(editor).toContain('label="Save for future visits"');
    expect(screen).not.toContain("ActivityIndicator");
    expect(screen).toContain("Loading private map evidence…");
  });
});
