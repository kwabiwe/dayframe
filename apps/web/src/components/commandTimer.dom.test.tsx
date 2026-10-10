// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("Blocks command timer", () => {
  it("logs a finished block ending now for a trailing duration, with the @activity", async () => {
    runtime = runtimeFixture({ description: "Plan launch @foc 45m", tagNames: ["Deep work"] });
    render(<PersistentTimerBar />);

    const add = screen.getByRole("button", { name: "Add 45m ending now" });
    expect(screen.getByText("logs a finished block ending now")).not.toBeNull();
    await act(async () => { fireEvent.click(add); });

    const createManualEntry = runtime.createManualEntry as ReturnType<typeof vi.fn>;
    expect(createManualEntry).toHaveBeenCalledTimes(1);
    const input = createManualEntry.mock.calls[0][0];
    expect(input).toMatchObject({ categoryId: "focus", description: "Plan launch", tagNames: ["Deep work"] });
    expect(Date.parse(input.stoppedAt) - Date.parse(input.startedAt)).toBe(45 * 60 * 1000);
    expect(runtime.startTimer).not.toHaveBeenCalled();
    const clear = (runtime.setTimerDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as (draft: unknown) => unknown;
    const submitted = { categoryId: "", description: "Plan launch @foc 45m", tagNames: ["Deep work"] };
    expect(clear(submitted)).toEqual({ categoryId: "", description: "", tagNames: [] });
    // Text typed while the add was in flight is kept.
    const newer = { categoryId: "", description: "Next task", tagNames: [] };
    expect(clear(newer)).toBe(newer);
    expect(screen.getByText("Added 45m to Focus.")).not.toBeNull();
  });

  it("puts a rejected shorthand Start back in the bar, unless something newer was typed", async () => {
    runtime = runtimeFixture({ description: "Plan launch @focus" });
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "Offline" });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start timer" })); });
    const restore = (runtime.setTimerDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as (draft: unknown) => unknown;
    expect(restore({ categoryId: "", description: "", tagNames: [] })).toEqual({ categoryId: "", description: "Plan launch @focus", tagNames: [] });
    const newer = { categoryId: "", description: "Other", tagNames: [] };
    expect(restore(newer)).toBe(newer);
  });

  it("shows the typed @activity on the activity square", () => {
    runtime = runtimeFixture({ description: "Plan @writ" });
    render(<PersistentTimerBar />);
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
  });

  it("starts the timer with the @activity removed from the description", async () => {
    runtime = runtimeFixture({ description: "Plan launch @focus" });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start timer" })); });
    expect(runtime.startTimer).toHaveBeenCalledWith({ categoryId: "focus", description: "Plan launch", tagNames: [] });
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
  });

  it("keeps a failed add's text and shows why", async () => {
    runtime = runtimeFixture({ description: "Plan 1h" });
    (runtime.createManualEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "That time overlaps." });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add 1h 00m ending now" })); });
    expect(runtime.setTimerDraft).not.toHaveBeenCalled();
    expect(screen.getByText("That time overlaps.")).not.toBeNull();
  });

  it("starts pinned quick starts with keys 1–6, but not while typing or with a popup open", () => {
    runtime = runtimeFixture();
    render(<PersistentTimerBar />);
    const startTimer = runtime.startTimer as ReturnType<typeof vi.fn>;

    fireEvent.keyDown(screen.getByLabelText("Task description"), { key: "1" });
    expect(startTimer).not.toHaveBeenCalled();

    const popup = document.createElement("button");
    popup.setAttribute("aria-haspopup", "menu");
    popup.setAttribute("aria-expanded", "true");
    document.body.append(popup);
    fireEvent.keyDown(document.body, { key: "1" });
    expect(startTimer).not.toHaveBeenCalled();
    popup.remove();

    fireEvent.keyDown(document.body, { key: "1", metaKey: true });
    fireEvent.keyDown(document.body, { key: "1", repeat: true });
    expect(startTimer).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(startTimer).toHaveBeenCalledWith({ categoryId: "write", description: "", tagNames: [] });
  });

  it("draws quick starts as activity blocks with their key and marks the one recording", () => {
    runtime = runtimeFixture({ activeEntry: timeEntry({ categoryId: "write", categoryName: "Writing" }) });
    render(<PersistentTimerBar />);
    const recording = screen.getByRole("button", { name: "Recording Writing (2)" });
    expect(recording.className).toContain("df-block");
    expect(recording.className).toContain("is-recording");
    expect(recording.getAttribute("style")).toContain("--block: light-dark(");
    expect(screen.getByRole("button", { name: "Start Focus (1)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Stop timer" })).not.toBeNull();
  });
});

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  description?: string;
  tagNames?: string[];
} = {}) {
  const activeEntry = overrides.activeEntry ?? null;
  const data = {
    activeEntry,
    categories: [
      { id: "focus", name: "Focus", color: "mint", isPinned: true },
      { id: "write", name: "Writing", color: "blue", isPinned: true }
    ],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags: [{ id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 2 }],
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
    timerDraft: {
      categoryId: activeEntry?.categoryId ?? "",
      description: overrides.description ?? "",
      tagNames: overrides.tagNames ?? []
    },
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

describe("Space shortcut contract", () => {
  it("ignores a held Space so one press makes one timer change", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");
    expect(shell).toMatch(/if \(bare && event\.code === "Space"\) \{[\s\S]*?if \(event\.repeat\) return;[\s\S]*?void toggleTimer\(\);/);
  });
});
