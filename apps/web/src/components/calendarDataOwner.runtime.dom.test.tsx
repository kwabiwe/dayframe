// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useCallback, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";

// Stability audit 22 Oct 2026 (WEB-UI-3/4/5/6): the web Calendar's data owner across period
// changes and workspace switches. These drive the real AppShellRuntimeProvider. A period change is
// what Calendar navigation does: `loadDate`, then `history.pushState`, which changes the search
// params the provider reads (here: `nav.params` plus a rerender).

const nav = vi.hoisted(() => ({ params: new URLSearchParams("date=2026-08-17") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

const server = vi.hoisted(() => ({
  workspace: "workspace-A",
  /** Bumped to stand for another device's change to the stored blocks. */
  revision: 1,
  /** Every request, in order (`GET /api/bootstrap?date=…`, `DELETE /api/time-entries/…`). */
  requests: [] as string[],
  /** When set, timer-state requests wait to be released (one at a time). */
  holdTimerState: false,
  held: [] as Array<() => void>
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.requests.push(`${method} ${url}`);
    if (url.startsWith("/api/timer-state")) {
      if (!server.holdTimerState) return { ok: false, status: 503, json: async () => ({}) };
      await new Promise<void>((resolve) => server.held.push(resolve));
      return { ok: true, status: 200, json: async () => ({ activeEntryId: null, updatedAt: null, serverNow: new Date().toISOString() }) };
    }
    if (url.startsWith("/api/bootstrap")) {
      const date = new URL(url, "http://dayframe.test").searchParams.get("date") ?? "2026-08-17";
      const body = bootstrap(date, server.workspace, server.revision);
      return { ok: true, status: 200, json: async () => body };
    }
    if (method === "DELETE") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { useTimelineDeleteUndo } = await import("./useTimelineDeleteUndo");

const ENTRY_IDS: ReadonlySet<string> = new Set(["block-1"]);
// What the harness rendered: the runtime it saw, and every distinct value it showed.
const probe = { runtime: null as ReturnType<typeof useAppShellRuntime> | null, shown: [] as string[] };

beforeEach(() => {
  nav.params = new URLSearchParams("date=2026-08-17");
  server.workspace = "workspace-A";
  server.revision = 1;
  server.requests = [];
  server.holdTimerState = false;
  server.held = [];
  probe.runtime = null;
  probe.shown = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness() {
  const current = useAppShellRuntime();
  const { refresh, shellData } = current;
  // As TimeReviewViews passes it: rebuilt whenever `refresh` is.
  const refreshData = useCallback(async () => {
    await refresh();
  }, [refresh]);
  const { requestDelete } = useTimelineDeleteUndo({ entryIds: ENTRY_IDS, onSynced: refreshData });
  const shown = shellData ? `${shellData.workspace.id}@${shellData.dateRange.selectedDate}#r${shellData.dateRange.weekStart.slice(-2, -1)}` : "";
  useLayoutEffect(() => {
    probe.runtime = current;
    if (probe.shown.at(-1) !== shown) probe.shown.push(shown);
  });
  return <>
    <button onClick={() => requestDelete({ entries: [{ id: "block-1" } as never], label: "Block" })}>Delete</button>
    <output data-testid="shown">{shown}</output>
  </>;
}

const tree = () => <AppShellRuntimeProvider><Harness /></AppShellRuntimeProvider>;

/** Calendar navigation: load the period, then push its URL. */
async function navigate(view: ReturnType<typeof render>, date: string) {
  await act(async () => { await probe.runtime!.loadDate(date); });
  nav.params = new URLSearchParams(`date=${date}`);
  view.rerender(tree());
  await settle();
}

async function settle(ms = 20) {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const shown = () => screen.getByTestId("shown").textContent;
const bootstrapRequests = () => server.requests.filter((request) => request.startsWith("GET /api/bootstrap"));

describe("web Calendar data owner (stability audit WEB-UI-3/4/5/6)", () => {
  it("a Delete committed after a period change reloads the period shown, not the first one (WEB-UI-3)", async () => {
    vi.useFakeTimers();
    const view = render(tree());
    await settle();
    expect(shown()).toBe("workspace-A@2026-08-17#r1");
    await navigate(view, "2026-08-10");
    expect(shown()).toBe("workspace-A@2026-08-10#r1");

    await act(async () => { screen.getByRole("button", { name: "Delete" }).click(); });
    server.revision = 2;
    const before = server.requests.length;
    await settle(5_500);

    const after = server.requests.slice(before);
    expect(after).toContain("DELETE /api/time-entries/block-1");
    const reloads = after.filter((request) => request.startsWith("GET /api/bootstrap"));
    expect(reloads).toEqual(["GET /api/bootstrap?date=2026-08-10"]);
    expect(shown()).toBe("workspace-A@2026-08-10#r2");
  });

  it("the Delete Undo controller calls the newest onSynced, not the first render's (WEB-UI-3)", async () => {
    vi.useFakeTimers();
    const first = vi.fn(async () => undefined);
    const latest = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(({ onSynced }) => useTimelineDeleteUndo({ entryIds: ENTRY_IDS, onSynced }), {
      initialProps: { onSynced: first }
    });
    rerender({ onSynced: latest });
    act(() => result.current.requestDelete({ entries: [{ id: "block-1" } as never], label: "Block" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("a period change while a timer-state poll is in flight keeps the 3 s poll going (WEB-UI-4)", async () => {
    vi.useFakeTimers();
    server.holdTimerState = true;
    const view = render(tree());
    await settle(10);
    const polls = () => server.requests.filter((request) => request.includes("/api/timer-state")).length;
    expect(polls()).toBe(1); // held in flight

    await navigate(view, "2026-08-10");
    await act(async () => { server.held.shift()?.(); await vi.advanceTimersByTimeAsync(10); });
    const before = polls();
    for (let second = 0; second < 30; second += 1) {
      await act(async () => { server.held.shift()?.(); await vi.advanceTimersByTimeAsync(1_000); });
    }
    // About one poll every 3 s: never a dead chain.
    expect(polls() - before).toBeGreaterThanOrEqual(8);
  });

  it("a cached day is shown at once and then fetched again, so another device's change appears (WEB-UI-5)", async () => {
    const view = render(tree());
    await settle();
    await navigate(view, "2026-08-10");
    expect(shown()).toBe("workspace-A@2026-08-10#r1");
    server.revision = 2; // e.g. a Review accepted on the iPhone for the week of the 17th
    const before = bootstrapRequests().length;

    await navigate(view, "2026-08-17");
    await settle();
    expect(bootstrapRequests().slice(before)).toEqual(["GET /api/bootstrap?date=2026-08-17"]);
    expect(shown()).toBe("workspace-A@2026-08-17#r2");
  });

  it("after a workspace switch, the old workspace's cached days are never shown (WEB-UI-6)", async () => {
    const view = render(tree());
    await settle();
    await navigate(view, "2026-08-10");
    await navigate(view, "2026-08-17");
    expect(shown()).toBe("workspace-A@2026-08-17#r1");

    // The profile popover / Settings switch: POST /api/workspace/switch, then a forced refresh.
    server.workspace = "workspace-B";
    await act(async () => { await probe.runtime!.refresh({ force: true }); });
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
    const switchedAt = probe.shown.length - 1;

    await navigate(view, "2026-08-10");
    await settle();
    expect(shown()).toBe("workspace-B@2026-08-10#r1");
    expect(probe.shown.slice(switchedAt).filter((value) => value.startsWith("workspace-A"))).toEqual([]);
  });
});

function bootstrap(date: string, workspace: string, revision: number): BootstrapData {
  return {
    viewerTimeZone: null,
    activeEntry: null,
    categories: [],
    tags: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    // The revision rides in a range field the cache keeps per day (shared fields come from the
    // current snapshot on a cache hit).
    dateRange: { selectedDate: date, dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.000Z`, weekStart: `${date}T00:00:00.00${revision}Z`, weekEnd: `${date}T23:59:59.000Z` },
    user: { id: "user-1", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400, goalsRevision: 1 },
    workspace: { id: workspace, name: workspace },
    workspaces: [{ id: workspace, name: workspace }]
  } as unknown as BootstrapData;
}
