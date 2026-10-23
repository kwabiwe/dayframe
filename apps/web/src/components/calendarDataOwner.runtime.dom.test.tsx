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
  held: [] as Array<() => void>,
  /** A bootstrap for this date is read on arrival and answered only when released. */
  holdBootstrapDate: null as string | null,
  releaseBootstrap: null as (() => void) | null,
  /** How the held bootstrap answers once released: normally, with a 500, or by rejecting. */
  heldBootstrapOutcome: "ok" as "ok" | "500" | "reject"
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
      if (server.holdBootstrapDate === date) {
        server.holdBootstrapDate = null;
        await new Promise<void>((resolve) => { server.releaseBootstrap = resolve; });
        if (server.heldBootstrapOutcome === "reject") throw new TypeError("Failed to fetch");
        if (server.heldBootstrapOutcome === "500") return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => body };
    }
    if (method === "DELETE") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime, useRuntimePageData } = await import("./AppShellRuntime");
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
  server.holdBootstrapDate = null;
  server.releaseBootstrap = null;
  server.heldBootstrapOutcome = "ok";
  page = "shell";
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

// The Calendar page as the app renders it: its server props (drawn at page load, for the first
// period) hydrate the runtime from a layout effect, and it shows what useRuntimePageData returns.
const PAGE_PROPS = bootstrap("2026-08-17", "workspace-A", 1);
function PageHarness() {
  const current = useAppShellRuntime();
  const data = useRuntimePageData(PAGE_PROPS);
  const shown = `${data.workspace.id}@${data.dateRange.selectedDate}#r${data.dateRange.weekStart.slice(-2, -1)}`;
  useLayoutEffect(() => {
    probe.runtime = current;
    if (probe.shown.at(-1) !== shown) probe.shown.push(shown);
  });
  return <output data-testid="shown">{shown}</output>;
}

let page: "shell" | "page" = "shell";
const tree = () => <AppShellRuntimeProvider>{page === "page" ? <PageHarness /> : <Harness />}</AppShellRuntimeProvider>;

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

  it("a cached return to the page's own first period is revalidated through its passive hydrate (Codex r1 on #544)", async () => {
    page = "page";
    const view = render(tree());
    await settle();
    expect(shown()).toBe("workspace-A@2026-08-17#r1");
    await navigate(view, "2026-08-10");
    expect(shown()).toBe("workspace-A@2026-08-10#r1");
    server.revision = 2;
    const before = bootstrapRequests().length;

    await navigate(view, "2026-08-17"); // the cache commit, then the page's hydrate of its old props
    await settle();
    expect(bootstrapRequests().slice(before)).toEqual(["GET /api/bootstrap?date=2026-08-17"]);
    expect(shown()).toBe("workspace-A@2026-08-17#r2");
  });

  it("a navigation polls the timer state at once, inside the running chain (Codex r1 on #544)", async () => {
    vi.useFakeTimers();
    const view = render(tree());
    await settle(10);
    const polls = () => server.requests.filter((request) => request.includes("/api/timer-state")).length;
    expect(polls()).toBe(1);
    await settle(1_000); // mid-way to the next scheduled poll (backing off after a failure)
    expect(polls()).toBe(1);
    await navigate(view, "2026-08-10");
    expect(polls()).toBe(2);
  });

  it("a period load still pending from the workspace left never undoes the switch (Codex r1 on #544)", async () => {
    const view = render(tree());
    await settle();
    expect(shown()).toBe("workspace-A@2026-08-17#r1");

    server.holdBootstrapDate = "2026-08-10";
    let outcome: Awaited<ReturnType<NonNullable<typeof probe.runtime>["loadDate"]>> | null = null;
    const pending = probe.runtime!.loadDate("2026-08-10").then((result) => { outcome = result; });
    await settle();
    expect(server.releaseBootstrap).not.toBeNull(); // A's answer for the 10th is held

    server.workspace = "workspace-B";
    await act(async () => { await probe.runtime!.refresh({ force: true }); });
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
    const switchedAt = probe.shown.length - 1;

    await act(async () => { server.releaseBootstrap?.(); await pending; });
    await settle();
    expect(outcome).toMatchObject({ ok: false });
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
    expect(probe.shown.slice(switchedAt).filter((value) => value.startsWith("workspace-A"))).toEqual([]);
    expect(probe.runtime!.dateLoadError).toBeNull(); // dropped quietly, no "Couldn’t load" error
    expect(probe.runtime!.isDateLoading).toBe(false);

    // Nothing is left loading: the next navigation loads B's period.
    await navigate(view, "2026-08-10");
    expect(shown()).toBe("workspace-B@2026-08-10#r1");
  });

  it("the page's old-workspace props never undo a switch on a return to their period (P → Q → switch → P)", async () => {
    page = "page";
    const view = render(tree());
    await settle();
    expect(shown()).toBe("workspace-A@2026-08-17#r1"); // P, from workspace A's page props
    await navigate(view, "2026-08-10"); // Q
    expect(shown()).toBe("workspace-A@2026-08-10#r1");

    // The switch is accepted; router.refresh has not delivered B's page props yet.
    server.workspace = "workspace-B";
    await act(async () => { await probe.runtime!.refresh({ force: true }); });
    expect(shown()).toBe("workspace-B@2026-08-10#r1");
    const switchedAt = probe.shown.length - 1;
    const before = bootstrapRequests().length;

    await navigate(view, "2026-08-17"); // back to P: the page hydrates its old props (workspace A)
    await settle();
    expect(bootstrapRequests().slice(before)).toContain("GET /api/bootstrap?date=2026-08-17");
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
    expect(probe.runtime!.data?.workspace.id).toBe("workspace-B");
    expect(probe.shown.slice(switchedAt).filter((value) => value.startsWith("workspace-A"))).toEqual([]);

    // The cache still serves B: another period and back stays in B.
    await navigate(view, "2026-08-10");
    await navigate(view, "2026-08-17");
    await settle();
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
    expect(probe.shown.slice(switchedAt).filter((value) => value.startsWith("workspace-A"))).toEqual([]);
  });

  it.each(["500", "reject"] as const)("a period load from the workspace left that fails (%s) after the switch shows no error", async (outcome) => {
    render(tree());
    await settle();
    server.holdBootstrapDate = "2026-08-10";
    server.heldBootstrapOutcome = outcome;
    let result: Awaited<ReturnType<NonNullable<typeof probe.runtime>["loadDate"]>> | null = null;
    const pending = probe.runtime!.loadDate("2026-08-10").then((value) => { result = value; });
    await settle();
    expect(server.releaseBootstrap).not.toBeNull();

    server.workspace = "workspace-B";
    await act(async () => { await probe.runtime!.refresh({ force: true }); });
    expect(shown()).toBe("workspace-B@2026-08-17#r1");

    await act(async () => { server.releaseBootstrap?.(); await pending; });
    await settle();
    expect(result).toMatchObject({ ok: false });
    expect(probe.runtime!.dateLoadError).toBeNull();
    expect(probe.runtime!.isDateLoading).toBe(false);
    expect(shown()).toBe("workspace-B@2026-08-17#r1");
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
