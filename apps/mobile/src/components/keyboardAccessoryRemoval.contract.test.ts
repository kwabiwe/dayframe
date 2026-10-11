import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";

const componentRoot = fileURLToPath(new URL("./", import.meta.url));
const dashboard = readFileSync(`${componentRoot}DayframeDashboard.tsx`, "utf8");
const mobileTheme = readFileSync(`${componentRoot}../lib/mobileTheme.ts`, "utf8");

describe("auth keyboard navigation contract", () => {
  it("removes the custom keyboard accessory implementation and references", () => {
    expect(existsSync(`${componentRoot}KeyboardAccessory.tsx`)).toBe(false);
    expect(dashboard).not.toMatch(/KeyboardAccessory|inputAccessoryViewID|authKeyboard/);
  });

  it("keeps Return-key navigation and final-field submission", () => {
    expect(dashboard).toContain("onSubmitEditing={() => authWorkspaceRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={() => authEmailRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={() => authPasswordRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={submitAuth}");
    expect(dashboard).toContain('returnKeyType="done"');
    expect(dashboard).toContain('submitBehavior="submit"');
    expect(dashboard).toContain('submitBehavior="blurAndSubmit"');
    expect(dashboard).not.toContain("blurOnSubmit");
    expect(dashboard).toContain("if (authSubmittingRef.current) return;");
  });

  it("prevents the iOS Password AutoFill bar from rebuilding between auth fields", () => {
    expect(dashboard.match(/textContentType="none"/g)).toHaveLength(4);
    expect(dashboard.match(/autoComplete="off"/g)).toHaveLength(4);
    expect(dashboard).not.toContain('textContentType="emailAddress"');
    expect(dashboard).not.toMatch(/textContentType=.*(?:newPassword|password)/);
  });

  it("keeps one fixed password field while exposing an accessible visibility action", () => {
    expect(dashboard).toContain("const [authPasswordVisible, setAuthPasswordVisible] = useState(false)");
    expect(dashboard).toMatch(/<TextInput[\s\S]*?caretHidden=\{authPasswordVisible\}[\s\S]*?secureTextEntry[\s\S]*?textContentType="none"/);
    expect(dashboard).not.toContain("secureTextEntry={!authPasswordVisible}");
    expect(dashboard).toContain("styles.authPasswordRevealOverlay");
    expect(dashboard).toContain('pointerEvents="none"');
    expect(dashboard).toContain('importantForAccessibility="no-hide-descendants"');
    expect(dashboard).toContain('authPasswordVisible ? "Hide password" : "Show password"');
    expect(dashboard).toContain('accessibilityRole="button"');
    expect(dashboard).toContain("<PasswordVisibilityGlyph");
    expect(mobileTheme).toMatch(/authPasswordField:\s*\{[\s\S]*?minHeight: 48,[\s\S]*?overflow: "hidden"/);
    expect(mobileTheme).toMatch(/authPasswordVisibilityButton:\s*\{[\s\S]*?width: 44,[\s\S]*?height: 44,[\s\S]*?borderRadius: 999/);
  });

  it("keeps auth placeholders at AA contrast on the inset field fill", () => {
    expect(mobileTheme).toMatch(/authInput:\s*\{[^}]*backgroundColor: theme\.surfaceInset[^}]*\}/);
    expect(mobileTheme).toMatch(/authPasswordField:\s*\{[^}]*backgroundColor: theme\.surfaceInset[^}]*\}/);
    for (const mode of ["light", "dark"] as const) {
      const palette = DAYFRAME_THEME[mode];
      expect(contrast(palette.textSecondary, palette.surfaceInset)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
