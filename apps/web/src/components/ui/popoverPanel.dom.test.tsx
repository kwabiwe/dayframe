// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PopoverPanel, playDialogExit } from "./Primitives";

const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

let currentWidth = 1280;
const mediaListeners = new Set<() => void>();
function viewport(width: number) {
  currentWidth = width;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(max-width: 560px)" ? currentWidth <= 560 : false;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }));
}

function Host({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-trigger="" onClick={() => setOpen(true)} type="button">Profile</button>
      <button type="button">Elsewhere</button>
      {open ? (
        <PopoverPanel align="bottom-left" busy={busy} onClose={() => setOpen(false)} outsidePressIgnore="[data-trigger]" title="Profile & workspace">
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
    mediaListeners.clear();
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

  it("closes from its opener's real click (pointer down, focus moving to it, click), never reopening (Codex r1 on #492)", async () => {
    viewport(1280);
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Profile" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).not.toBeNull();
    // Focus is inside the popover, as a keyboard or click would leave it.
    screen.getByRole("button", { name: "Settings" }).focus();
    await user.click(opener);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open while busy, whatever the opener does", async () => {
    viewport(1280);
    const user = userEvent.setup();
    const view = render(<Host />);
    await user.click(screen.getByRole("button", { name: "Profile" }));
    view.rerender(<Host busy />);
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("swaps between anchored popover and sheet when the viewport crosses 560 px while open", () => {
    viewport(1280);
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByRole("dialog").className).toContain("is-anchored");
    act(() => {
      currentWidth = 390;
      for (const listener of mediaListeners) listener();
    });
    expect(screen.getByRole("dialog").className).toContain("is-sheet");
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("fades a non-modal popover out without a scrim", () => {
    vi.useFakeTimers();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    playDialogExit(dialog, [], false);
    expect(document.querySelector(".ui-dialog-ghost-layer .ui-dialog-ghost")).not.toBeNull();
    expect(document.querySelector(".ui-dialog-ghost-scrim")).toBeNull();
    vi.advanceTimersByTime(160);
    vi.useRealTimers();
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
    expect(styles).toMatch(/@media \(max-width: 560px\) \{\s*dialog\.ui-dialog\.ui-popover-panel\.is-sheet \{[^}]*border-radius: 24px;/);
    // The entrance never applies to the exit copy (Codex r1 on #492).
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-popover-panel\.is-sheet:not\(\.ui-dialog-ghost\) \{\s*animation-name: ui-sheet-in;/);
    expect(styles).toMatch(/@keyframes ui-sheet-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(8px\);/);
    expect(styles).toMatch(/\.df-flist\.ui-floating-surface\.is-sheet:not\(\.is-open\) \{\s*transform: translateY\(8px\);/);
    // The rise is a transition, not a jump.
    expect(styles).toMatch(/\.df-flist\.ui-floating-surface\.is-sheet \{\s*transition:[^}]*transform 160ms/);
    // The Reports range menu is the shared surface with a head and a phone sheet at 560 px.
    expect(styles).toMatch(/\.df-range-menu \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;[^}]*box-shadow: var\(--shadow-floating\);/);
    expect(styles).toMatch(/\.df-range-menu-head \{[^}]*text-transform: uppercase;/);
    expect(styles).toMatch(/@media \(max-width: 560px\) \{\s*\.df-range-menu \{\s*position: fixed;/);
  });
});
