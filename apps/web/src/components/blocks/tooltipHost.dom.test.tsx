// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "@/components/ui/Primitives";
import { TooltipHost } from "./TooltipHost";

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
