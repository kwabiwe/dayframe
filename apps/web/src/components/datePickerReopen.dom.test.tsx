// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePickerPopover } from "./DatePickerPopover";

afterEach(() => cleanup());

describe("DatePickerPopover reopening (Codex r1 on #422)", () => {
  it("opens on the chosen day's month again, wherever the grid was left", async () => {
    render(<DatePickerPopover label="10 Oct" onChange={vi.fn()} today="2026-10-14" value="2026-10-10" />);
    const trigger = screen.getByRole("button", { name: /10 Oct/ });
    await act(async () => { fireEvent.click(trigger); });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(document.querySelector(".dayframe-calendar header strong")!.textContent).toBe("November 2026");
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await act(async () => { fireEvent.click(trigger); });
    expect(document.querySelector(".dayframe-calendar header strong")!.textContent).toBe("October 2026");
  });
});
