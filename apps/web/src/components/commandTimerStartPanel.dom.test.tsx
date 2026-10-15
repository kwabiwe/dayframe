// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

const MINUTE = 60_000;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// The running block's "Start date and time" panel in the #391 floating-panel language (owner,
// 15 Oct 2026): the shared date picker and a typed time instead of the native inputs, "Set to last
// stop time · HH:MM" and a Blocks button pair.
describe("command timer start panel", () => {
  it("sets the start to the last stop time and saves it with the Blocks Save", async () => {
    const now = Date.now();
    const stoppedAt = new Date(now - 45 * MINUTE);
    stoppedAt.setSeconds(0, 0);
    runtime = runtimeFixture({ runningSince: new Date(now - 30 * MINUTE), lastStop: stoppedAt });
    render(<PersistentTimerBar />);

    await userEvent.click(screen.getByRole("button", { name: /^Edit start date and time/ }));
    const panel = screen.getByRole("dialog", { name: "Start date and time" });
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(panel.querySelector(".df-flist-head")?.textContent).toBe("Start date and time");
    // No native date or time input.
    expect(panel.querySelector('input[type="date"], input[type="time"]')).toBeNull();

    const hhmm = `${String(stoppedAt.getHours()).padStart(2, "0")}:${String(stoppedAt.getMinutes()).padStart(2, "0")}`;
    const lastStop = screen.getByRole("button", { name: `Set to last stop time · ${hhmm}` });
    await userEvent.click(lastStop);
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe(hhmm);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(runtime.updateActiveStartTime).toHaveBeenCalledWith(stoppedAt.toISOString());
    await waitFor(() => expect(panel.classList.contains("is-open")).toBe(false));
  });

  it("takes a typed shorthand time and refuses a start in the future", async () => {
    const now = new Date();
    runtime = runtimeFixture({ runningSince: new Date(now.getTime() - 30 * MINUTE) });
    render(<PersistentTimerBar />);
    await userEvent.click(screen.getByRole("button", { name: /^Edit start date and time/ }));
    const time = screen.getByLabelText("Time") as HTMLInputElement;
    await userEvent.clear(time);
    await userEvent.type(time, "000");
    fireEvent.blur(time);
    expect(time.value).toBe("00:00");

    // A partial minute after a colon is its tens, never digits moved into the hour (owner, 15 Oct
    // 2026): `00:1` is 00:10, not 01:00 or 00:01.
    await userEvent.clear(time);
    await userEvent.type(time, "00:1");
    fireEvent.blur(time);
    expect(time.value).toBe("00:10");
    await userEvent.clear(time);
    await userEvent.type(time, "0:05");
    fireEvent.blur(time);
    expect(time.value).toBe("00:05");

    const later = new Date(now.getTime() + 90 * MINUTE);
    // Only meaningful while 90 minutes from now is still today.
    if (later.getDate() === now.getDate()) {
      await userEvent.clear(time);
      await userEvent.type(time, `${String(later.getHours()).padStart(2, "0")}${String(later.getMinutes()).padStart(2, "0")}`);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert").textContent).toBe("Start time cannot be in the future.");
      expect(runtime.updateActiveStartTime).not.toHaveBeenCalled();
    }
  });

  it("closes an open date picker on Escape before the panel, and a pick keeps the panel open", async () => {
    runtime = runtimeFixture({ runningSince: new Date(Date.now() - 30 * MINUTE) });
    render(<PersistentTimerBar />);
    await userEvent.click(screen.getByRole("button", { name: /^Edit start date and time/ }));
    const panel = screen.getByRole("dialog", { name: "Start date and time" });
    const trigger = panel.querySelector<HTMLButtonElement>(".df-start-date-trigger")!;

    await userEvent.click(trigger);
    const picker = await screen.findByRole("dialog", { name: "Choose start date" });
    expect(picker.classList.contains("is-open")).toBe(true);
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(picker.classList.contains("is-open")).toBe(false);
    expect(panel.classList.contains("is-open")).toBe(true);

    // A press inside the portalled picker is not a press outside the panel.
    await userEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Choose start date" }));
    expect(panel.classList.contains("is-open")).toBe(true);

    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(panel.classList.contains("is-open")).toBe(false);
  });
});

function runtimeFixture({ lastStop, runningSince }: { lastStop?: Date; runningSince: Date }) {
  const active = timeEntry({ id: "running", startedAt: runningSince.toISOString(), stoppedAt: null });
  const finished = lastStop
    ? [timeEntry({ id: "earlier", startedAt: new Date(lastStop.getTime() - 30 * MINUTE).toISOString(), stoppedAt: lastStop.toISOString() })]
    : [];
  const data = {
    activeEntry: active,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: [active, ...finished],
    tags: [],
    taskSuggestions: []
  } as unknown as BootstrapData;
  return {
    clearTimerError: vi.fn(),
    closeManualEntry: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({ ok: true }),
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
    isManualEntryOpen: false,
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

function timeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "entry",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: null,
    startedAt: "2026-08-14T09:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-14T09:00:00.000Z",
    durationSeconds: 1_800,
    tagNames: [],
    tags: [],
    ...overrides
  };
}
