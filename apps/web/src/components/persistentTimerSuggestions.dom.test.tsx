// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

describe("PersistentTimerBar task suggestions", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.open = true;
      }
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() {
        this.open = false;
      }
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("opens Add Time suggestions from empty focus and dismisses them outside the actual input", async () => {
    runtime = runtimeFixture({ isManualEntryOpen: true });
    render(<PersistentTimerBar />);

    const description = await screen.findByLabelText("Manual time entry description") as HTMLInputElement;
    expect(await screen.findByRole("listbox", { name: "Suggestions" })).not.toBeNull();
    expect(description.value).toBe("");

    const field = description.closest(".manual-entry-description");
    if (!field) throw new Error("Missing Add Time description field");
    await userEvent.click(field);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());

    await userEvent.click(description);
    await userEvent.click(await screen.findByRole("option", { name: /Deep planning/ }));
    expect(description.value).toBe("Deep planning");
    expect(screen.getByRole("button", { name: /Focus/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove tag Deep work" })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());
  });

  it("shows suggestions for an empty Uncategorized running toolbar without starting another timer", async () => {
    const startTimer = vi.fn().mockResolvedValue({ ok: true });
    const setTimerDraft = vi.fn();
    runtime = runtimeFixture({
      activeEntry: timeEntry({ description: null, categoryId: null, categoryName: null }),
      setTimerDraft,
      startTimer
    });
    render(<PersistentTimerBar />);

    const description = screen.getByLabelText("Task description") as HTMLInputElement;
    fireEvent.focus(description);
    expect(await screen.findByRole("listbox", { name: "Suggestions" })).not.toBeNull();
    await userEvent.click(screen.getByRole("option", { name: /Deep planning/ }));

    expect(setTimerDraft).toHaveBeenCalledWith({
      categoryId: "focus",
      description: "Deep planning",
      tagNames: ["Deep work"]
    });
    expect(startTimer).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());
  });
});

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  isManualEntryOpen?: boolean;
  setTimerDraft?: ReturnType<typeof vi.fn>;
  startTimer?: ReturnType<typeof vi.fn>;
} = {}) {
  const activeEntry = overrides.activeEntry ?? null;
  const data = {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: false }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags: [{ id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 2 }],
    taskSuggestions: [{
      key: "deep-planning",
      categoryId: "focus",
      categoryName: "Focus",
      categoryColor: "mint",
      description: "Deep planning",
      lastSeenAt: "2026-08-14T08:00:00.000Z",
      score: 10,
      section: "recent",
      useCount: 3,
      totalSeconds: 10_800,
      tagNames: ["Deep work"]
    }]
  } as unknown as BootstrapData;
  return {
    clearTimerError: vi.fn(),
    closeManualEntry: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({ ok: true }),
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
    isManualEntryOpen: overrides.isManualEntryOpen ?? false,
    isTimerBusy: false,
    openManualEntry: vi.fn(),
    setTimerDraft: overrides.setTimerDraft ?? vi.fn(),
    shellData: data,
    startTimer: overrides.startTimer ?? vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: { categoryId: "", description: "", tagNames: [] },
    timerError: null,
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
  };
}

function timeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "running-entry",
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
    durationSeconds: 3_600,
    tagNames: [],
    tags: [],
    ...overrides
  };
}
