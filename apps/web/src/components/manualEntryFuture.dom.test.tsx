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

  it("refuses a finish after today and adds nothing", async () => {
    runtime = runtimeFixture("2026-10-14");
    render(<PersistentTimerBar />);
    // An End earlier than Start is the next day: tomorrow, after today.
    const finish = screen.getByLabelText("End time") as HTMLInputElement;
    fireEvent.change(finish, { target: { value: "09:00" } });
    fireEvent.blur(finish);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    });
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
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
