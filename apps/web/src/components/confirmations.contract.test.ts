import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const styles = source("../app/globals.css");
const destructive = source("./DestructiveConfirmationDialog.tsx");

// Web UI audit P2 (WUI-008…010, WUI-040; owner 17 Oct 2026): one confirmation, one danger look.
describe("confirmations and destructive actions", () => {
  it("asks every destructive question in the shared ConfirmDialog", () => {
    expect(destructive).toContain("<ConfirmDialog");
    expect(destructive).not.toContain("ModalDialog");
    expect(destructive).not.toContain('variant="danger"');
  });

  it("never draws the old pink danger fill: quiet red outside a dialog, solid red confirming inside one", () => {
    expect(styles).not.toMatch(/color-mix\(in srgb, var\(--danger\) 14%, var\(--surface-muted\)\)/);
    expect(styles).toMatch(/\n\.ui-button-danger \{[^}]*background: transparent;[^}]*color: var\(--danger-text\);/s);
    expect(styles).toMatch(/\.ui-dialog \.ui-button-danger \{[^}]*background: var\(--danger\);[^}]*color: var\(--on-danger\);/s);
    expect(styles).toMatch(/\.df-rbtn--danger \{[^}]*background: var\(--danger\);[^}]*color: var\(--on-danger\);/s);
  });

  it("writes small danger copy in the contrast-safe token", () => {
    expect(styles).toMatch(/\.swiss-timer-actions-menu button \{[^}]*color: var\(--danger-text\);/s);
    expect(styles).toMatch(/\.df-confirm-error \{[^}]*color: var\(--danger-text\);/s);
  });
});
