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

  it("keeps the anchored menu inside the viewport on both sides (Codex r2 on #583)", () => {
    vi.stubGlobal("innerWidth", 600);
    render(<CalendarViewMenu onChange={() => undefined} value="calendar" />);
    const trigger = screen.getByRole("button", { name: "Calendar view: Calendar. Change view" });
    // A trigger near the left edge: a 220 px menu flush with its right edge would start at −152 px.
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 144, left: 24, right: 68, width: 44, height: 44, x: 24, y: 100, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const right = Number.parseFloat(menu.style.getPropertyValue("--df-cal-view-right"));
    const width = menu.offsetWidth || 220;
    expect(600 - right - width).toBeGreaterThanOrEqual(12);
    expect(right).toBeGreaterThanOrEqual(12);
    vi.unstubAllGlobals();
  });

  it("opens above the trigger when there is no room below, inside the viewport (Codex r4 on #583)", () => {
    vi.stubGlobal("innerWidth", 844);
    vi.stubGlobal("innerHeight", 390);
    render(<CalendarViewMenu onChange={() => undefined} value="calendar" />);
    const trigger = screen.getByRole("button", { name: "Calendar view: Calendar. Change view" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 316, bottom: 360, left: 780, right: 824, width: 44, height: 44, x: 780, y: 316, toJSON: () => ({}) });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const top = Number.parseFloat(menu.style.getPropertyValue("--df-cal-view-top"));
    const height = menu.offsetHeight || 140;
    expect(top + height).toBeLessThanOrEqual(390 - 12);
    expect(top).toBeGreaterThanOrEqual(12);
    vi.unstubAllGlobals();
  });
});
