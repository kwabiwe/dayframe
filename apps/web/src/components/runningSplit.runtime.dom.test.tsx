// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Split for the running block (owner 28 Oct 2026) through the real runtime: synthetic ids and times only.
const mocks = vi.hoisted(() => ({ clientFetch: vi.fn() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("date=2026-08-17") }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.clientFetch }));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar } = await import("./PersistentTimerBar");

const FIRST = "80000000-0000-4000-8000-000000000001";
const SECOND = "80000000-0000-4000-8000-000000000002";
const SPLIT_AT = Date.parse("2026-08-17T04:30:00.000Z");

afterEach(() => cleanup());

describe("AppShellRuntime split of the running block", () => {
  beforeEach(() => vi.resetAllMocks());

  it("splits once, moves the running timer to the second part, and a Stop pressed meanwhile stops that part", async () => {
    const running = entry({ id: FIRST });
    let serverData = bootstrap(running);
    const requests: Array<{ url: string; body?: Record<string, unknown>; commandId?: string }> = [];
    let releaseSplit: (() => void) | undefined;
    const splitPending = new Promise<void>((resolve) => { releaseSplit = resolve; });
    mocks.clientFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const body = typeof options?.body === "string" ? JSON.parse(options.body) as Record<string, unknown> : undefined;
      const commandId = (options?.headers as Record<string, string> | undefined)?.["X-Dayframe-Client-Command-Id"];
      requests.push({ url, ...(body ? { body } : {}), ...(commandId ? { commandId } : {}) });
      if (url === "/api/time-entries" && body?.mode === "split") {
        await splitPending;
        const second = entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z" });
        serverData = bootstrap(second, [second, { ...running, stoppedAt: "2026-08-17T04:30:00.000Z" }]);
        return response({ ok: true, id: FIRST, newEntryId: SECOND, replayed: false, running: true, entries: [{ ...running, stoppedAt: "2026-08-17T04:30:00.000Z" }, entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z" })] }, 201);
      }
      if (url === "/api/time-entries" && body?.mode === "join") {
        serverData = bootstrap(running);
        return response({ ok: true, id: FIRST, replayed: false, running: true, entry: running });
      }
      if (url === "/api/events") {
        serverData = bootstrap(null, [{ ...running, stoppedAt: "2026-08-17T04:30:00.000Z" }, entry({ id: SECOND, stoppedAt: "2026-08-17T05:00:00.000Z" })]);
        return response({ eventId: "stop", stopOutcome: "stopped", timeEntryId: SECOND }, 201);
      }
      if (url.startsWith("/api/bootstrap")) return response(serverData);
      if (url === "/api/timer-state") {
        return response({ activeEntryId: serverData.activeEntry?.id ?? null, updatedAt: serverData.activeEntry?.updatedAt ?? null, serverNow: "2026-08-17T05:00:03.000Z" });
      }
      return response({}, 404);
    });

    render(
      <AppShellRuntimeProvider>
        <PersistentTimerBar />
        <Harness initial={bootstrap(running)} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${FIRST}@2026-08-17T04:00:00.000Z`));

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(requests.some((request) => request.body?.mode === "split")).toBe(true));
    // Stop pressed while the split is on its way waits for it.
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(requests.some((request) => request.url === "/api/events")).toBe(false);
    await act(async () => { releaseSplit?.(); await splitPending; });

    await waitFor(() => expect(requests.some((request) => request.url === "/api/events")).toBe(true));
    const split = requests.find((request) => request.body?.mode === "split")!;
    expect(split.body).toEqual({ mode: "split", entryId: FIRST, splitAt: "2026-08-17T04:30:00.000Z", expectedUpdatedAt: "2026-08-17T05:00:00.000Z" });
    expect(split.commandId).toMatch(/^web-split-/);
    expect(requests.find((request) => request.url === "/api/events")!.body).toEqual(expect.objectContaining({
      type: "timer_stop",
      rawPayload: { origin: "web_timer", stopScope: "entry", targetEntryId: SECOND }
    }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("idle"));
  });

  it("Undo puts it back as one running block", async () => {
    const running = entry({ id: FIRST });
    const second = entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z" });
    let serverData = bootstrap(second, [second, { ...running, stoppedAt: "2026-08-17T04:30:00.000Z" }]);
    const bodies: Array<Record<string, unknown>> = [];
    mocks.clientFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const body = typeof options?.body === "string" ? JSON.parse(options.body) as Record<string, unknown> : undefined;
      if (body) bodies.push(body);
      if (url === "/api/time-entries" && body?.mode === "join") {
        serverData = bootstrap(running);
        return response({ ok: true, id: FIRST, replayed: false, running: true, entry: running });
      }
      if (url.startsWith("/api/bootstrap")) return response(serverData);
      if (url === "/api/timer-state") return response({ activeEntryId: serverData.activeEntry?.id ?? null, updatedAt: null, serverNow: "2026-08-17T05:00:03.000Z" });
      return response({}, 404);
    });
    render(
      <AppShellRuntimeProvider>
        <Harness initial={serverData} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${SECOND}@2026-08-17T04:30:00.000Z`));
    fireEvent.click(screen.getByRole("button", { name: "Undo split" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${FIRST}@2026-08-17T04:00:00.000Z`));
    expect(bodies).toEqual([{ mode: "join", entryId: FIRST, splitEntryId: SECOND }]);
  });
});

describe("AppShellRuntime split of the running block: Codex r1 on #607", () => {
  beforeEach(() => vi.resetAllMocks());

  function server(handlers: { join?: () => Promise<Response> | Response; bootstrap?: () => Response; split?: () => Response }) {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mocks.clientFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const body = typeof options?.body === "string" ? JSON.parse(options.body) as Record<string, unknown> : undefined;
      requests.push({ url, ...(body ? { body } : {}) });
      if (url === "/api/time-entries" && body?.mode === "join" && handlers.join) return handlers.join();
      if (url === "/api/time-entries" && body?.mode === "split" && handlers.split) return handlers.split();
      if (url === "/api/events") return response({ eventId: "stop", stopOutcome: "stopped" }, 201);
      if (url.startsWith("/api/bootstrap") && handlers.bootstrap) return handlers.bootstrap();
      if (url === "/api/timer-state") return response({ activeEntryId: null, updatedAt: null, serverNow: "2026-08-17T05:00:03.000Z" });
      return response({}, 500);
    });
    return requests;
  }

  it("Undo shows the joined block even when the day can't load again, and a Stop pressed during it stops that block", async () => {
    const first = entry({ id: FIRST, stoppedAt: "2026-08-17T04:30:00.000Z" });
    const second = entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z" });
    let releaseJoin: (() => void) | undefined;
    const joinPending = new Promise<void>((resolve) => { releaseJoin = resolve; });
    const requests = server({
      join: async () => { await joinPending; return response({ ok: true, id: FIRST, replayed: false, running: true, entry: { ...first, stoppedAt: null } }); },
      bootstrap: () => response({ error: "down" }, 503)
    });
    render(
      <AppShellRuntimeProvider>
        <PersistentTimerBar />
        <Harness initial={bootstrap(second, [second, first])} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${SECOND}@2026-08-17T04:30:00.000Z`));
    fireEvent.click(screen.getByRole("button", { name: "Undo split" }));
    await waitFor(() => expect(requests.some((request) => request.body?.mode === "join")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await act(async () => { releaseJoin?.(); await joinPending; });
    await waitFor(() => expect(requests.some((request) => request.url === "/api/events")).toBe(true));
    expect(requests.find((request) => request.url === "/api/events")!.body).toEqual(expect.objectContaining({
      rawPayload: { origin: "web_timer", stopScope: "entry", targetEntryId: FIRST }
    }));
  });

  it("never lets Undo lose edits typed into the second part and not saved yet", async () => {
    const first = entry({ id: FIRST, stoppedAt: "2026-08-17T04:30:00.000Z" });
    const second = entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z" });
    const requests = server({ join: () => response({ ok: true, id: FIRST, replayed: false, running: true, entry: { ...first, stoppedAt: null } }) });
    render(
      <AppShellRuntimeProvider>
        <Harness initial={bootstrap(second, [second, first])} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${SECOND}@2026-08-17T04:30:00.000Z`));
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo split" }));
    await waitFor(() => expect(screen.getByTestId("undo").textContent).toContain("Save your edits"));
    expect(requests.some((request) => request.body?.mode === "join")).toBe(false);
  });

  it("shows nothing running when the block had stopped by the time the split arrived", async () => {
    const running = entry({ id: FIRST });
    server({
      split: () => response({ ok: true, id: FIRST, newEntryId: SECOND, replayed: false, running: false, entries: [
        { ...running, stoppedAt: "2026-08-17T04:30:00.000Z" },
        entry({ id: SECOND, startedAt: "2026-08-17T04:30:00.000Z", stoppedAt: "2026-08-17T04:50:00.000Z" })
      ] }, 201),
      bootstrap: () => response({ error: "down" }, 503)
    });
    render(
      <AppShellRuntimeProvider>
        <Harness initial={bootstrap(running)} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe(`${FIRST}@2026-08-17T04:00:00.000Z`));
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(mocks.clientFetch.mock.calls.some(([url]) => String(url).startsWith("/api/bootstrap"))).toBe(true));
    // Nothing runs: neither the second part nor the block it was split from (Codex r2 on #607).
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("idle"));
  });
});

function Harness({ initial }: { initial: BootstrapData }) {
  const { data, hydrate, joinSplitTimer, setTimerDraft, splitActiveTimer } = useAppShellRuntime();
  const [undo, setUndo] = useState("");
  return <>
    <button onClick={() => setTimerDraft((draft) => ({ ...draft, description: "Typed, not saved" }))}>Type</button>
    <output data-testid="undo">{undo}</output>
    <button onClick={() => hydrate(initial)}>Hydrate</button>
    <button onClick={() => void splitActiveTimer(SPLIT_AT)}>Split</button>
    <button onClick={() => void joinSplitTimer({ entryId: FIRST, newEntryId: SECOND }).then((outcome) => setUndo(outcome.ok ? "ok" : outcome.error))}>Undo split</button>
    <output data-testid="active">{data?.activeEntry ? `${data.activeEntry.id}@${data.activeEntry.startedAt}` : "idle"}</output>
  </>;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function bootstrap(activeEntry: TimeEntryRow | null, entries = activeEntry ? [activeEntry] : []): BootstrapData {
  return {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
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
    workspace: { id: "workspace", name: "Dayframe" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: FIRST, categoryId: null, categoryName: null, categoryColor: null, projectId: null, projectName: null, projectColor: null,
    clientName: null, placeId: null, placeName: null, source: "manual_app", confidence: "high", reviewStatus: "confirmed",
    description: "A", startedAt: "2026-08-17T04:00:00.000Z", stoppedAt: null, updatedAt: "2026-08-17T05:00:00.000Z",
    durationSeconds: 3600, tagNames: [], tags: [], ...overrides
  } as TimeEntryRow;
}
