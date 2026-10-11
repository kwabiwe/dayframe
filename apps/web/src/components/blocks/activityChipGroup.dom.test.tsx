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
    rerender(<ActivityChipGroup categories={all.slice(0, 3)} onSelect={onSelect} selectedId="" />);
    expect(screen.getByRole("radio", { name: "Work" }).tabIndex).toBe(0);
  });
});
