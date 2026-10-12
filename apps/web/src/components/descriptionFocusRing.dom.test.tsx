// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Trello 213 (Codex r1): the command timer's Description shows its neutral perimeter for keyboard,
// shortcut, programmatic and assistive-technology focus only — never after a click or tap.
let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe.each([
  ["idle", null],
  ["running", runningEntry()]
] as const)("command timer Description focus ring (%s)", (_state, activeEntry) => {
  function setup() {
    runtime = runtimeFixture(activeEntry);
    render(<PersistentTimerBar />);
    const description = screen.getByLabelText("Description") as HTMLInputElement;
    const field = description.closest(".swiss-timer-description-control");
    if (!(field instanceof HTMLElement)) throw new Error("Missing Description wrapper");
    return { description, field };
  }

  it("a click or tap focuses the field without the keyboard ring, and typing keeps it off", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();

    await user.click(description);
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBeUndefined();

    await user.type(description, "Plan");
    expect(field.dataset.focusRing).toBeUndefined();
  });

  it("Tab focus shows the keyboard ring; a later click hides it; leaving clears it", async () => {
    const user = userEvent.setup();
    const { description, field } = setup();

    for (let step = 0; step < 12 && document.activeElement !== description; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBe("keyboard");

    await user.click(description);
    expect(field.dataset.focusRing).toBeUndefined();

    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(description);
    expect(field.dataset.focusRing).toBe("keyboard");

    act(() => description.blur());
    expect(field.dataset.focusRing).toBeUndefined();
  });

  it("focus moved by a shortcut, script or assistive technology shows the keyboard ring", () => {
    const { description, field } = setup();

    // The N shortcut: a keydown, then the shell focuses the field.
    fireEvent.keyDown(window, { key: "n" });
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");

    act(() => description.blur());
    // Assistive technology or script focus with no pointer press at all.
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");
  });

  it("a keydown after a pointer press that focused nothing restores keyboard focus visibility", () => {
    const { description, field } = setup();

    fireEvent.pointerDown(field);
    fireEvent.keyDown(window, { key: "Tab" });
    act(() => description.focus());
    expect(field.dataset.focusRing).toBe("keyboard");
  });
});

function runtimeFixture(activeEntry: TimeEntryRow | null) {
  const data = {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
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

function runningEntry(): TimeEntryRow {
  return {
    id: "running-entry",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "mint",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Deep planning",
    startedAt: "2026-08-14T09:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-14T09:00:00.000Z",
    durationSeconds: 3_600,
    tagNames: [],
    tags: []
  } as TimeEntryRow;
}
