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
    expect(confirm.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(confirm, { key: "Escape" });
    fireEvent.pointerDown(document.querySelector(".df-confirm-scrim")!);
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<ConfirmDialog confirmLabel="Delete" error="Unable to delete this tag." onCancel={onCancel} onConfirm={onConfirm} open title="Delete tag?" />);
    expect(screen.getByRole("alert").textContent).toBe("Unable to delete this tag.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
