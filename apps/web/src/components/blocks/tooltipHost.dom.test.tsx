// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "@/components/ui/Primitives";
import { focusQuietly, TooltipHost } from "./TooltipHost";

// WUI-014: icon-only buttons name themselves on hover (after 400 ms) and on keyboard focus.
describe("TooltipHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup() {
    return render(
      <>
        <TooltipHost />
        <button aria-label="Edit block" data-tip="Edit" type="button">✎</button>
        <button type="button">Plain</button>
      </>
    );
  }

  const tip = () => document.querySelector<HTMLElement>(".df-tip");

  // jsdom has no PointerEvent, so fireEvent drops pointerType: build one with it.
  function pointer(type: "pointerover" | "pointerout", target: Element, pointerType: string, relatedTarget?: Element) {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  it("shows the tip 400 ms after a mouse hover and hides it on leave", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });

    pointer("pointerover", button, "mouse");
    act(() => vi.advanceTimersByTime(399));
    expect(tip()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(tip()?.textContent).toBe("Edit");
    expect(tip()?.getAttribute("aria-hidden")).toBe("true");
    expect(tip()?.classList.contains("is-shown")).toBe(true);

    pointer("pointerout", button, "mouse", document.body);
    expect(tip()).toBeNull();
  });

  it("shows at once on keyboard focus and hides on blur", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });

    act(() => button.focus());
    expect(tip()?.textContent).toBe("Edit");
    act(() => button.blur());
    expect(tip()).toBeNull();
  });

  it("shows no tip for focus an action gave back on its own, until the keyboard is used (running Split, 28 Oct 2026)", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });

    act(() => focusQuietly(button));
    expect(document.activeElement).toBe(button);
    expect(tip()).toBeNull();
    expect(button.hasAttribute("data-tip-quiet")).toBe(true);
    // A key press ends the quiet: the ring shows again, and the next keyboard focus has its tip.
    act(() => { fireEvent.keyDown(document, { key: "Tab" }); });
    expect(button.hasAttribute("data-tip-quiet")).toBe(false);
    act(() => button.blur());
    act(() => button.focus());
    expect(tip()?.textContent).toBe("Edit");
  });

  it("keeps a focus tip through a scroll (Tab scrolls the button into view) but hides a hover tip", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });

    act(() => button.focus());
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(tip()?.textContent).toBe("Edit");

    act(() => button.blur());
    pointer("pointerover", button, "mouse");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(tip()).toBeNull();
  });

  it("keeps a keyboard tip when the pointer leaves something else, and drops a pending tip whose button went (Codex r1 on #471)", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });
    const plain = view.getByRole("button", { name: "Plain" });

    act(() => button.focus());
    pointer("pointerout", plain, "mouse", document.body);
    expect(tip()?.textContent).toBe("Edit");
    act(() => button.blur());

    // A button outside React, so the test can remove it while the tip waits.
    const loose = document.createElement("button");
    loose.dataset.tip = "Gone";
    document.body.append(loose);
    pointer("pointerover", loose, "mouse");
    act(() => {
      loose.remove();
      vi.advanceTimersByTime(400);
    });
    expect(tip()).toBeNull();
  });

  it("shows a text field's tip on hover only, never while it has focus", () => {
    const view = render(
      <>
        <TooltipHost />
        <input aria-label="Description" data-tip="Click to edit" />
      </>
    );
    const field = view.getByRole("textbox", { name: "Description" });
    act(() => field.focus());
    expect(tip()).toBeNull();
  });

  it("never shows for touch, and a press or Escape hides it", () => {
    const view = setup();
    const button = view.getByRole("button", { name: "Edit block" });

    pointer("pointerover", button, "touch");
    act(() => vi.advanceTimersByTime(1_000));
    expect(tip()).toBeNull();

    pointer("pointerover", button, "mouse");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();

    pointer("pointerout", button, "mouse", document.body);
    pointer("pointerover", button, "mouse");
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerDown(button);
    expect(tip()).toBeNull();
  });

  it("ignores elements without a tip and elements inside an inert layer", () => {
    const view = render(
      <>
        <TooltipHost />
        <div inert>
          <button aria-label="Delete" data-tip="Delete" type="button">×</button>
        </div>
        <button type="button">Plain</button>
      </>
    );
    pointer("pointerover", view.getByText("Plain"), "mouse");
    pointer("pointerover", view.getByText("×"), "mouse");
    act(() => vi.advanceTimersByTime(1_000));
    expect(tip()).toBeNull();
  });

  it("is what IconButton uses: its label is its tip", () => {
    const view = render(
      <>
        <TooltipHost />
        <IconButton label="Previous day">‹</IconButton>
      </>
    );
    const button = view.getByRole("button", { name: "Previous day" });
    expect(button.getAttribute("data-tip")).toBe("Previous day");
    pointer("pointerover", button, "mouse");
    act(() => vi.advanceTimersByTime(400));
    expect(tip()?.textContent).toBe("Previous day");
  });
});
