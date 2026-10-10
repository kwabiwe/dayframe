// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { hasOpenDialog } from "./keyboard-ownership";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hasOpenDialog", () => {
  it("is false with nothing open, including kept-mounted closed popovers", () => {
    document.body.innerHTML = `
      <button aria-haspopup="listbox" aria-expanded="false">Activity</button>
      <section role="dialog" aria-hidden="true" inert>Tags</section>`;
    expect(hasOpenDialog()).toBe(false);
  });

  it("is true while a menu, listbox or dialog trigger is expanded", () => {
    for (const popup of ["listbox", "menu", "dialog"]) {
      document.body.innerHTML = `<button aria-haspopup="${popup}" aria-expanded="true">Open</button>`;
      expect(hasOpenDialog()).toBe(true);
    }
  });

  it("is true while an autocomplete field shows its suggestions", () => {
    document.body.innerHTML = `<input aria-autocomplete="list" aria-expanded="true">`;
    expect(hasOpenDialog()).toBe(true);
  });

  it("ignores open disclosures, which may stay open on a page", () => {
    document.body.innerHTML = `<details open><summary aria-expanded="true">More</summary></details>
      <button aria-expanded="true">Show evidence</button>`;
    expect(hasOpenDialog()).toBe(false);
  });

  it("is true while a modal dialog is open", () => {
    document.body.innerHTML = `<dialog open aria-modal="true">Search</dialog>`;
    // jsdom has no layout; give the open dialog a box as a browser would.
    document.querySelector("dialog")!.getClientRects = () => [{}] as unknown as DOMRectList;
    expect(hasOpenDialog()).toBe(true);
  });
});

describe("hasOpenDialog with real popups", () => {
  it("sees the Reports More filters popup through its trigger", async () => {
    const { readFileSync } = await import("node:fs");
    const panel = readFileSync(`${process.cwd()}/src/components/ReportFiltersPanel.tsx`, "utf8");
    expect(panel).toMatch(/aria-expanded=\{moreOpen\}\s*aria-haspopup="dialog"/);
    document.body.innerHTML = `<button aria-haspopup="dialog" aria-expanded="true">More filters</button>`;
    expect(hasOpenDialog()).toBe(true);
  });
});
