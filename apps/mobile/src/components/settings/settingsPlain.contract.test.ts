import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DAYFRAME_APP_ICONS, DAYFRAME_GLYPHS } from "@dayframe/shared";

const settings = readFileSync(resolve(__dirname, "../../../app/settings.tsx"), "utf8");
const blocks = readFileSync(resolve(__dirname, "SettingsBlocks.tsx"), "utf8");

describe("Settings in plain language (audit A8a)", () => {
  it("says Sign out everywhere, with its glyph (UIA-081/083)", () => {
    expect(settings).not.toMatch(/"[^"\n]*\bLog out\b[^"\n]*"/);
    expect(settings).toContain('title: "Sign out?"');
    expect(settings.match(/glyph=\{DAYFRAME_APP_ICONS\.signOut\}/g)).toHaveLength(2);
    expect(DAYFRAME_APP_ICONS.signOut).toBe("log-out");
    expect(DAYFRAME_GLYPHS["log-out"]).toBeTruthy();
  });

  it("uses outcome language in Sync help, with one Try again verb (UIA-082)", () => {
    for (const engineering of ["The server didn't accept", "not accepted", "Check again", "quarantine diagnostics", "replayed", "queued events", "Retry sends"]) {
      expect(settings).not.toContain(engineering);
    }
    // The footer names the buttons on screen (staging QA 24 Oct 2026: "Clear" rows, "Discard" footer).
    expect(settings).toContain("foot={needsAttentionFoot({");
    expect(settings).toContain('message: "Only this change is removed. Anything still sending is kept."');
    expect(settings).not.toMatch(/label="Retry"/);
  });

  it("links the web for account edits and export (UIA-080/084)", () => {
    expect(settings).toContain('foot="Edit your name, password or workspace on the web."');
    expect(settings).toContain('onPress={() => void openOnWeb("/settings")}');
    expect(settings).toContain('title="Export your data"');
    expect(settings).toContain('onPress={() => void openOnWeb("/settings#privacy-data")}');
    expect(settings).toContain("await Linking.openURL(`${DAYFRAME_API_BASE}${path}`);");
  });

  it("shows Motion & Fitness as a status row, not a page (UIA-086)", () => {
    const row = settings.slice(settings.indexOf('testID="settings-motion"') - 700, settings.indexOf('testID="settings-motion"'));
    expect(row).not.toContain('openSettingsSection("automations")');
    expect(row).toContain("handleMotionFitnessAction");
  });

  it("draws every segmented control like the Reports switch (UIA-081)", () => {
    expect(blocks).toContain('backgroundColor: theme.mode === "dark" ? theme.surfaceInset : theme.surfaceMuted');
    expect(blocks).toContain('selected ? { backgroundColor: theme.mode === "dark" ? theme.surfaceMuted : theme.surface } : null');
  });

  it("sends location access to iOS Settings when iOS won't ask again (UIA-111)", () => {
    // Settings first, one action for label and VoiceOver, the live permission decides taps.
    // The label is display only (A4: it may come from the last launch); the press reads live state.
    expect(settings).toContain("const shownLocationAction = locationAccessAction({");
    expect(settings).toContain("accessibilityLabel={locationActionAccessibilityLabel}");
    expect(settings).toContain("// The live permission decides, whatever the cached diagnostics say.");
    expect(settings).toContain("if (enabled && await locationAccessNeedsIosSettings().catch(() => false)) {");
    // Coming back from iOS Settings re-reads local permissions without the network.
    expect(settings).toContain('if (state === "active") refreshLocationOnReturn.current();');
  });
});
