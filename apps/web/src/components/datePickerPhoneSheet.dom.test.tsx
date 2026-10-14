// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePickerPopover } from "./DatePickerPopover";

const full = (date: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`));

function Picker({ onChange }: { onChange: (date: string) => void }) {
  const [value, setValue] = useState("2026-10-10");
  return (
    <DatePickerPopover
      label={value}
      max="2026-10-14"
      onChange={(date) => { setValue(date); onChange(date); }}
      panelLabel="Choose Start date"
      today="2026-10-14"
      value={value}
    />
  );
}

describe("DatePickerPopover at phone width (date-picker audit D1/D6, 14 Oct 2026)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(max-width: 560px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("is a sheet: a day tap only drafts, Done saves it, ✕ keeps the old date", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /2026-10-10/ })); });
    const sheet = screen.getByRole("dialog", { name: "Choose Start date" });
    expect(sheet.className).toContain("is-sheet");
    expect(document.querySelector(".date-sheet-scrim")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();

    // A day and a quick pick only change the draft.
    fireEvent.click(screen.getByRole("button", { name: full("2026-10-12") }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: full("2026-10-12") }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(screen.getByRole("button", { name: "Yesterday" }).getAttribute("aria-pressed")).toBe("true");
    // ✕ leaves without saving.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close" })); });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector(".date-sheet-scrim")).toBeNull();

    // Reopened, the draft starts from the saved date again; Done saves the drafted day.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /2026-10-10/ })); });
    expect(screen.getByRole("button", { name: full("2026-10-10") }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
    expect(onChange).toHaveBeenCalledWith("2026-10-14");
  });

  it("closes on a scrim press without saving, takes focus and keeps Tab inside (Codex r1 on #423)", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /2026-10-10/ })); });
    // Focus moves into the sheet, onto the chosen day (the grid's tab stop).
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-10");
    // Tab from the last control wraps to the first, and Shift+Tab back again.
    const sheet = screen.getByRole("dialog", { name: "Choose Start date" });
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(sheet, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(done);
    // A press on the scrim (not portalled here, so inside the picker) closes it unsaved.
    fireEvent.click(screen.getByRole("button", { name: full("2026-10-12") }));
    await act(async () => { fireEvent.mouseDown(document.querySelector(".date-sheet-scrim")!); });
    expect(document.querySelector(".date-sheet-scrim")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks a portalled scrim as a nested surface of the quick editor", async () => {
    render(<DatePickerPopover label="10 Oct" onChange={vi.fn()} portal today="2026-10-14" value="2026-10-10" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /10 Oct/ })); });
    expect(document.querySelector(".date-sheet-scrim")!.classList.contains("time-entry-quick-editor-nested-surface")).toBe(true);
  });

  it("can't draft or save a day past max", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /2026-10-10/ })); });
    fireEvent.click(screen.getByRole("button", { name: full("2026-10-15") }));
    expect(screen.getByRole("button", { name: full("2026-10-15") }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
    expect(onChange).toHaveBeenCalledWith("2026-10-10");
  });
});
