// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Guard for the web's `/api/timer-state` cadence (30 Oct 2026, `.codex/reference/performance.md`): 10 s
// while visible and focused, 60 s while visible but not focused, none while hidden; one immediate poll
// on focus, on a return to visibility and after the user's own timer actions; failures back off to
// 120 s; one chain only. The old 3 s poll made about 200 requests in a focused 10 minutes.

const server = vi.hoisted(() => ({
  /** Every request, in order, with the fake clock's time. */
  requests: [] as Array<{ at: number; request: string }>,
  timerStateStatus: 200,
  activeEntry: null as TimeEntryRow | null,
  /** The fingerprint the next timer-state answers carry, when it differs from the stored block. */
  fingerprintOverride: null as { activeEntryId: string | null; updatedAt: string | null } | null,
  holdTimerState: false,
  held: [] as Array<() => void>,
  inFlight: 0,
  maxInFlight: 0,
  /** Start POSTs wait to be released, one at a time. */
  holdPosts: false,
  heldPosts: [] as Array<() => void>,
  /** The next bootstrap waits to be released (it reads the server when released). */
  holdNextBootstrap: false,
  releaseBootstrap: null as (() => void) | null,
  /** Bootstraps that arrive while set answer 500. */
  failBootstraps: false,
  started: 0
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("date=2026-08-17") }));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.requests.push({ at: Date.now(), request: `${method} ${url}` });
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
    if (url === "/api/timer-state") {
      server.inFlight += 1;
      server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
      try {
        if (server.holdTimerState) await new Promise<void>((resolve) => server.held.push(resolve));
        const fingerprint = server.fingerprintOverride
          ?? { activeEntryId: server.activeEntry?.id ?? null, updatedAt: server.activeEntry?.updatedAt ?? null };
        return reply(server.timerStateStatus, { ...fingerprint, serverNow: new Date().toISOString() });
      } finally {
        server.inFlight -= 1;
      }
    }
    if (url.startsWith("/api/bootstrap")) {
      if (server.failBootstraps) return reply(500, {});
      if (server.holdNextBootstrap) {
        server.holdNextBootstrap = false;
        await new Promise<void>((resolve) => { server.releaseBootstrap = resolve; });
      }
      return reply(200, bootstrap(server.activeEntry));
    }
    if (method === "POST" && url === "/api/time-entries") {
      if (server.holdPosts) await new Promise<void>((resolve) => server.heldPosts.push(resolve));
      server.started += 1;
      const at = new Date().toISOString();
      server.activeEntry = entry({ id: `started-${server.started}`, startedAt: at, updatedAt: at });
      return reply(200, { timeEntryId: server.activeEntry.id });
    }
    if (method === "PATCH" && url.startsWith("/api/time-entries/")) {
      server.activeEntry = null;
      return reply(200, { ok: true });
    }
    if (method === "POST" && url === "/api/events") {
      server.activeEntry = null;
      return reply(200, { ok: true, results: [] });
    }
    return reply(404, {});
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { beforeSessionChange } = await import("@/lib/session-change");

let visibility: DocumentVisibilityState = "visible";
let focused = true;
const probe = { runtime: null as ReturnType<typeof useAppShellRuntime> | null };

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  focused = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  server.requests = [];
  server.timerStateStatus = 200;
  server.activeEntry = null;
  server.fingerprintOverride = null;
  server.holdTimerState = false;
  server.held = [];
  server.inFlight = 0;
  server.maxInFlight = 0;
  server.holdPosts = false;
  server.heldPosts = [];
  server.holdNextBootstrap = false;
  server.releaseBootstrap = null;
  server.failBootstraps = false;
  server.started = 0;
  probe.runtime = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(document.hasFocus).mockRestore();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

function Probe() {
  const runtime = useAppShellRuntime();
  useLayoutEffect(() => {
    probe.runtime = runtime;
  });
  return null;
}

const tree = () => <AppShellRuntimeProvider><Probe /></AppShellRuntimeProvider>;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const polls = () => server.requests.filter(({ request }) => request === "GET /api/timer-state");
const bootstraps = () => server.requests.filter(({ request }) => request.startsWith("GET /api/bootstrap"));
const TEN_MINUTES = 10 * 60_000;

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

function setFocus(next: boolean) {
  focused = next;
  act(() => { window.dispatchEvent(new Event(next ? "focus" : "blur")); });
}

async function mount(ui = tree()) {
  const view = render(ui);
  await advance(10);
  return view;
}

describe("web timer-state polling cadence", () => {
  it("polls every 10 s while visible and focused: about 60 in 10 minutes", async () => {
    await mount();
    expect(polls()).toHaveLength(1); // the first poll, at once
    const before = polls().length;
    await advance(TEN_MINUTES);
    const count = polls().length - before;
    expect(count).toBeGreaterThanOrEqual(59);
    expect(count).toBeLessThanOrEqual(61);
  });

  it("polls every 60 s while visible but not focused: about 10 in 10 minutes", async () => {
    focused = false;
    await mount();
    const before = polls().length;
    await advance(TEN_MINUTES);
    const count = polls().length - before;
    expect(count).toBeGreaterThanOrEqual(9);
    expect(count).toBeLessThanOrEqual(11);
  });

  it("never polls while hidden", async () => {
    visibility = "hidden";
    await mount();
    await advance(TEN_MINUTES);
    expect(polls()).toHaveLength(0);
  });

  it("stops on hide, polls at once on a return to visibility and on focus, and follows focus for its interval", async () => {
    await mount();
    await advance(25_000);
    expect(polls()).toHaveLength(3); // 0, 10, 20 s

    setVisibility("hidden");
    await advance(5 * 60_000);
    expect(polls()).toHaveLength(3);

    focused = false; // shown again, behind another window
    setVisibility("visible");
    await advance(10);
    expect(polls()).toHaveLength(4); // at once
    await advance(59_000);
    expect(polls()).toHaveLength(4); // unfocused: the next one is 60 s away
    await advance(1_000);
    expect(polls()).toHaveLength(5);

    await advance(30_000);
    setFocus(true);
    await advance(10);
    expect(polls()).toHaveLength(6); // at once on focus
    await advance(10_000);
    expect(polls()).toHaveLength(7); // focused again: 10 s
  });

  it("polls once after the user's own timer action settles, after its own reload", async () => {
    await mount();
    const pollsBefore = polls().length;
    await act(async () => {
      await probe.runtime!.startTimer({ description: "Writing" });
    });
    await advance(10);
    expect(polls().length - pollsBefore).toBe(1);
    // The confirming poll follows the action's own reload, so it finds nothing new to load.
    const start = server.requests.findIndex(({ request }) => request === "POST /api/time-entries");
    const reload = server.requests.findIndex(({ request }, index) => index > start && request.startsWith("GET /api/bootstrap"));
    const confirm = server.requests.findIndex(({ request }, index) => index > start && request === "GET /api/timer-state");
    expect(reload).toBeGreaterThan(start);
    expect(confirm).toBeGreaterThan(reload);
    const reloadsAfter = bootstraps().length;
    await advance(10);
    expect(bootstraps()).toHaveLength(reloadsAfter);

    // And Stop: one more.
    const beforeStop = polls().length;
    await act(async () => {
      await probe.runtime!.stopTimer();
    });
    await advance(10);
    expect(polls().length - beforeStop).toBe(1);
  });

  it("queued actions confirm once, after the last one's own reload, and no poll supersedes that reload (Codex r1 on #637)", async () => {
    await mount();
    await advance(5_000); // mid-way to the next scheduled poll
    server.holdPosts = true;
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    const actionsFrom = server.requests.length;
    await act(async () => {
      first = probe.runtime!.startTimer({ description: "A" });
      second = probe.runtime!.startTimer({ description: "B" }); // a switch queued behind A
      await vi.advanceTimersByTimeAsync(10);
    });
    // A's POST lands; B's follows; B's reload is held.
    await act(async () => { server.heldPosts.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    server.holdNextBootstrap = true;
    await act(async () => { server.heldPosts.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    server.holdPosts = false;
    await act(async () => { server.heldPosts.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    expect(server.releaseBootstrap).not.toBeNull();
    // Any other reload now fails: one started beside the action's would win and leave the block optimistic.
    server.failBootstraps = true;
    await advance(30_000); // scheduled polls fire meanwhile; their answers (a new block) are set aside
    const during = server.requests.slice(actionsFrom).map(({ request }) => request);
    expect(during.filter((request) => request.startsWith("GET /api/bootstrap"))).toHaveLength(1); // only the held reload
    expect(during.filter((request) => request === "POST /api/time-entries")).toHaveLength(2);

    const pollsBeforeRelease = polls().length;
    server.failBootstraps = false;
    await act(async () => { server.releaseBootstrap?.(); await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await Promise.all([first, second]); });
    await advance(10);
    // The reload committed: the real block B shows, not an optimistic one.
    expect(probe.runtime!.shellData?.activeEntry?.id).toBe("started-2");
    expect(probe.runtime!.shellData?.activeEntry?.description).toBe("Writing");
    // One confirming poll after it, which finds nothing new to load.
    expect(polls().length - pollsBeforeRelease).toBe(1);
    const reloads = bootstraps().length;
    server.failBootstraps = true;
    await advance(60_000);
    expect(bootstraps()).toHaveLength(reloads);
    expect(probe.runtime!.shellData?.activeEntry?.id).toBe("started-2");
  });

  it("an action's poll is deduped with one already in flight", async () => {
    await mount();
    server.holdTimerState = true;
    await advance(10_000); // the scheduled poll, now held
    expect(polls()).toHaveLength(2);
    await act(async () => {
      await probe.runtime!.startTimer({ description: "Writing" });
    });
    await advance(10);
    expect(polls()).toHaveLength(2); // no second request beside the held one
    server.holdTimerState = false;
    await act(async () => { server.held.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    expect(server.maxInFlight).toBe(1);
  });

  it("backs off 20, 40, 80, 120 s on errors and resets on success", async () => {
    server.timerStateStatus = 503;
    await mount();
    await advance(20_000 + 40_000 + 80_000 + 120_000 + 120_000);
    const times = polls().map(({ at }) => at);
    const gaps = times.slice(1).map((at, index) => at - times[index]);
    expect(gaps).toEqual([20_000, 40_000, 80_000, 120_000, 120_000]);

    server.timerStateStatus = 200;
    await advance(120_000); // this one succeeds
    const afterSuccess = polls().length;
    await advance(10_000);
    expect(polls().length).toBe(afterSuccess + 1); // back to 10 s
  });

  it("runs one chain across rerenders and StrictMode, and none after unmount", async () => {
    const strict = () => <StrictMode>{tree()}</StrictMode>;
    const view = await mount(strict());
    for (let index = 0; index < 5; index += 1) {
      view.rerender(strict());
      await advance(10);
    }
    expect(polls()).toHaveLength(1);
    await advance(60_000);
    expect(polls().length).toBeGreaterThanOrEqual(6);
    expect(polls().length).toBeLessThanOrEqual(8);
    expect(server.maxInFlight).toBe(1);

    view.unmount();
    const atUnmount = polls().length;
    await advance(TEN_MINUTES);
    expect(polls()).toHaveLength(atUnmount);
  });

  it("an account change drops the answer in flight", async () => {
    await mount();
    const reloads = bootstraps().length;
    server.holdTimerState = true;
    await advance(10_000);
    await act(async () => { await beforeSessionChange(); });
    // The held answer says another block runs: from the session left, it must not reload anything.
    server.fingerprintOverride = { activeEntryId: "other-account-block", updatedAt: "2026-10-30T09:00:00.000Z" };
    server.holdTimerState = false;
    await act(async () => { server.held.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    expect(bootstraps()).toHaveLength(reloads);
    // The chain carries on.
    const before = polls().length;
    await advance(10_000);
    expect(polls()).toHaveLength(before + 1);
  });
});

function bootstrap(activeEntry: TimeEntryRow | null): BootstrapData {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    viewerTimeZone: null,
    activeEntry,
    categories: [],
    categoryUsage: [],
    tags: [],
    taskSuggestions: [],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    dateRange: {
      selectedDate: "2026-08-17",
      dayStart: "2026-08-17T00:00:00.000Z",
      dayEnd: "2026-08-18T00:00:00.000Z",
      weekStart: "2026-08-17T00:00:00.000Z",
      weekEnd: "2026-08-24T00:00:00.000Z"
    },
    user: { id: "user-1", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400, goalsRevision: 1 },
    workspace: { id: "workspace" },
    workspaces: [{ id: "workspace", name: "Workspace" }]
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "block-1",
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
    description: "Writing",
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    updatedAt: new Date().toISOString(),
    durationSeconds: 0,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
