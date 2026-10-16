// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ActivityChipGroup, editorChipCategories } from "./ActivityChipGroup";
import type { CategoryRow } from "@/lib/queries";

const category = (id: string, isPinned = false) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: "blue", isPinned }) as unknown as CategoryRow;
const all = ["work", "gym", "read", "admin", "call", "cook", "walk", "sleep", "music"].map((id, index) => category(id, index >= 7));

afterEach(cleanup);

describe("Activity chips (UIA-201 entry editor)", () => {
  it("keeps a stable order (pinned first) so choosing never moves the chips; an off-list choice takes the last place", () => {
    const shown = editorChipCategories(all, "");
    expect(shown.map((c) => c.id)).toEqual(["sleep", "music", "work", "gym", "read", "admin", "call"]);
    expect(editorChipCategories(all, "gym").map((c) => c.id)).toEqual(shown.map((c) => c.id));
    expect(editorChipCategories(all, "walk").map((c) => c.id)).toEqual(["sleep", "music", "work", "gym", "read", "admin", "walk"]);
  });

  it("is a radio group: choose, choose again to clear, arrow keys move and choose", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ActivityChipGroup categories={all.slice(0, 3)} onSelect={onSelect} selectedId="gym" />);
    const gym = screen.getByRole("radio", { name: "Gym" });
    expect(gym.getAttribute("aria-checked")).toBe("true");
    expect(gym.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Work" }).tabIndex).toBe(-1);
    fireEvent.click(gym);
    expect(onSelect).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("radio", { name: "Read" }));
    expect(onSelect).toHaveBeenLastCalledWith("read");
    fireEvent.keyDown(gym, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("read");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Read" }));
    onSelect.mockClear();
    fireEvent.keyDown(gym, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(gym, { key: "ArrowRight", metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<ActivityChipGroup categories={all.slice(0, 3)} onSelect={onSelect} selectedId="" />);
    expect(screen.getByRole("radio", { name: "Work" }).tabIndex).toBe(0);
  });

  it("drops chips from the end, never the chosen one, until they and All activities fit in two rows (owner, 16 Oct 2026)", () => {
    // Three items to a row: each chip's and the trailing control's place in the flow sets its top.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const group = this.closest(".df-ed-chips");
      const items = group ? [...group.querySelectorAll(".df-rchips > .df-rchip"), ...[...group.children].filter((child) => !child.classList.contains("df-rchips"))] : [];
      const position = items.indexOf(this);
      const top = position < 0 ? 0 : Math.floor(position / 3) * 40;
      return { top, bottom: top + 32, left: 0, right: 300, width: 300, height: 32, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const seven = all.slice(0, 7);
    render(
      <ActivityChipGroup
        categories={seven}
        maxRows={2}
        onSelect={vi.fn()}
        selectedId="cook"
        trailing={<button className="df-rchip df-rchip--more" type="button">All activities</button>}
      />
    );
    const names = screen.getAllByRole("radio").map((chip) => chip.textContent);
    // Five chips and All activities make two rows of three; the chosen Cook keeps the last place.
    expect(names).toEqual(["Work", "Gym", "Read", "Admin", "Cook"]);
    expect(screen.getByRole("radio", { name: "Cook" }).getAttribute("aria-checked")).toBe("true");
    vi.restoreAllMocks();
  });

  it("counts a shorter control centred in a taller row as that row (44 px chips, 32 px trailing)", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const group = this.closest(".df-ed-chips");
      const items = group ? [...group.querySelectorAll(".df-rchips > .df-rchip"), ...[...group.children].filter((child) => !child.classList.contains("df-rchips"))] : [];
      const position = items.indexOf(this);
      const trailing = this.classList.contains("df-rchip--more");
      const top = position < 0 ? 0 : Math.floor(position / 3) * 50 + (trailing ? 6 : 0);
      const height = trailing ? 32 : 44;
      return { top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    render(
      <ActivityChipGroup
        categories={all.slice(0, 5)}
        maxRows={2}
        onSelect={vi.fn()}
        selectedId=""
        trailing={<button className="df-rchip df-rchip--more" type="button">All activities</button>}
      />
    );
    // Five chips and the control are two rows of three: nothing drops.
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    vi.restoreAllMocks();
  });

  it("shows every chip without maxRows", () => {
    render(<ActivityChipGroup categories={all.slice(0, 7)} onSelect={vi.fn()} selectedId="" trailing={<button type="button">All activities</button>} />);
    expect(screen.getAllByRole("radio")).toHaveLength(7);
  });
});
