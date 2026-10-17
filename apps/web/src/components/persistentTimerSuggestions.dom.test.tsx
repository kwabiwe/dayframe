// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor , within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

describe("PersistentTimerBar block suggestions", () => {
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

    // Add time is the shared New block editor (WUI-025); the timer bar keeps its own Description.
    const editor = await screen.findByRole("dialog", { name: "New block" });
    const description = within(editor).getByLabelText("Description") as HTMLInputElement;
    expect(await screen.findByRole("listbox", { name: "Suggestions" })).not.toBeNull();
    expect(description.value).toBe("");

    const field = description.closest(".time-entry-quick-description");
    if (!field) throw new Error("Missing the New block description field");
    await userEvent.click(field);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());

    await userEvent.click(description);
    await userEvent.click(await screen.findByRole("option", { name: /Deep planning/ }));
    expect(description.value).toBe("Deep planning");
    expect(within(editor).getByRole("radio", { name: "Focus" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Remove tag Deep work" })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull());
  });

  it("shows suggestions for an empty Uncategorized running toolbar without starting another block", async () => {
    const startTimer = vi.fn().mockResolvedValue({ ok: true });
    const setTimerDraft = vi.fn();
    runtime = runtimeFixture({
      activeEntry: timeEntry({ description: null, categoryId: null, categoryName: null }),
      setTimerDraft,
      startTimer
    });
    render(<PersistentTimerBar />);

    const description = screen.getByLabelText("Description") as HTMLInputElement;
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

  it("keeps a running block's suggestions keyboard-usable while its autosave is in flight", async () => {
    const setTimerDraft = vi.fn();
    runtime = runtimeFixture({
      activeEntry: timeEntry({ description: "De" }),
      isTimerBusy: true,
      setTimerDraft,
      timerDraft: { categoryId: "", description: "De", tagNames: [] }
    });
    render(<PersistentTimerBar />);

    const description = screen.getByLabelText("Description") as HTMLInputElement;
    await userEvent.click(description);
    expect(await screen.findByRole("listbox", { name: "Suggestions" })).not.toBeNull();
    await userEvent.keyboard("{ArrowDown}");

    const first = screen.getByRole("option", { name: /Deep planning/ });
    expect(document.activeElement).toBe(first);
    expect((first as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("listbox", { name: "Suggestions" })).not.toBeNull();
    expect(first.closest(".swiss-task-suggestions")?.classList.contains("is-open")).toBe(true);

    await userEvent.keyboard("{Enter}");
    expect(setTimerDraft).toHaveBeenCalledWith({
      categoryId: "focus",
      description: "Deep planning",
      tagNames: ["Deep work"]
    });
  });
});

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  isManualEntryOpen?: boolean;
  isTimerBusy?: boolean;
  setTimerDraft?: ReturnType<typeof vi.fn>;
  startTimer?: ReturnType<typeof vi.fn>;
  timerDraft?: { categoryId: string; description: string; tagNames: string[] };
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
    isTimerBusy: overrides.isTimerBusy ?? false,
    openManualEntry: vi.fn(),
    setTimerDraft: overrides.setTimerDraft ?? vi.fn(),
    shellData: data,
    startTimer: overrides.startTimer ?? vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: overrides.timerDraft ?? { categoryId: "", description: "", tagNames: [] },
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
