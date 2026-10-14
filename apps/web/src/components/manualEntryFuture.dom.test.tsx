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
  it("defaults to the hour ending now, not the future day", () => {
    runtime = runtimeFixture("2026-10-16");
    render(<PersistentTimerBar />);
    const start = document.querySelector<HTMLInputElement>('input[name="startedAt"]')!;
    const finish = document.querySelector<HTMLInputElement>('input[name="stoppedAt"]')!;
    expect(start.value).toBe("2026-10-14T10:00");
    expect(finish.value).toBe("2026-10-14T11:00");
  });

  it("refuses a finish after today and adds nothing", async () => {
    runtime = runtimeFixture("2026-10-14");
    render(<PersistentTimerBar />);
    const finish = document.querySelector<HTMLInputElement>('input[name="stoppedAt"]')!;
    fireEvent.change(finish, { target: { value: "2026-10-15T09:00" } });
    finish.value = "2026-10-15T09:00";
    const form = finish.closest("form")!;
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByText("Add time can't go past today.")).not.toBeNull();
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
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
