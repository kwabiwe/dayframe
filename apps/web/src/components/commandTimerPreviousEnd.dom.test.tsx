// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar, PREVIOUS_END_CHANGED_NOTICE } = await import("./PersistentTimerBar");

// Local times, so "today" and the chip's HH:MM are the viewer's in any test time zone.
const local = (hours: number, minutes = 0, day = 14) => new Date(2026, 9, day, hours, minutes);
const iso = (hours: number, minutes = 0, day = 14) => local(hours, minutes, day).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(local(11, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("Start at the previous end (owner idea 1, 14 Oct 2026)", () => {
  it("offers today's last end once hydrated: Start, then the existing start edit to that end", async () => {
    const entries = [
      finished({ id: "a", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) }),
      finished({ id: "b", categoryName: "Reading", startedAt: iso(8, 0), stoppedAt: iso(9, 0) })
    ];
    runtime = runtimeFixture({ description: "Review notes", entries });
    const view = render(<PersistentTimerBar />);
    // The server render (and the first client render) has no offer.
    expect(screen.queryByRole("button", { name: /^Start from/ })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(0); });

    const chip = screen.getByRole("button", { name: "Start from 10:15, after Write report" });
    expect(chip.textContent).toBe("From 10:15");
    // UI review round 2: a small text button in the clock's fixed slot, with no glyph.
    expect(chip.classList.contains("df-cmd-from-text")).toBe(true);
    startsBlock(view, entries);
    await act(async () => { fireEvent.click(chip); });

    // One path (owner): the ordinary Start, then the same start-time edit as "Set to last stop time".
    expect(runtime.startTimer).toHaveBeenCalledWith({ categoryId: "", description: "Review notes", tagNames: [] });
    // Only the block this Start created.
    expect(runtime.updateActiveStartTime).toHaveBeenCalledWith(iso(10, 15), { expectedEntryIds: ["optimistic-timer:1", "run"] });
  });

  it("keeps the block at now and says so if a newer block has ended since", async () => {
    const entries = [finished({ id: "a", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) })];
    runtime = runtimeFixture({ entries });
    const view = render(<PersistentTimerBar />);
    await act(async () => { vi.advanceTimersByTime(0); });
    const chip = screen.getByRole("button", { name: "Start from 10:15, after Write report" });
    // By the time the Start lands, the loaded blocks include one that ended at 10:40.
    startsBlock(view, [...entries, finished({ id: "c", startedAt: iso(10, 20), stoppedAt: iso(10, 40) })]);
    await act(async () => { fireEvent.click(chip); });
    expect(runtime.updateActiveStartTime).not.toHaveBeenCalled();
    expect(screen.getByText(PREVIOUS_END_CHANGED_NOTICE)).not.toBeNull();
  });

  it("edits nothing when the Start was refused or another Start took over", async () => {
    for (const result of [{ ok: false, error: "Offline" }, { ok: true, own: false, alreadyRunning: false, startedEntryId: "x" }, { ok: true, own: true, alreadyRunning: false }]) {
      runtime = runtimeFixture({ entries: [finished({ id: "a", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) })] });
      (runtime.startTimer as ReturnType<typeof vi.fn>).mockResolvedValue(result);
      render(<PersistentTimerBar />);
      await act(async () => { vi.advanceTimersByTime(0); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Start from/ })); });
      expect(runtime.updateActiveStartTime).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("offers nothing while recording, beside a trailing duration, or past the window", async () => {
    const ended = (stoppedAt: string) => [finished({ id: "a", description: "Write report", startedAt: iso(6, 0, 13), stoppedAt })];
    const cases: Parameters<typeof runtimeFixture>[0][] = [
      { activeEntry: finished({ id: "run", startedAt: iso(10, 30), stoppedAt: null }), entries: ended(iso(10, 15)) },
      { description: "Plan 45m", entries: ended(iso(10, 15)) },
      { entries: ended(iso(6, 59)) },
      { entries: ended(iso(10, 59, 13)) },
      { entries: ended(iso(10, 59, 14)) }
    ];
    // The last case is a 1-minute gap at 11:00: offered; nudge the clock under it.
    for (const [index, fixture] of cases.entries()) {
      vi.setSystemTime(index === 4 ? local(10, 59) : local(11, 0));
      runtime = runtimeFixture(fixture);
      render(<PersistentTimerBar />);
      await act(async () => { vi.advanceTimersByTime(0); });
      expect(screen.queryByRole("button", { name: /^Start from/ })).toBeNull();
      cleanup();
    }
  });

  it("leaves when the window passes while idle", async () => {
    vi.setSystemTime(local(14, 14));
    runtime = runtimeFixture({ entries: [finished({ id: "a", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) })] });
    render(<PersistentTimerBar />);
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole("button", { name: "Start from 10:15, after Write report" })).not.toBeNull();
    // The minute clock: 14:15 is exactly 4 h (still offered); 14:16 is past it.
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("button", { name: "Start from 10:15, after Write report" })).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByRole("button", { name: /^Start from/ })).toBeNull();
  });
});

/** The Start resolves with a running block now in the bar's data (re-rendered, as React would). */
function startsBlock(view: ReturnType<typeof render>, entries: TimeEntryRow[]) {
  const running = finished({ id: "run", startedAt: local(11, 0).toISOString(), stoppedAt: null });
  (runtime.startTimer as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const next = { ...(runtime.shellData as BootstrapData), activeEntry: running, entries: [...entries, running] };
    // The runtime has the new blocks before React renders them (readShellData), as after a refresh.
    (runtime.readShellData as ReturnType<typeof vi.fn>).mockImplementation(() => next);
    return { ok: true, own: true, alreadyRunning: false, unchanged: null, replaced: null, startedEntryId: "optimistic-timer:1", startedServerId: "run", switchedAt: running.startedAt };
  });
}

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  description?: string;
  entries?: TimeEntryRow[];
} = {}) {
  const activeEntry = overrides.activeEntry ?? null;
  const data = {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-10-14" },
    entries: [...(overrides.entries ?? []), ...(activeEntry ? [activeEntry] : [])],
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
    readShellData: vi.fn(() => data),
    shellData: data,
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: { categoryId: activeEntry?.categoryId ?? "", description: overrides.description ?? "", tagNames: [] },
    timerError: null,
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
  };
}

function finished(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
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
    startedAt: iso(9, 0),
    stoppedAt: iso(10, 0),
    updatedAt: iso(10, 0),
    durationSeconds: 3_600,
    tagNames: [],
    tags: [],
    ...overrides
  };
}
