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

  it("keeps icon actions centred in an accessible 44-pixel target", () => {
    expect(primitiveSource).toContain("label: string");
    expect(primitiveSource).toContain("aria-label={label}");
    expect(globalStyles).toMatch(/\.ui-icon-button \{[^}]*display: inline-grid;[^}]*width: 44px;[^}]*height: 44px;[^}]*place-items: center;[^}]*padding: 0;[^}]*line-height: 0;/s);
  });

  it("uses a single visible focus ring and a blur-free native backdrop", () => {
    expect(globalStyles).toContain("outline: 2px solid var(--focus);");
    expect(globalStyles).toContain("outline-offset: 2px;");
    expect(globalStyles).toContain("box-shadow: none;");
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
