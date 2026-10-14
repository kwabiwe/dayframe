// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayframeCalendar, keyTarget } from "./DayframeCalendar";

afterEach(() => cleanup());

const full = (date: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`));

function Harness({ max, min, onChange = vi.fn(), value = "2026-10-14" }: { max?: string; min?: string; onChange?: (date: string) => void; value?: string }) {
  const [view, setView] = useState({ year: 2026, month: 10 });
  const [chosen, setChosen] = useState(value);
  return (
    <DayframeCalendar
      max={max}
      min={min}
      onChange={(date) => { setChosen(date); onChange(date); }}
      onViewChange={setView}
      today="2026-10-14"
      value={chosen}
      view={view}
    />
  );
}

describe("DayframeCalendar (date-picker audit, 14 Oct 2026)", () => {
  it("is Monday-first and marks today without choosing it", () => {
    render(<Harness value="2026-10-02" />);
    const weekdays = document.querySelector(".dayframe-calendar-weekdays")!.textContent;
    expect(weekdays).toBe("MTWTFSS");
    // October 2026 starts on a Thursday: the grid opens on Monday 28 September.
    expect(document.querySelector(".dayframe-calendar-grid button")!.getAttribute("data-date")).toBe("2026-09-28");
    const today = screen.getByRole("button", { name: full("2026-10-14") });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.className).toContain("is-today");
    expect(today.getAttribute("aria-pressed")).toBe("false");
  });

  it("dims days after max, never chooses them, and stops paging past it", () => {
    const onChange = vi.fn();
    render(<Harness max="2026-10-14" onChange={onChange} />);
    const tomorrow = screen.getByRole("button", { name: full("2026-10-15") });
    expect(tomorrow.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(tomorrow);
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: full("2026-10-13") }));
    expect(onChange).toHaveBeenCalledWith("2026-10-13");
  });

  it("keeps one tab stop and moves it with the arrow keys, paging across months", async () => {
    render(<Harness />);
    const stops = Array.from(document.querySelectorAll(".dayframe-calendar-grid button")).filter((button) => button.getAttribute("tabindex") === "0");
    expect(stops.map((button) => button.getAttribute("data-date"))).toEqual(["2026-10-14"]);
    const chosen = screen.getByRole("button", { name: full("2026-10-14") });
    chosen.focus();
    await act(async () => { fireEvent.keyDown(chosen, { key: "ArrowDown" }); });
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-21");
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "PageDown" }); });
    // November: the page turned and focus is on 21 November.
    expect(document.querySelector(".dayframe-calendar header strong")!.textContent).toBe("November 2026");
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-11-21");
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "Home" }); });
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-11-16");
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "End" }); });
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-11-22");
  });

  it("works out each key's day, clamping a month move to the month's last day", () => {
    expect(keyTarget("ArrowLeft", "2026-10-01")).toBe("2026-09-30");
    expect(keyTarget("ArrowUp", "2026-10-03")).toBe("2026-09-26");
    expect(keyTarget("PageDown", "2026-01-31")).toBe("2026-02-28");
    expect(keyTarget("PageUp", "2026-03-31")).toBe("2026-02-28");
    expect(keyTarget("Home", "2026-10-18")).toBe("2026-10-12");
    expect(keyTarget("Tab", "2026-10-18")).toBeNull();
  });
});
