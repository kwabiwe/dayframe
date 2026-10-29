import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { durationPartsToMinutes, durationToParts } from "@/lib/goal-duration";

const settingsPageSource = readFileSync(
  fileURLToPath(new URL("../app/settings/page.tsx", import.meta.url)),
  "utf8"
);
const settingsFormsSource = readFileSync(
  fileURLToPath(new URL("./SettingsForms.tsx", import.meta.url)),
  "utf8"
);
const themeSource = readFileSync(
  fileURLToPath(new URL("./ThemeSettings.tsx", import.meta.url)),
  "utf8"
);
const appShellSource = readFileSync(
  fileURLToPath(new URL("./AppShell.tsx", import.meta.url)),
  "utf8"
);
const globalStyles = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8"
);
const errorSource = readFileSync(
  fileURLToPath(new URL("../app/settings/error.tsx", import.meta.url)),
  "utf8"
);

describe("web Settings contracts", () => {
  it("uses the shared Appearance segmented control: Midnight · Daylight · System, persisted (D1, UIA-310)", () => {
    expect(themeSource).toContain("SegmentedControl");
    const order = ['label: "Midnight"', 'label: "Daylight"', 'label: "System"'].map((label) => themeSource.indexOf(label));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(themeSource).toContain('label="Appearance"');
    expect(themeSource).toContain('value: "system"');
    expect(themeSource).toContain('value: "light"');
    expect(themeSource).toContain('value: "dark"');
    expect(themeSource).toContain('localStorage.removeItem("dayframe.theme")');
    expect(themeSource).toContain('localStorage.setItem("dayframe.theme"');
  });

  it("keeps normal Settings free of implementation-facing values and commands", () => {
    expect(settingsPageSource).not.toMatch(/DAYFRAME_|\/api\/export|npm run|seeded demo|ingest token/i);
    expect(settingsPageSource).toContain('title="Automatic tracking"');
    expect(settingsPageSource).toContain('title="Privacy and data"');
    expect(settingsFormsSource).toContain('id="account"');
    expect(settingsFormsSource).toContain('summary="Something not right?"');
    expect(settingsFormsSource).not.toMatch(/workspace id|user id|bearer token|database table|engine version/i);
  });

  it("assigns persistent editing to Settings and leaves the profile popover as quick access", () => {
    const profilePopover = appShellSource.slice(
      appShellSource.indexOf("function ProfileWorkspacePopover"),
      appShellSource.indexOf("function SearchPalette")
    );
    expect(profilePopover).toContain("switchWorkspace");
    expect(profilePopover).toContain('href="/settings#account"');
    expect(profilePopover).toContain("<SignOutControl");
    expect(profilePopover).not.toContain('href="/logout"');
    expect(profilePopover).not.toContain("TextField");
    expect(profilePopover).not.toContain("newPassword");
    expect(profilePopover).not.toContain("createWorkspace");
  });

  it("shows password controls for Dayframe email/password modes and never asks for location in Settings", () => {
    expect(settingsFormsSource).toContain('authMode === "local" || authMode === "provider"');
    expect(settingsFormsSource).not.toContain("navigator.geolocation.getCurrentPosition");
    // UIA-312: no text-only rows; the notes live in the section's description.
    expect(settingsFormsSource).not.toContain('label="Suggest visits"');
    expect(settingsFormsSource).not.toContain('label="Location access"');
  });

  it("gives each account its own goal control, so no draft or save crosses accounts (Codex r2 on #332)", () => {
    expect(settingsPageSource).toMatch(/<GoalSettings[\s\S]*?key=\{data\.user\.id\}/);
  });

  it("offers one Export with the other files in a small menu (UIA-312)", () => {
    expect(settingsFormsSource).toContain('href="/api/export?kind=workspace_json" download>Export</a>');
    expect(settingsFormsSource).toContain('aria-label="More export formats"');
    expect(settingsFormsSource).toContain("/api/export?kind=time_entries_csv");
    expect(settingsFormsSource).toContain("/api/export?kind=activity_events_json");
  });

  it("hides keyboard shortcuts on touch-only devices (UIA-313)", () => {
    expect(settingsFormsSource).toContain('className="df-shortcuts-row"');
    expect(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"))
      .toMatch(/@media \(hover: none\) and \(pointer: coarse\) \{\s*\.df-shortcuts-row,\s*\.df-set-card \.ui-settings-row\.df-shortcuts-row,\s*\.df-side-shortcuts \{\s*display: none;/);
  });

  it("converts compact hour and minute controls to the existing minute contract", () => {
    expect(durationToParts(495)).toEqual({ hours: 8, minutes: 15 });
    expect(durationPartsToMinutes("8", "15", 1440)).toBe(495);
    expect(durationPartsToMinutes("0", "0", 1440)).toBeNull();
    expect(durationPartsToMinutes("-1", "0", 1440)).toBeNull();
    expect(durationPartsToMinutes("24", "1", 1440)).toBeNull();
    expect(durationPartsToMinutes("40", "60", 10080)).toBeNull();
  });

  it("keeps Settings rows inset and the mobile account trigger at 44 pixels", () => {
    // Inset on both sides through the shared row-divider values (owner rule, 28 Oct 2026).
    expect(globalStyles).toMatch(/\.settings-group \.ui-settings-row \+ \.ui-settings-row::before \{[^}]*--divider-inset: 18px;[^}]*--divider-inset-start: 52px;/s);
    expect(globalStyles).toMatch(/\.df-mtop-button,\s*\.df-mtop-avatar \{[^}]*width: 44px;[^}]*height: 44px;[^}]*place-items: center;/s);
  });

  it("uses cached shell data with a first-load-only state and recoverable errors", () => {
    expect(settingsPageSource).toContain("useAppShellRuntime()");
    expect(settingsPageSource).toContain("if (!data) return <SettingsInitialLoading />");
    expect(settingsPageSource).toContain('aria-busy="true"');
    expect(settingsPageSource).toContain('aria-live="polite"');
    expect(errorSource).toContain("Your saved preferences have not changed.");
    // The shared status page (WUI-048): a neutral Try again beside Go to Today, never coral.
    expect(errorSource).toContain("<StatusPage");
    expect(errorSource).toContain('<button className="df-rbtn df-rbtn--inverse" onClick={retry} type="button">Try again</button>');
    // Try again fetches the page again (Codex r1 on #493).
    expect(errorSource).toContain("useErrorRetry(reset, unstableRetry)");
    expect(errorSource).not.toMatch(/stack|sql|api route/i);
  });
});
