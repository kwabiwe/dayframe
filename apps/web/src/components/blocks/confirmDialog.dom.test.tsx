// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function Host({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ConfirmDialog
        body="Your changes to this block will be lost."
        cancelLabel="Go back"
        confirmLabel="Discard"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        open={open}
        title="Discard unsaved changes?"
      />
    </>
  );
}

describe("ConfirmDialog (WUI-005/WUI-009)", () => {
  it("opens as a named alert dialog with its body, and focuses the way back", async () => {
    render(<Host />);
    const dialog = screen.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Your changes to this block will be lost.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go back" })));
    expect(screen.getByRole("button", { name: "Discard" }).className).toContain("df-rbtn--danger");
  });

  it("cancels on Escape and on the scrim, and only the confirming button confirms", async () => {
    const onConfirm = vi.fn();
    render(<Host onConfirm={onConfirm} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Go back" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("alertdialog");
    fireEvent.pointerDown(document.querySelector(".df-confirm-scrim")!);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab and Shift+Tab between its two buttons", async () => {
    render(<Host />);
    const back = screen.getByRole("button", { name: "Go back" });
    const discard = screen.getByRole("button", { name: "Discard" });
    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.keyDown(back, { key: "Tab" });
    expect(document.activeElement).toBe(discard);
    fireEvent.keyDown(discard, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(back);
  });

  it("stops being a dialog for assistive technology as soon as it closes, and stays mounted but hidden", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const layer = screen.getByTestId("confirm-dialog");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.hasAttribute("inert")).toBe(true);
    expect(layer.className).not.toContain("is-open");
    // Reopening at once is never lost to a pending close (no presence timer).
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeTruthy();
  });

  it("waits while busy (no Escape, scrim or second press) and shows a failure under the body", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog busy busyLabel="Deleting…" confirmLabel="Delete" onCancel={onCancel} onConfirm={onConfirm} open title="Delete tag?" />
    );
    const confirm = screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement;
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(confirm, { key: "Escape" });
    fireEvent.pointerDown(document.querySelector(".df-confirm-scrim")!);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(<ConfirmDialog confirmLabel="Delete" error="Unable to delete this tag." onCancel={onCancel} onConfirm={onConfirm} open title="Delete tag?" />);
    expect(screen.getByRole("alert").textContent).toBe("Unable to delete this tag.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("is modal: the rest of the page is inert while it asks, and focus returns to its opener (Codex r1 on #469)", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Delete tag</button>
          <ConfirmDialog confirmLabel="Delete" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} open={open} title="Delete tag?" />
        </>
      );
    }
    const { container } = render(<Opener />);
    const opener = screen.getByRole("button", { name: "Delete tag" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    expect(container.hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("keeps only the newest of two dialogs interactive, and the page inert until the last one closes (Codex r2 on #469)", async () => {
    function Two({ initial }: { initial: [boolean, boolean] }) {
      const [[first, second], setOpen] = useState(initial);
      return (
        <>
          <button type="button" onClick={() => setOpen(([, b]) => [true, b])}>Open first</button>
          <button type="button" onClick={() => setOpen(([a]) => [a, true])}>Open second</button>
          <ConfirmDialog confirmLabel="Delete" onCancel={() => setOpen(([, b]) => [false, b])} onConfirm={vi.fn()} open={first} title="First?" />
          <ConfirmDialog confirmLabel="Delete" onCancel={() => setOpen(([a]) => [a, false])} onConfirm={vi.fn()} open={second} title="Second?" />
        </>
      );
    }
    const layerOf = (title: string) => screen.getByRole("alertdialog", { name: title }).closest<HTMLElement>(".df-confirm-layer")!;

    // Both open in one commit: the second is on top and interactive, the first is not.
    const view = render(<Two initial={[true, true]} />);
    expect(layerOf("Second?").hasAttribute("inert")).toBe(false);
    expect(layerOf("First?").hasAttribute("inert")).toBe(true);
    expect(view.container.hasAttribute("inert")).toBe(true);
    view.unmount();
    expect(document.body.querySelector("[inert]:not(.df-confirm-layer)")).toBeNull();

    // Opened one after the other, the older closed first: the page stays inert under the newer.
    const again = render(<Two initial={[false, false]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open first" }));
    fireEvent.click(screen.getByRole("button", { name: "Open second", hidden: true }));
    const first = layerOf("First?");
    const second = layerOf("Second?");
    expect(second.hasAttribute("inert")).toBe(false);
    expect(first.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(again.container.hasAttribute("inert")).toBe(true);
    expect(second.hasAttribute("inert")).toBe(false);
    fireEvent.keyDown(second, { key: "Escape" });
    expect(again.container.hasAttribute("inert")).toBe(false);
    // Closed layers stay inert through their own prop.
    expect(first.hasAttribute("inert")).toBe(true);
    expect(second.hasAttribute("inert")).toBe(true);
  });

  it("keeps its buttons focusable while busy, so focus is never lost", async () => {
    render(<ConfirmDialog busy busyLabel="Deleting…" confirmLabel="Delete" onCancel={vi.fn()} onConfirm={vi.fn()} open title="Delete tag?" />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(cancel.hasAttribute("disabled")).toBe(false);
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
  });
});
