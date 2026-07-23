import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const primitiveSource = readFileSync(
  fileURLToPath(new URL("./Primitives.tsx", import.meta.url)),
  "utf8"
);
const globalStyles = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8"
);
const entriesSource = readFileSync(
  fileURLToPath(new URL("../EntriesTable.tsx", import.meta.url)),
  "utf8"
);

describe("web UI foundation contracts", () => {
  it("uses one native modal owner with focus entry, cancellation, scroll lock and restoration", () => {
    expect(primitiveSource).toContain("dialog.showModal()");
    expect(primitiveSource).toContain('classList.add("ui-dialog-open")');
    expect(primitiveSource).toContain("onCancel=");
    expect(primitiveSource).toContain('event.key !== "Escape"');
    expect(primitiveSource).toContain("previouslyFocused?.focus()");
    expect(primitiveSource).toContain('role?: DialogRole');
    expect(primitiveSource).toContain('aria-modal="true"');
  });

  it("keeps icon actions centred in the shared accessible target", () => {
    expect(primitiveSource).toContain("label: string");
    expect(primitiveSource).toContain("aria-label={label}");
    expect(globalStyles).toMatch(/--web-icon-button-size: 44px;/);
    expect(globalStyles).toMatch(/\.ui-icon-button \{[^}]*display: inline-grid;[^}]*width: var\(--web-icon-button-size\);[^}]*height: var\(--web-icon-button-size\);[^}]*place-items: center;[^}]*padding: 0;[^}]*line-height: 0;/s);
  });

  it("exposes disclosure state and supports explicit keyboard activation", () => {
    expect(primitiveSource).toContain("aria-expanded={open}");
    expect(primitiveSource).toContain('event.key !== "Enter" && event.key !== " "');
    expect(primitiveSource).toContain("setOpen((current) => !current)");
  });

  it("gives fields one in-perimeter focus owner and standalone actions one external ring", () => {
    expect(globalStyles).toContain("--web-control-border-width: 2px;");
    expect(globalStyles).toContain("border-color: var(--web-focus-border);");
    expect(globalStyles).toMatch(/\.ui-compound-control:focus-within \{[^}]*border-color: var\(--web-focus-border\);/s);
    expect(globalStyles).toMatch(/\.ui-compound-control > input \{[^}]*border: 0;[^}]*outline: 0;/s);
    expect(globalStyles).toContain("outline: 2px solid var(--focus);");
    expect(globalStyles).toContain("outline-offset: 2px;");
    expect(globalStyles).toMatch(/dialog\.ui-dialog::backdrop \{[^}]*backdrop-filter: none;/s);
    expect(globalStyles).not.toContain("swiss-modal-backdrop");
    expect(globalStyles).not.toContain("swiss-dialog-backdrop");
  });

  it("keeps entry deletion confirmed, busy-safe and recoverable on failure", () => {
    expect(entriesSource).toContain("setPendingDeleteEntry(entry)");
    expect(entriesSource).toContain("isBusy={isDeletingEntry || isPending}");
    expect(entriesSource).toContain("error={deleteError}");
    expect(entriesSource).toContain("if (!response.ok)");
  });
});
