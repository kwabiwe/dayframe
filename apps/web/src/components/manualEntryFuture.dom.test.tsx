// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 14, 11, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// Owner decision D2 (14 Oct 2026; Codex r1 on #422): Add time never adds a day after today, even
// when Calendar is showing one.
describe("Add time with a future day selected", () => {
  it("opens the shared New block editor on the hour ending now, not the future day (WUI-025)", () => {
    runtime = runtimeFixture("2026-10-16");
    render(<PersistentTimerBar />);
    expect(screen.getByRole("dialog", { name: "New block" })).not.toBeNull();
    expect(screen.getByText("Wednesday 14 October")).not.toBeNull();
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("11:00");
    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("1h");
  });

  it("refuses a finish on a day after today (a duration carried past midnight) and adds nothing", async () => {
    runtime = runtimeFixture("2026-10-14");
    render(<PersistentTimerBar />);
    // 10:00 + 15h ends at 01:00 tomorrow.
    const duration = screen.getByLabelText("Duration") as HTMLInputElement;
    fireEvent.change(duration, { target: { value: "15h" } });
    fireEvent.blur(duration);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Finish can't be on a day after today.");
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
  });

  it("adds a window later today, as Add time always could (Codex r1 on #468)", async () => {
    runtime = runtimeFixture("2026-10-14");
    render(<PersistentTimerBar />);
    const start = screen.getByLabelText("Start time") as HTMLInputElement;
    fireEvent.change(start, { target: { value: "12:00" } });
    fireEvent.blur(start);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    });
    expect(runtime.createManualEntry).toHaveBeenCalledTimes(1);
    const input = (runtime.createManualEntry as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new Date(input.startedAt).getHours()).toBe(12);
    expect(new Date(input.stoppedAt).getHours()).toBe(13);
  });

  it("returns focus to Add time's button when what opened it is gone (the palette; Codex r1 on #468)", async () => {
    const paletteInput = document.createElement("input");
    document.body.append(paletteInput);
    paletteInput.focus();
    runtime = runtimeFixture("2026-10-14");
    const { rerender } = render(<PersistentTimerBar />);
    // The palette closes as Add time opens.
    paletteInput.remove();
    runtime = { ...runtime, isManualEntryOpen: false };
    rerender(<PersistentTimerBar />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add time manually" }));
  });

  it("adds the block through Add time's own rules", async () => {
    runtime = runtimeFixture("2026-10-14");
    render(<PersistentTimerBar />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    });
    expect(runtime.createManualEntry).toHaveBeenCalledTimes(1);
    const input = (runtime.createManualEntry as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new Date(input.startedAt).getHours()).toBe(10);
    expect(new Date(input.stoppedAt).getHours()).toBe(11);
  });
});

function runtimeFixture(selectedDate: string) {
  const data = {
    activeEntry: null,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
    categoryUsage: [],
    dateRange: { selectedDate },
    entries: [],
    tags: [],
    taskSuggestions: []
  } as unknown as BootstrapData;
  return {
    clearTimerError: vi.fn(),
    closeManualEntry: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({ ok: true }),
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
    isManualEntryOpen: true,
    isTimerBusy: false,
    openManualEntry: vi.fn(),
    setTimerDraft: vi.fn(),
    shellData: data,
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: { categoryId: "", description: "", tagNames: [] },
    timerError: null,
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
  };
}
