// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// "← From 10:15" (PRD D16) against a real AppShellRuntimeProvider and a fake server: the
// chip's Start, then the start editor's start-time edit, with the timings Codex r5 on #418 found
// (a Start's refresh landing before React renders, and a block that replaces this Start's own).

const server = {
  finished: [] as TimeEntryRow[],
  active: null as TimeEntryRow | null,
  posts: 0,
  patches: [] as Array<{ url: string; body: Record<string, unknown> }>,
  /** Runs when a Start arrives (before it is answered). */
  onStart: null as (() => void) | null,
  holdBootstrap: false,
  release: null as (() => void) | null
};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
    if (url === "/api/timer-state") return reply(200, { activeEntryId: server.active?.id ?? null, updatedAt: server.active?.updatedAt ?? null });
    if (url.startsWith("/api/bootstrap")) {
      const read = bootstrap();
      if (server.holdBootstrap) {
        server.holdBootstrap = false;
        await new Promise<void>((resolve) => { server.release = resolve; });
      }
      return reply(200, read);
    }
    if (method === "POST" && url === "/api/time-entries") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.mode === "stop") return reply(201, {});
      server.posts += 1;
      server.onStart?.();
      server.active = entry({ id: `started-${server.posts}`, startedAt: new Date().toISOString(), stoppedAt: null, description: (body.description as string) ?? null });
      return reply(200, { timeEntryId: server.active.id });
    }
    if (method === "DELETE" && url.startsWith("/api/time-entries/")) {
      if (server.active && url.endsWith(server.active.id)) server.active = null;
      return reply(200, { ok: true });
    }
    if (method === "PATCH" && url.startsWith("/api/time-entries/")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      server.patches.push({ url, body });
      if (!server.active || !url.endsWith(server.active.id)) return reply(404, { error: "Block not found." });
      server.active = { ...server.active, startedAt: String(body.startedAt), updatedAt: new Date().toISOString() };
      return reply(200, { ok: true, updatedAt: server.active.updatedAt });
    }
    return reply(500, {});
  })
}));

vi.setConfig({ testTimeout: 20_000 });

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar, PREVIOUS_END_CHANGED_NOTICE } = await import("./PersistentTimerBar");

// These tests reason about "today": the clock is pinned to midday local time, so they pass at any hour
// (they failed between midnight and 01:30, when "90 minutes ago" was yesterday). Only Date is faked,
// and it keeps moving, so real timers and waits behave as before.
function pinClockToMidday() {
  const midday = new Date();
  midday.setHours(12, 0, 0, 0);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(midday);
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeEach(() => {
  pinClockToMidday();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  server.finished = [entry({ id: "prev", description: "Write report", startedAt: minutesAgo(90), stoppedAt: minutesAgo(30) })];
  server.active = null;
  server.posts = 0;
  server.patches = [];
  server.onStart = null;
  server.holdBootstrap = false;
  server.release = null;
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
  cleanup();
  document.body.innerHTML = "";
});

type Runtime = ReturnType<typeof useAppShellRuntime>;

async function openBar() {
  const handle = { runtime: null as Runtime | null };
  function Shell() {
    const runtime = useAppShellRuntime();
    handle.runtime = runtime;
    const { hydrate } = runtime;
    useEffect(() => hydrate(bootstrap()), [hydrate]);
    return runtime.shellData ? <PersistentTimerBar /> : null;
  }
  const view = render(<AppShellRuntimeProvider><Shell /></AppShellRuntimeProvider>);
  const chip = await waitFor(() => {
    const button = view.container.querySelector<HTMLButtonElement>(".df-cmd-from-text");
    expect(button).not.toBeNull();
    return button!;
  });
  return { view, chip, runtime: () => handle.runtime! };
}

describe("Start at the previous end through the real runtime", () => {
  it("starts, then moves this block's start to the previous end", async () => {
    const { chip } = await openBar();
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0].url).toBe("/api/time-entries/started-1");
    expect(server.patches[0].body.startedAt).toBe(server.finished[0].stoppedAt);
    // Only the start: echoing this tab's `stoppedAt: null` would reopen a block stopped on another
    // device meanwhile (stability audit 22 Oct 2026).
    expect(server.patches[0].body).not.toHaveProperty("stoppedAt");
    expect(server.active?.startedAt).toBe(server.finished[0].stoppedAt);
  });

  it("leaves the block at now when the Start's own refresh loads a newer end", async () => {
    const { view, chip } = await openBar();
    // Another device finished a block ending 10 minutes ago; this tab learns it from the Start's refresh.
    server.onStart = () => {
      server.finished = [...server.finished, entry({ id: "newer", startedAt: minutesAgo(25), stoppedAt: minutesAgo(10) })];
    };
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(view.container.textContent).toContain(PREVIOUS_END_CHANGED_NOTICE));
    expect(server.patches).toHaveLength(0);
  });

  it("still edits its own block after another refresh has rendered it at its server id (Codex r6)", async () => {
    const { chip, runtime } = await openBar();
    // Hold the chip Start's refresh; a second refresh renders started-1 (the hand-off map is then
    // cleared); releasing the first must still move started-1's start.
    server.holdBootstrap = true;
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(server.release).not.toBeNull());
    await act(async () => { await runtime().refresh({ force: true }); });
    await act(async () => { server.release!(); });
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0].url).toBe("/api/time-entries/started-1");
    expect(server.active?.startedAt).toBe(server.finished[0].stoppedAt);
  });

  it("never backdates a block that replaced this Start's own", async () => {
    const { chip, runtime } = await openBar();
    // The chip Start's refresh is held; meanwhile its block is discarded and another started.
    server.holdBootstrap = true;
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(server.release).not.toBeNull());
    await act(async () => { await runtime().deleteActiveTimer(); });
    await act(async () => { await runtime().startTimer({ categoryId: "", description: "Something else", tagNames: [] }); });
    await act(async () => { server.release!(); });
    await waitFor(() => expect(server.posts).toBe(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(server.patches.filter((patch) => patch.url.endsWith("started-2"))).toHaveLength(0);
  });
});

function bootstrap(): BootstrapData {
  const entries = [...server.finished, ...(server.active ? [server.active] : [])];
  return {
    activeEntry: server.active,
    categories: [{ id: "work", name: "Work", color: "blue", isPinned: true }],
    categoryUsage: [],
    tags: [],
    taskSuggestions: [],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    dateRange: {
      selectedDate: "2026-10-14",
      dayStart: "2026-10-14T00:00:00.000Z",
      dayEnd: "2026-10-15T00:00:00.000Z",
      weekStart: "2026-10-12T00:00:00.000Z",
      weekEnd: "2026-10-19T00:00:00.000Z"
    },
    workspace: { id: "workspace" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "entry",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: null,
    startedAt: minutesAgo(60),
    stoppedAt: null,
    updatedAt: minutesAgo(1),
    durationSeconds: 0,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
