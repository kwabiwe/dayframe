// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarViewMenu } from "./calendar/CalendarViewMenu";

describe("Calendar view menu (Calendar v3, owner 24 Oct 2026)", () => {
  afterEach(() => cleanup());

  it("opens exactly Calendar and List with a check on the current one, and switches", () => {
    const onChange = vi.fn();
    render(<CalendarViewMenu onChange={onChange} value="calendar" />);
    const trigger = screen.getByRole("button", { name: "Calendar view: Calendar. Change view" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitemradio");
    // No Multi Day: two choices only.
    expect(items.map((item) => item.textContent)).toEqual(["Calendar", "List"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("moves with the arrow keys, closes on Escape and gives focus back to the trigger", () => {
    // Reduce Motion: the menu closes at once (no exit fade to wait for).
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query } as MediaQueryList));
    render(<CalendarViewMenu onChange={() => undefined} value="list" />);
    const trigger = screen.getByRole("button", { name: "Calendar view: List. Change view" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    act(() => { fireEvent.keyDown(items[0], { key: "Escape" }); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    vi.unstubAllGlobals();
  });
});
