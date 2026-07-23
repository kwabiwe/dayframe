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
const loadingSource = readFileSync(
  fileURLToPath(new URL("../app/settings/loading.tsx", import.meta.url)),
  "utf8"
);
const errorSource = readFileSync(
  fileURLToPath(new URL("../app/settings/error.tsx", import.meta.url)),
  "utf8"
);

describe("web Settings contracts", () => {
  it("uses the shared Appearance segmented control with persisted System, Light and Dark choices", () => {
    expect(themeSource).toContain("SegmentedControl");
    expect(themeSource).toContain('label="Appearance"');
    expect(themeSource).toContain('value: "system"');
    expect(themeSource).toContain('value: "light"');
    expect(themeSource).toContain('value: "dark"');
    expect(themeSource).toContain('localStorage.removeItem("dayframe.theme")');
    expect(themeSource).toContain('localStorage.setItem("dayframe.theme"');
  });

  it("keeps normal Settings free of implementation-facing values and commands", () => {
    expect(settingsPageSource).not.toMatch(/DAYFRAME_|\/api\/export|npm run|seeded demo|ingest token/i);
    expect(settingsPageSource).toContain('title="Places and location"');
    expect(settingsPageSource).toContain('title="Account and workspace"');
    expect(settingsFormsSource).toContain('summary="Privacy and troubleshooting"');
    expect(settingsFormsSource).not.toMatch(/workspace id|user id|bearer token|database table|engine version/i);
  });

  it("assigns persistent editing to Settings and leaves the profile popover as quick access", () => {
    const profilePopover = appShellSource.slice(
      appShellSource.indexOf("function ProfileWorkspacePopover"),
      appShellSource.indexOf("function SearchPalette")
    );
    expect(profilePopover).toContain("switchWorkspace");
    expect(profilePopover).toContain('href="/settings#account"');
    expect(profilePopover).toContain('href="/logout"');
    expect(profilePopover).not.toContain("TextField");
    expect(profilePopover).not.toContain("newPassword");
    expect(profilePopover).not.toContain("createWorkspace");
  });

  it("shows password controls only for local sign-in and reads browser permission without prompting", () => {
    expect(settingsFormsSource).toContain('authMode === "local"');
    expect(settingsFormsSource).toContain('navigator.permissions.query({ name: "geolocation" })');
    expect(settingsFormsSource).not.toContain("navigator.geolocation.getCurrentPosition");
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
    expect(globalStyles).toMatch(/\.settings-group \.ui-settings-row \+ \.ui-settings-row::before \{[^}]*left: 52px;[^}]*right: 18px;/s);
    expect(globalStyles).toMatch(/\.swiss-mobile-account-button \{[^}]*width: 44px;[^}]*height: 44px;[^}]*place-items: center;/s);
  });

  it("provides calm route-level loading and recoverable error states", () => {
    expect(loadingSource).toContain('aria-busy="true"');
    expect(loadingSource).toContain('aria-live="polite"');
    expect(errorSource).toContain("Your saved preferences have not changed.");
    expect(errorSource).toContain("<Button variant=\"primary\" onClick={reset}>Retry</Button>");
    expect(errorSource).not.toMatch(/stack|sql|api route/i);
  });
});
