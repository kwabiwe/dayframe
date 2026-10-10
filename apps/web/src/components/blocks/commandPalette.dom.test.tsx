// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basePaletteCommands } from "@/lib/command-palette";

const mocks = vi.hoisted(() => ({ clientFetch: vi.fn() }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.clientFetch }));

const { CommandPalette } = await import("./CommandPalette");

const commands = basePaletteCommands({
  activities: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
  theme: "dark"
});

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  mocks.clientFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPalette() {
  const onRun = vi.fn();
  const onStartTyped = vi.fn();
  render(<CommandPalette commands={commands} onClose={vi.fn()} onRun={onRun} onStartTyped={onStartTyped} />);
  const input = screen.getByRole("combobox", { name: "Search and commands" });
  return { input, onRun, onStartTyped };
}

describe("CommandPalette", () => {
  it("moves the active option with the arrow keys and runs it with Enter", () => {
    const { input, onRun } = renderPalette();
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "shortcuts" }));
  });

  it("filters as you type and runs a clicked option", () => {
    const { input, onRun } = renderPalette();
    fireEvent.change(input, { target: { value: "cal" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["CalendarG C"]);
    fireEvent.click(screen.getByRole("option", { name: /Calendar/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: "navigate", href: "/timeline" } }));
  });

  it("adds past work from search and starts the typed text when nothing matches", async () => {
    vi.useFakeTimers();
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const { input, onStartTyped } = renderPalette();
    fireEvent.change(input, { target: { value: "Quarterly memo" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.clientFetch).toHaveBeenCalledWith("/api/search?q=Quarterly%20memo", expect.anything());
    expect(screen.getByText(/Press Enter to start a block called/)).not.toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onStartTyped).toHaveBeenCalledWith("Quarterly memo");
  });

  it("shows search results as Start again", async () => {
    vi.useFakeTimers();
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ results: [{
      id: "activity:1", kind: "activity", label: "Quarterly memo", detail: "Focus", occurredAt: null, entryId: null,
      categoryId: "focus", categoryName: "Focus", categoryColor: "mint", placeId: null, description: "Quarterly memo",
      tagNames: [], startedAt: null, stoppedAt: null, durationSeconds: null
    }] }), { status: 200 }));
    const { input, onRun } = renderPalette();
    fireEvent.change(input, { target: { value: "memo" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText("Start again")).not.toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ group: "Start again" }));
  });
});
