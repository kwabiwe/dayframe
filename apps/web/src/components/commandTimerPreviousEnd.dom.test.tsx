// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

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
  it("offers today's last end once hydrated, and starts the draft from it", async () => {
    runtime = runtimeFixture({
      description: "Review notes",
      entries: [
        finished({ id: "a", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) }),
        finished({ id: "b", categoryName: "Reading", startedAt: iso(8, 0), stoppedAt: iso(9, 0) })
      ]
    });
    render(<PersistentTimerBar />);
    // The server render (and the first client render) has no offer.
    expect(screen.queryByRole("button", { name: /^Start from/ })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(0); });

    const chip = screen.getByRole("button", { name: "Start from 10:15, after Write report" });
    expect(chip.textContent).toBe("From 10:15 · afterWrite report");
    await act(async () => { fireEvent.click(chip); });

    const startTimer = runtime.startTimer as ReturnType<typeof vi.fn>;
    expect(startTimer).toHaveBeenCalledTimes(1);
    const [draft, options] = startTimer.mock.calls[0];
    expect(draft).toEqual({ categoryId: "", description: "Review notes", tagNames: [] });
    // Checked again when the Start runs: the same gap starts at its end…
    const snapshot = runtime.shellData as BootstrapData;
    expect(options.startAt(snapshot)).toBe(iso(10, 15));
    // …a block running by then, or a newer block ended since, starts nothing.
    expect(options.startAt({ ...snapshot, activeEntry: finished({ id: "run", stoppedAt: null }) })).toBeNull();
    expect(options.startAt({
      ...snapshot,
      entries: [...snapshot.entries, finished({ id: "c", startedAt: iso(10, 20), stoppedAt: iso(10, 40) })]
    })).toBeNull();
  });

  it("uses the bootstrap's latest-ending block when the bar's entries miss it (Codex r1 on #418)", async () => {
    // `entries` is the latest-started 100: a long block that started earlier and ends later can be
    // missing from it. The chip must offer that block's end, never the earlier one.
    runtime = runtimeFixture({
      entries: [finished({ id: "short", description: "Write report", startedAt: iso(9, 30), stoppedAt: iso(10, 15) })],
      latestFinishedEntry: finished({ id: "long", description: "Workshop", startedAt: iso(6, 0), stoppedAt: iso(10, 45) })
    });
    render(<PersistentTimerBar />);
    await act(async () => { vi.advanceTimersByTime(0); });
    const chip = screen.getByRole("button", { name: "Start from 10:45, after Workshop" });
    await act(async () => { fireEvent.click(chip); });
    const [, options] = (runtime.startTimer as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.startAt(runtime.shellData as BootstrapData)).toBe(iso(10, 45));
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
    // 14:15 is exactly 4 h (still offered); the next 30 s tick is past it.
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(screen.queryByRole("button", { name: /^Start from/ })).toBeNull();
  });
});

function runtimeFixture(overrides: {
  activeEntry?: TimeEntryRow | null;
  description?: string;
  entries?: TimeEntryRow[];
  latestFinishedEntry?: TimeEntryRow | null;
} = {}) {
  const activeEntry = overrides.activeEntry ?? null;
  const data = {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-10-14" },
    entries: [...(overrides.entries ?? []), ...(activeEntry ? [activeEntry] : [])],
    latestFinishedEntry: overrides.latestFinishedEntry ?? null,
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

describe("cached-period merge keeps the latest end current (Codex r3 on #418)", () => {
  it("copies latestFinishedEntry from the current bootstrap with entries", async () => {
    const { readFileSync } = await import("node:fs");
    const runtimeSource = readFileSync(`${process.cwd()}/src/components/AppShellRuntime.tsx`, "utf8");
    const merge = runtimeSource.slice(runtimeSource.indexOf("function withCurrentSharedBootstrap("), runtimeSource.indexOf("async function responseError("));
    expect(merge).toMatch(/entries: current\.entries,[\s\S]*?latestFinishedEntry: current\.latestFinishedEntry,/);
  });
});
