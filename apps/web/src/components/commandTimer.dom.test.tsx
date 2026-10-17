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

describe("Blocks command block", () => {
  it("logs a finished block ending now for a trailing duration, with the chosen activity", async () => {
    runtime = runtimeFixture({ categoryId: "focus", description: "Plan launch 45m", tagNames: ["Deep work"] });
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
    const submitted = { categoryId: "focus", description: "Plan launch 45m", tagNames: ["Deep work"] };
    expect(clear(submitted)).toEqual({ categoryId: "", description: "", tagNames: [] });
    // Text typed while the add was in flight is kept.
    const newer = { categoryId: "", description: "Next block", tagNames: [] };
    expect(clear(newer)).toBe(newer);
    expect(screen.getByText("Added 45m to Focus.")).not.toBeNull();
  });

  // Codex r5 on #361: only a choice from the `@` Activities list sets the activity and removes
  // its `@query`; an `@word` left in the text is description text, saved as written.
  it("a typed @word left in the text does not change the activity square", () => {
    runtime = runtimeFixture({ description: "Plan @writ" });
    render(<PersistentTimerBar />);
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
  });

  it("starts the block with a typed @word kept as description text", async () => {
    runtime = runtimeFixture({ description: "Plan launch @focus" });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start a block" })); });
    expect(runtime.startTimer).toHaveBeenCalledWith({ categoryId: "", description: "Plan launch @focus", tagNames: [] });
    expect(runtime.createManualEntry).not.toHaveBeenCalled();
  });

  it("keeps a failed add's text and shows why", async () => {
    runtime = runtimeFixture({ description: "Plan 1h" });
    (runtime.createManualEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "That time overlaps." });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add 1h ending now" })); });
    expect(runtime.setTimerDraft).not.toHaveBeenCalled();
    expect(screen.getByText("That time overlaps.")).not.toBeNull();
  });

  it("starts pinned quick starts with keys 1–6, but not while typing or with a popup open", () => {
    runtime = runtimeFixture();
    render(<PersistentTimerBar />);
    const startTimer = runtime.startTimer as ReturnType<typeof vi.fn>;

    fireEvent.keyDown(screen.getByLabelText("Description"), { key: "1" });
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
    expect(startTimer).toHaveBeenCalledWith({ categoryId: "write", description: "", tagNames: [] }, { dedupeRunning: true });
  });

  it("draws quick starts as activity blocks with their key and marks the one recording", () => {
    runtime = runtimeFixture({ activeEntry: timeEntry({ categoryId: "write", categoryName: "Writing" }) });
    render(<PersistentTimerBar />);
    const recording = screen.getByRole("button", { name: "Recording Writing (2)" });
    expect(recording.className).toContain("df-block");
    expect(recording.className).toContain("is-recording");
    expect(recording.getAttribute("style")).toContain("--block: light-dark(");
    expect(screen.getByRole("button", { name: "Start Focus (1)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Stop recording" })).not.toBeNull();
  });
});

describe("Command block menus and switch toasts (UIA-202/209/210)", () => {
  it("says Switched with the time logged to the block it replaced, without Undo", async () => {
    const running = timeEntry({ categoryId: "focus", categoryName: "Focus", description: "Plan launch" });
    runtime = runtimeFixture({ activeEntry: running });
    // The toast names what the Start actually replaced when it ran (here an earlier queued block),
    // timed to the switch, not the block on screen when the quick start was pressed.
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      own: true,
      alreadyRunning: false,
      unchanged: null,
      replaced: { ...running, id: "queued", description: "Standup", startedAt: "2026-08-14T09:30:00.000Z" },
      switchedAt: "2026-08-14T09:42:00.000Z"
    });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Writing (2)" })); });
    expect(runtime.startTimer).toHaveBeenCalledWith({ categoryId: "write", description: "", tagNames: [] }, { dedupeRunning: true });
    // Two lines, as on iPhone (owner decision 15 Oct 2026): the message over a muted detail.
    expect(screen.getByRole("status").querySelector(".df-toast-message")?.textContent).toBe("Switched to Writing");
    expect(screen.getByRole("status").querySelector(".df-toast-detail")?.textContent).toBe("12m logged to Standup");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says Already recording when the Start found exactly that block running", async () => {
    const running = timeEntry({ categoryId: "focus", categoryName: "Focus" });
    runtime = runtimeFixture({ activeEntry: running });
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, own: true, alreadyRunning: true, unchanged: running, replaced: null, switchedAt: "2026-08-14T09:42:00.000Z"
    });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Recording Focus (1)" })); });
    // The decision is the mutation owner's (it runs after anything queued), not the bar's.
    expect(runtime.startTimer).toHaveBeenCalledWith({ categoryId: "focus", description: "", tagNames: [] }, { dedupeRunning: true });
    expect(screen.getByRole("status").textContent).toContain("Already recording Focus");
  });

  it("announces nothing for a Start a later Start superseded", async () => {
    runtime = runtimeFixture({ activeEntry: timeEntry({ categoryId: "focus", categoryName: "Focus" }) });
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, own: false, alreadyRunning: false, unchanged: null,
      replaced: timeEntry({ categoryId: "focus", categoryName: "Focus" }), switchedAt: "2026-08-14T09:42:00.000Z"
    });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Writing (2)" })); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows no toast for a start with nothing running, or a rejected switch", async () => {
    runtime = runtimeFixture();
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Focus (1)" })); });
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    runtime = runtimeFixture({ activeEntry: timeEntry({ categoryId: "focus", categoryName: "Focus" }) });
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "Offline" });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start Writing (2)" })); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the running block's menu action Discard running block", () => {
    runtime = runtimeFixture({ activeEntry: timeEntry({ categoryId: "focus", categoryName: "Focus" }) });
    render(<PersistentTimerBar />);
    expect(screen.getByRole("menuitem", { hidden: true }).textContent).toContain("Discard running block");
  });

  it("discards the running block at once and offers Undo, which starts it again at its own start (WUI-008)", async () => {
    const running = timeEntry({ categoryId: "focus", categoryName: "Focus", description: "Plan launch" });
    runtime = runtimeFixture({ activeEntry: running, description: "Plan launch", tagNames: ["Deep work"] });
    const { rerender } = render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { hidden: true })); });
    expect(runtime.deleteActiveTimer).toHaveBeenCalledTimes(1);
    // The runtime now has nothing running.
    runtime = { ...runtime, shellData: { ...(runtime.shellData as BootstrapData), activeEntry: null, entries: [] } };
    rerender(<PersistentTimerBar />);
    expect(screen.getByRole("status").textContent).toContain("Discarded Plan launch");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(runtime.startTimer).toHaveBeenCalledWith(
      { categoryId: "focus", description: "Plan launch", tagNames: ["Deep work"] },
      expect.objectContaining({ startedAt: running.startedAt })
    );
    // The restore is checked inside the timer's queue: refused once something covers that time.
    const { guard } = (runtime.startTimer as ReturnType<typeof vi.fn>).mock.calls[0][1] as { guard: (snapshot: BootstrapData) => string | null };
    const covering = timeEntry({ id: "b", startedAt: "2026-08-14T09:30:00.000Z", stoppedAt: "2026-08-14T09:40:00.000Z" });
    expect(guard({ ...(runtime.shellData as BootstrapData), activeEntry: null, entries: [covering] })).toContain("covers that time");
    expect(guard({ ...(runtime.shellData as BootstrapData), activeEntry: null, entries: [] })).toBeNull();
  });

  it("says why a refused restore cannot happen, and offers Try again with the same start after a failure (Codex r1 on #469)", async () => {
    const running = timeEntry({ categoryId: "focus", categoryName: "Focus", description: "Plan launch" });
    runtime = runtimeFixture({ activeEntry: running, description: "Plan launch" });
    const { rerender } = render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { hidden: true })); });
    runtime = { ...runtime, shellData: { ...(runtime.shellData as BootstrapData), activeEntry: null, entries: [] } };
    rerender(<PersistentTimerBar />);

    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: "Unable to start the block: 503" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(screen.getByRole("status").textContent).toContain("Couldn't bring back Plan launch.");
    (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: "Another block now covers that time, so the discarded one can't come back." });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    const calls = (runtime.startTimer as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(expect.objectContaining({ startedAt: running.startedAt }));
    // Refused: the reason, and no button to press again.
    expect(screen.getByRole("status").textContent).toContain("covers that time");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("hides Undo once another block is running, and adds no toast when the discard fails", async () => {
    const running = timeEntry({ categoryId: "focus", categoryName: "Focus", description: "Plan launch" });
    runtime = runtimeFixture({ activeEntry: running, description: "Plan launch" });
    const { rerender } = render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { hidden: true })); });
    // Something else started meanwhile: no Undo, so it is never replaced by the discarded block.
    runtime = { ...runtime, shellData: { ...(runtime.shellData as BootstrapData), activeEntry: timeEntry({ id: "other", description: "Other" }) } };
    rerender(<PersistentTimerBar />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();

    cleanup();
    runtime = runtimeFixture({ activeEntry: running, description: "Plan launch" });
    (runtime.deleteActiveTimer as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: "Offline" });
    render(<PersistentTimerBar />);
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { hidden: true })); });
    expect(screen.queryByText(/Discarded/)).toBeNull();
  });
});

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  categoryId?: string;
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
      categoryId: overrides.categoryId ?? activeEntry?.categoryId ?? "",
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
  it("ignores a held Space so one press makes one block change", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");
    expect(shell).toMatch(/if \(bare && event\.code === "Space"\) \{[\s\S]*?if \(event\.repeat\) return;[\s\S]*?void toggleTimer\(\);/);
  });
});
