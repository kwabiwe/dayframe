import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A15: the iPhone sign-in card (UIA-317, UIA-318, UIA-320, UIA-321).
const dashboard = readFileSync(fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)), "utf8");
const theme = readFileSync(fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)), "utf8");

describe("iPhone sign-in (A15)", () => {
  it("labels every field and says what the button is doing", () => {
    for (const label of ["Name", "Email", "Password"]) {
      expect(dashboard).toContain(`<Text style={styles.authLabel}>${label}</Text>`);
      expect(dashboard).toContain(`accessibilityLabel="${label}"`);
    }
    expect(dashboard).not.toContain("Working…");
    expect(dashboard).toContain('"Creating account…"');
    expect(dashboard).toContain('"Logging in…"');
    expect(dashboard).toContain("Sign in to sync your blocks, places and Apple Health.");
  });

  it("creates an account without a Workspace field and states the 8-character rule (UIA-318)", () => {
    expect(dashboard).not.toContain('placeholder="Workspace"');
    expect(dashboard).toContain("At least 8 characters.");
  });

  it("offers Forgot password on Log in, through the server's reset email (UIA-317)", () => {
    expect(dashboard).toContain(">Forgot password?</Text>");
    expect(dashboard).toContain("setAuthNotice(await requestPasswordReset(authEmail.trim()));");
    expect(dashboard).toContain('"Send reset link"');
  });

  it("opens Dayframe in the sign-in card's own look, and reveals the password in the field's face (UIA-320)", () => {
    expect(dashboard).toMatch(/accessibilityRole="progressbar"\s*style=\{styles\.authCard\}/);
    expect(theme).toMatch(/authPasswordRevealText: \{\s*color: theme\.textPrimary,\s*fontSize: 16\s*\}/);
  });

  it("keeps a reply on the view that sent it: no view change while a request runs (Codex r1)", () => {
    const card = dashboard.slice(dashboard.indexOf('if (authState === "signedOut")'));
    for (const label of [">Forgot password?</Text>", '{authView === "login" ? "Create one" : "Log in"}']) {
      const control = card.slice(card.lastIndexOf("<Pressable", card.indexOf(label)), card.indexOf(label));
      expect(control).toContain("disabled={authSubmitting}");
      expect(control).toContain("accessibilityState={{ disabled: authSubmitting }}");
    }
  });

  it("gives the card one Reanimated motion owner and the primary action button semantics (Codex r1)", () => {
    const card = dashboard.slice(dashboard.indexOf('if (authState === "signedOut")'));
    expect(card).toContain("<Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.authCard}>");
    expect(card.match(/entering=\{localPresenceEntering\(reduceMotion\)\}/g)?.length).toBe(4);
    expect(card).toContain("accessibilityState={{ busy: authSubmitting, disabled: authSubmitting }}");
    expect(card).not.toMatch(/LayoutAnimation\./);
  });
});
