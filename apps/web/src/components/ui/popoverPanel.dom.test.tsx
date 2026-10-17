// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PopoverPanel } from "./Primitives";

const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function viewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 560px)" ? width <= 560 : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }));
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-trigger="" onClick={() => setOpen((current) => !current)} type="button">Profile</button>
      <button type="button">Elsewhere</button>
      {open ? (
        <PopoverPanel align="bottom-left" onClose={() => setOpen(false)} outsidePressIgnore="[data-trigger]" title="Profile & workspace">
          <button type="button">Settings</button>
        </PopoverPanel>
      ) : null}
    </>
  );
}

// Web UI audit P5b (WUI-022/WUI-026, owner 17 Oct 2026).
describe("PopoverPanel", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.dataset.modal = "true";
    };
    HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("ui-dialog-open");
  });

  it("opens beside its opener without a scrim on wider screens; a press outside or Escape closes it", () => {
    viewport(1280);
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    const dialog = screen.getByRole("dialog", { name: "Profile & workspace" });
    expect(dialog.className).toContain("is-anchored");
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(document.documentElement.classList.contains("ui-dialog-open")).toBe(false);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets its opener toggle it rather than closing and reopening on the same press", () => {
    viewport(1280);
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Profile" });
    fireEvent.click(opener);
    fireEvent.pointerDown(opener);
    expect(screen.getByRole("dialog")).not.toBeNull();
    fireEvent.click(opener);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal bottom sheet on phones", () => {
    viewport(390);
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    const dialog = screen.getByRole("dialog", { name: "Profile & workspace" });
    expect(dialog.className).toContain("is-sheet");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.documentElement.classList.contains("ui-dialog-open")).toBe(true);
  });

  it("pads its content, rises as a sheet, and sits above the page when anchored (CSS)", () => {
    expect(styles).toMatch(/\.ui-popover-content \{\s*display: grid;\s*padding: 6px;/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-popover-panel\.is-anchored \{\s*z-index: 90;/);
    expect(styles).toMatch(/@media \(max-width: 560px\) \{\s*dialog\.ui-dialog\.ui-popover-panel\.is-sheet \{[^}]*border-radius: 24px;[^}]*animation-name: ui-sheet-in;/);
    expect(styles).toMatch(/@keyframes ui-sheet-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(8px\);/);
    expect(styles).toMatch(/\.df-flist\.ui-floating-surface\.is-sheet:not\(\.is-open\) \{\s*transform: translateY\(8px\);/);
    // The Reports range menu is the shared surface with a head and a phone sheet at 560 px.
    expect(styles).toMatch(/\.df-range-menu \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;[^}]*box-shadow: var\(--shadow-floating\);/);
    expect(styles).toMatch(/\.df-range-menu-head \{[^}]*text-transform: uppercase;/);
    expect(styles).toMatch(/@media \(max-width: 560px\) \{\s*\.df-range-menu \{\s*position: fixed;/);
  });
});
