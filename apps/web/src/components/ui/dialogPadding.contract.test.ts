import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UIA-301: one inner padding for every dialog body, set on the shared primitive.
const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const settings = readFileSync(fileURLToPath(new URL("../SettingsForms.tsx", import.meta.url)), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("dialog padding (UIA-301)", () => {
  it("pads the shared dialog body like its header and actions", () => {
    expect(rule(".ui-dialog-content")).toContain("padding: var(--web-gap-md) var(--web-dialog-padding-inline);");
    expect(rule(".ui-dialog-header")).toContain("padding: var(--web-gap-md) var(--web-dialog-padding-inline);");
  });

  it("drops per-dialog workarounds, and only edge-to-edge surfaces opt out", () => {
    for (const selector of [".place-dialog-copy", ".place-role-dialog", ".swiss-confirm-body", ".settings-troubleshooting-copy", ".place-learned-details"]) {
      expect(rule(selector)).not.toMatch(/\bpadding:/);
    }
    // Add time's dialog is gone: it is the shared editor's modal now (WUI-025).
    expect(rule(".df-palette .ui-dialog-content")).toContain("padding: 0;");
    // Popovers have the #391 surface's 6 px inside padding (WUI-022).
    expect(rule(".ui-popover-content")).toContain("padding: 6px;");
  });

  it("puts the Settings dialogs' actions in the dialog footer", () => {
    expect(settings).toContain('form="settings-profile-form"');
    expect(settings).toContain('form="settings-password-form"');
    expect(settings).not.toContain("settings-inline-form df-set-dialog-form");
  });
});
