// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { captureDialogScroll, ModalDialog, playDialogExit } from "./Primitives";

const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// Web UI audit P5a (WUI-020/WUI-021, owner 17 Oct 2026).
describe("ModalDialog", () => {
  beforeAll(() => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("sizes itself by tier: form by default, confirm for an alert dialog, or as asked", () => {
    const form = render(<ModalDialog onClose={vi.fn()} title="Edit">x</ModalDialog>);
    expect(document.querySelector("dialog")?.classList.contains("ui-dialog--form")).toBe(true);
    form.unmount();
    const confirm = render(<ModalDialog onClose={vi.fn()} role="alertdialog" title="Delete?">x</ModalDialog>);
    expect(document.querySelector("dialog")?.classList.contains("ui-dialog--confirm")).toBe(true);
    confirm.unmount();
    render(<ModalDialog onClose={vi.fn()} size="compact" title="Workspace">x</ModalDialog>);
    expect(document.querySelector("dialog")?.classList.contains("ui-dialog--compact")).toBe(true);
  });

  it("fades out a hidden, inert copy of its last frame, typed values and all, then removes it", () => {
    vi.useFakeTimers();
    const dialog = document.createElement("dialog");
    dialog.className = "ui-dialog ui-dialog--form";
    dialog.id = "edit";
    dialog.innerHTML = '<h2 id="edit-title">Edit</h2><input id="name" /><input type="checkbox" />';
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    (dialog.querySelector("#name") as HTMLInputElement).value = "Deep work";
    (dialog.querySelector("input[type=checkbox]") as HTMLInputElement).checked = true;
    dialog.remove();

    playDialogExit(dialog);
    const ghost = document.querySelector<HTMLDialogElement>("dialog.ui-dialog-ghost")!;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.inert).toBe(true);
    expect(ghost.hasAttribute("open")).toBe(true);
    expect(ghost.querySelectorAll("[id]").length + (ghost.id ? 1 : 0)).toBe(0);
    expect((ghost.querySelector("input:not([type])") as HTMLInputElement).value).toBe("Deep work");
    expect((ghost.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector(".ui-dialog-ghost-scrim")).not.toBeNull();

    vi.advanceTimersByTime(160);
    expect(document.querySelector(".ui-dialog-ghost, .ui-dialog-ghost-scrim, .ui-dialog-ghost-layer")).toBeNull();
  });

  it("holds the copy and its scrim in one inert, hidden layer, scrolled where the dialog was (Codex r1 on #487)", () => {
    vi.useFakeTimers();
    const dialog = document.createElement("dialog");
    dialog.className = "ui-dialog";
    dialog.innerHTML = '<div class="ui-dialog-content"><p>Long</p></div>';
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const content = dialog.querySelector<HTMLElement>(".ui-dialog-content")!;
    // jsdom does no layout, so the offsets are set by hand; they are only read and written back.
    Object.defineProperty(content, "scrollTop", { configurable: true, value: 200, writable: true });
    const scroll = captureDialogScroll(dialog);
    expect(scroll).toEqual([[1, 200, 0]]);
    dialog.remove();

    playDialogExit(dialog, scroll);
    const layer = document.querySelector<HTMLElement>(".ui-dialog-ghost-layer")!;
    expect(layer.inert).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelector(".ui-dialog-ghost-scrim")).not.toBeNull();
    expect(layer.querySelector<HTMLElement>(".ui-dialog-ghost .ui-dialog-content")!.scrollTop).toBe(200);
    vi.advanceTimersByTime(160);
    expect(document.querySelector(".ui-dialog-ghost-layer")).toBeNull();
  });

  it("plays nothing for a dialog that was never open", () => {
    const dialog = document.createElement("dialog");
    playDialogExit(dialog);
    expect(document.querySelector(".ui-dialog-ghost")).toBeNull();
  });

  it("draws the tiers, the radius, the motion and the phone footer in CSS", () => {
    expect(styles).toMatch(/dialog\.ui-dialog \{[^}]*width: min\(620px, calc\(100vw - 24px\)\);[^}]*border-radius: 20px;/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-dialog--confirm \{[^}]*min\(400px/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-dialog--compact \{[^}]*min\(520px/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-dialog--wide \{[^}]*min\(720px/);
    expect(styles).toMatch(/dialog\.ui-dialog\[open\] \{[^}]*animation: ui-dialog-in 160ms/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-dialog-ghost \{[^}]*animation: ui-dialog-out 120ms/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*dialog\.ui-dialog\[open\] \{\s*animation-name: ui-dialog-fade-in;/);
    expect(styles).toMatch(/@media \(max-width: 560px\) \{\s*dialog\.ui-dialog \{\s*border-radius: 24px;\s*\}\s*\.ui-dialog-actions > :is\(button, a\) \{\s*flex: 1 1 0;/);
    expect(styles).toMatch(/\.ui-dialog-header \.ui-icon-button \{\s*background: transparent;/);
    // Reduce Motion keeps the fades at their lengths, above the global 1 ms rule.
    expect(styles).toMatch(/dialog\.ui-dialog\[open\] \{\s*animation-name: ui-dialog-fade-in;\s*animation-duration: 160ms !important;/);
    expect(styles).toMatch(/dialog\.ui-dialog\.ui-dialog-ghost \{\s*animation-name: ui-dialog-fade-out;\s*animation-duration: 120ms !important;/);
    // Phone footers hide spacers, and below 760 px a dialog keeps its tier.
    expect(styles).toMatch(/\.ui-dialog-actions > \.df-spacer \{\s*display: none;/);
    expect(styles).not.toMatch(/@media \(max-width: 760px\) \{\s*dialog\.ui-dialog,/);
    // A host card styles only its own title, never a dialog header opened inside it.
    expect(styles).toMatch(/\.df-set-card > h2 \{/);
    expect(styles).not.toMatch(/\.df-set-card h2 \{/);
    // No dialog keeps the old 720 px default or a one-off width that duplicates a tier.
    expect(styles).not.toMatch(/dialog\.ui-dialog\.(df-ce-dialog|df-rf-dialog|ui-confirm-dialog) \{[^}]*width/);
  });
});
