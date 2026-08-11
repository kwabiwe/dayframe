// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePickerPopover } from "./DatePickerPopover";

describe("DatePickerPopover anchored triggerless mode", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("opens from the editable time field without rendering a calendar-icon trigger", async () => {
    render(<AnchoredPicker />);

    const time = screen.getByRole("combobox", { name: "Start time" });
    expect(screen.queryByRole("button", { name: /Choose Start date/ })).toBeNull();

    await userEvent.click(time);
    expect(await screen.findByRole("dialog", { name: "Choose Start date" })).not.toBeNull();
    expect(time.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(time.getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(time);
  });

  it("mounts a portalled panel after hydration without changing the first client tree", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<AnchoredPicker />);
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = hydrateRoot(container, <AnchoredPicker />);

    await act(async () => undefined);

    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Hydration failed");
    expect(document.body.querySelector('section[role="dialog"][aria-label="Choose Start date"]')).not.toBeNull();

    await act(async () => root.unmount());
    consoleError.mockRestore();
    container.remove();
  });
});

function AnchoredPicker() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <input
        aria-controls="anchored-start-date-panel"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Start time"
        onClick={() => setOpen(true)}
        ref={inputRef}
        role="combobox"
        value="09:00"
        readOnly
      />
      <DatePickerPopover
        anchorRef={inputRef}
        ariaLabel="Choose Start date, currently 10 August 2026"
        label="10 August 2026"
        onChange={vi.fn()}
        onOpenChange={setOpen}
        open={open}
        panelId="anchored-start-date-panel"
        panelLabel="Choose Start date"
        portal
        showTrigger={false}
        today="2026-08-10"
        value="2026-08-10"
      />
    </>
  );
}
