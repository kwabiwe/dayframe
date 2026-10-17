// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Production report, 13 Oct 2026 (web timer bar): a running "BAU" / Work / #Cubic block was edited
// to "app testing" / Coding / no tags in one window; within a second or two the description went
// back to "BAU". The other window (also polling) refreshed, kept its own copy of the description
// as a pending edit and autosaved it back. These tests drive real AppShellRuntimeProvider
// instances (two of them stand for two tabs) against one fake server that, like the real one,
// changes only the fields a PATCH sends and refuses (409) a save whose `expectedDetails` no longer
// match.

type Details = { categoryId: string | null; description: string | null; tagNames: string[] };
type Hold = "patch" | "start" | "bootstrap";

const server = {
  entry: null as TimeEntryRow | null,
  /** Every PATCH body exactly as sent. */
  patches: [] as Array<{ url: string; body: Record<string, unknown> }>,
  deletes: [] as string[],
  posts: [] as Record<string, unknown>[],
  conflicts: 0,
  holdNext: null as Hold | null,
  release: null as (() => void) | null,
  /** A bootstrap held mid-flight answers with the server copy it read when it arrived. */
  heldBootstrapSnapshot: null as TimeEntryRow | null
};

async function maybeHold(kind: Hold) {
  if (server.holdNext !== kind) return;
  server.holdNext = null;
  await new Promise<void>((resolve) => { server.release = resolve; });
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-17")
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
    if (url === "/api/timer-state") {
      return reply(200, { activeEntryId: server.entry?.id ?? null, updatedAt: server.entry?.updatedAt ?? null });
    }
    if (url.startsWith("/api/bootstrap")) {
      // Read now (as the server would), answered later if held: a stale answer.
      const read = server.entry ? { ...server.entry } : null;
      await maybeHold("bootstrap");
      const date = new URL(url, "http://dayframe.test").searchParams.get("date") ?? "2026-08-17";
      return reply(200, bootstrap(read, date));
    }
    if (method === "PATCH" && url.startsWith("/api/time-entries/")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      server.patches.push({ url, body });
      if (url !== `/api/time-entries/${server.entry?.id}`) return reply(404, { error: "Block not found." });
      await maybeHold("patch");
      const { expectedDetails, ...sent } = body as Partial<Details> & { expectedDetails?: Partial<Details> };
      if (expectedDetails && detailsChanged(server.entry!, expectedDetails)) {
        server.conflicts += 1;
        return reply(409, { error: "Changed elsewhere", code: "time_entry_details_conflict", entry: server.entry });
      }
      const updatedAt = new Date(Date.parse(server.entry!.updatedAt) + 60_000).toISOString();
      server.entry = { ...server.entry!, ...sent, ...("categoryId" in sent ? categoryFields(sent.categoryId ?? null) : {}), updatedAt } as TimeEntryRow;
      if ("tagNames" in sent) server.entry = { ...server.entry, tags: tagsFor(sent.tagNames ?? []) };
      return reply(200, { ok: true, id: server.entry.id, updatedAt });
    }
    if (method === "DELETE" && url.startsWith("/api/time-entries/")) {
      server.deletes.push(url);
      if (url !== `/api/time-entries/${server.entry?.id}`) return reply(404, { error: "Block not found." });
      server.entry = null;
      return reply(200, { ok: true });
    }
    if (method === "POST" && url === "/api/time-entries") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      server.posts.push(body);
      await maybeHold("start");
      server.entry = entry({
        id: `started-${server.posts.length}`,
        ...categoryFields((body.categoryId as string | undefined) ?? null),
        description: (body.description as string | undefined) ?? null,
        tagNames: (body.tagNames as string[] | undefined) ?? [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return reply(200, { timeEntryId: server.entry.id });
    }
    return reply(500, {});
  })
}));

vi.setConfig({ testTimeout: 20_000 });

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar } = await import("./PersistentTimerBar");

// Polls and periodic refreshes run only while the page is visible: the tests keep both tabs
// "hidden" so every refresh happens exactly where a test asks for it (as a poll would).
beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  server.entry = null;
  server.patches = [];
  server.deletes = [];
  server.posts = [];
  server.conflicts = 0;
  server.holdNext = null;
  server.release = null;
});

afterEach(() => {
  delete (document as { visibilityState?: unknown }).visibilityState;
  cleanup();
  document.body.innerHTML = "";
});

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

type Runtime = ReturnType<typeof useAppShellRuntime>;

/** One tab: its own provider and timer bar, loaded with the server's copy. */
async function openTab() {
  const handle = { runtime: null as Runtime | null };
  function Tab() {
    const runtime = useAppShellRuntime();
    handle.runtime = runtime;
    const { hydrate } = runtime;
    useEffect(() => hydrate(bootstrap(server.entry)), [hydrate]);
    return runtime.shellData ? <PersistentTimerBar /> : null;
  }
  const { container, unmount } = render(<AppShellRuntimeProvider><Tab /></AppShellRuntimeProvider>);
  await waitFor(() => expect(container.querySelector('input[name="timer-description"]')).not.toBeNull());
  const input = container.querySelector('input[name="timer-description"]') as HTMLInputElement;
  const runtime = () => handle.runtime!;
  return {
    container,
    input,
    runtime,
    unmount,
    refresh: () => act(async () => { await runtime().refresh({ force: true }); }),
    activity: () => container.querySelector('button[aria-label^="Activity:"]')?.getAttribute("aria-label") ?? null,
    async type(keys: string) {
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard(keys);
    },
    async clearAndType(text: string) {
      const user = userEvent.setup();
      await user.click(input);
      await user.clear(input);
      await user.keyboard(text);
    }
  };
}

const bodies = () => server.patches.map((patch) => patch.body);

describe("a second tab never writes a stale timer description back", () => {
  it("the owner's report: tab Y refreshes onto tab X's edit, adopts it and never PATCHes", async () => {
    server.entry = entry({ description: "BAU", ...categoryFields("work"), tagNames: ["Cubic"], tags: tagsFor(["Cubic"]) });
    const x = await openTab();
    const y = await openTab();
    // Y once had a trailing space typed after "BAU" (saved as "BAU", so never autosaved): before the
    // fix this left Y's description "dirty" for the rest of the block.
    await y.type("{End} ");
    await wait(900);
    expect(server.patches).toEqual([]);

    // X: clear "BAU", type "app testing", choose Coding, remove #Cubic.
    await x.clearAndType("app testing @cod");
    await userEvent.setup().keyboard("{Enter}");
    expect(x.activity()).toBe("Activity: Coding");
    const removeCubic = x.container.querySelector('button[aria-label="#Cubic, remove tag"]') as HTMLButtonElement | null;
    expect(removeCubic).not.toBeNull();
    await userEvent.setup().click(removeCubic!);
    await waitFor(() => expect(server.entry).toMatchObject({ description: "app testing", categoryId: "coding", tagNames: [] }), { timeout: 3_000 });
    await wait(900);
    // Everything X sent was its own edit, each based on what it had loaded.
    for (const body of bodies()) expect(body).toHaveProperty("expectedDetails");
    expect(bodies().some((body) => body.description === "BAU")).toBe(false);
    const xPatches = server.patches.length;

    // Y's poll notices and refreshes: Y shows X's edit and sends nothing.
    await y.refresh();
    await waitFor(() => expect(y.input.value).toBe("app testing"));
    expect(y.activity()).toBe("Activity: Coding");
    expect(y.container.querySelector('button[aria-label="#Cubic, remove tag"]')).toBeNull();
    await wait(1_500);
    expect(server.patches).toHaveLength(xPatches);

    // X's next refresh keeps the owner's edit.
    await x.refresh();
    await wait(900);
    expect(x.input.value).toBe("app testing");
    expect(server.entry).toMatchObject({ description: "app testing", categoryId: "coding", tagNames: [] });
  });

  it("an untouched tab adopts every newer field and never autosaves them back", async () => {
    server.entry = entry({ description: "BAU", ...categoryFields("work"), tagNames: ["Cubic"], tags: tagsFor(["Cubic"]) });
    const x = await openTab();
    const y = await openTab();
    await x.clearAndType("app testing");
    await waitFor(() => expect(server.entry?.description).toBe("app testing"), { timeout: 3_000 });
    await wait(900);
    expect(bodies()).toEqual([
      { description: "app testing", expectedDetails: { description: "BAU" } }
    ]);
    await y.refresh();
    expect(y.input.value).toBe("app testing");
    expect(y.activity()).toBe("Activity: Work");
    await wait(1_200);
    expect(server.patches).toHaveLength(1);
  });

  it("an edit based on a description changed elsewhere is refused (409); the tab adopts the server copy", async () => {
    server.entry = entry({ description: "BAU", ...categoryFields("work") });
    const x = await openTab();
    const y = await openTab();
    await x.clearAndType("app testing");
    await waitFor(() => expect(server.entry?.description).toBe("app testing"), { timeout: 3_000 });
    await wait(900);
    expect(server.patches).toHaveLength(1);
    // Y has not refreshed yet and edits its stale copy.
    await y.type("{End} more");
    await waitFor(() => expect(server.conflicts).toBe(1), { timeout: 3_000 });
    expect(bodies()[1]).toEqual({ description: "BAU more", expectedDetails: { description: "BAU" } });
    await waitFor(() => expect(y.input.value).toBe("app testing"));
    await wait(1_200);
    expect(server.patches).toHaveLength(2);
    expect(server.entry?.description).toBe("app testing");
  });

  it("edits to different fields in two tabs both survive (only edited fields are sent)", async () => {
    server.entry = entry({ description: "BAU", ...categoryFields("work") });
    const x = await openTab();
    const y = await openTab();
    await x.type("{End} @cod{Enter}");
    await waitFor(() => expect(server.entry?.categoryId).toBe("coding"), { timeout: 3_000 });
    await wait(900);
    expect(bodies()).toEqual([
      { categoryId: "coding", expectedDetails: { categoryId: "work" } }
    ]);
    // Y, still showing Work, edits only the description.
    expect(y.activity()).toBe("Activity: Work");
    await y.type("{End} notes");
    await waitFor(() => expect(server.entry?.description).toBe("BAU notes"), { timeout: 3_000 });
    expect(bodies()[1]).toEqual({ description: "BAU notes", expectedDetails: { description: "BAU" } });
    expect(server.entry).toMatchObject({ categoryId: "coding", description: "BAU notes" });
    await y.refresh();
    expect(y.activity()).toBe("Activity: Coding");
    expect(y.input.value).toBe("BAU notes");
  });
});

describe("one tab: a stale copy answered after its own save never writes back", () => {
  it("a period load requested before the PATCH and answered while it is pending", async () => {
    server.entry = entry({ description: "BAU" });
    const tab = await openTab();
    server.holdNext = "patch";
    await tab.clearAndType("app testing");
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 2_000 });
    const releasePatch = server.release!;
    server.release = null;
    // The previous day loads while the save is pending: its copy of the block still says "BAU".
    await act(async () => { await tab.runtime().loadDate("2026-08-16"); });
    expect(tab.input.value).toBe("app testing");
    // The acknowledgement lands; its follow-up refresh is slow.
    server.holdNext = "bootstrap";
    await act(async () => { releasePatch(); });
    await waitFor(() => expect(server.release).not.toBeNull());
    await wait(50);
    expect(tab.input.value).toBe("app testing");
    await act(async () => { server.release?.(); });
    await wait(1_500);
    expect(tab.input.value).toBe("app testing");
    expect(server.patches.map((patch) => patch.body.description)).toEqual(["app testing"]);
    expect(server.entry?.description).toBe("app testing");
  });

  it("a refresh requested before the PATCH and answered after it is dropped", async () => {
    server.entry = entry({ description: "BAU" });
    const tab = await openTab();
    server.holdNext = "bootstrap";
    let stale: Promise<unknown> = Promise.resolve();
    act(() => { stale = tab.runtime().refresh({ force: true }); });
    await waitFor(() => expect(server.release).not.toBeNull());
    const releaseStale = server.release!;
    server.release = null;
    await tab.clearAndType("app testing");
    await waitFor(() => expect(server.entry?.description).toBe("app testing"), { timeout: 3_000 });
    await act(async () => { releaseStale(); await stale; });
    await wait(1_200);
    expect(tab.input.value).toBe("app testing");
    expect(server.patches.map((patch) => patch.body.description)).toEqual(["app testing"]);
  });
});

describe("Codex r1 on #387", () => {
  it("an editor save (quick/inline editor) owns the base: typing while it is pending is saved, never a false 409", async () => {
    server.entry = entry({ description: "BAU" });
    const tab = await openTab();
    server.holdNext = "patch";
    const plan = {
      durationSeconds: 2_100,
      payload: { description: "from quick editor" },
      resolved: {
        categoryId: "work",
        description: "from quick editor",
        tagNames: [] as string[],
        startedAt: server.entry.startedAt,
        stoppedAt: null
      }
    } as unknown as Parameters<Runtime["updateActiveEntryFromCalendar"]>[0]["plan"];
    let saved: Promise<unknown> = Promise.resolve();
    act(() => { saved = tab.runtime().updateActiveEntryFromCalendar({ plan }); });
    await waitFor(() => expect(server.patches).toHaveLength(1));
    await waitFor(() => expect(tab.input.value).toBe("from quick editor"));
    // Newer typing in the bar while the editor's PATCH is pending.
    await tab.clearAndType("newer toolbar edit");
    await act(async () => { server.release?.(); await saved; });
    await waitFor(() => expect(server.entry?.description).toBe("newer toolbar edit"), { timeout: 3_000 });
    expect(server.conflicts).toBe(0);
    expect(bodies()[1]).toEqual({ description: "newer toolbar edit", expectedDetails: { description: "from quick editor" } });
    await wait(900);
    expect(tab.input.value).toBe("newer toolbar edit");
  });

  it("a switch whose outgoing edit is refused (409) keeps the notice on screen", async () => {
    server.entry = entry({ description: "BAU" });
    const tab = await openTab();
    // Another window changes the description; this tab has not refreshed.
    server.entry = { ...server.entry, description: "app testing", updatedAt: "2026-10-13T07:31:02.905Z" };
    await tab.type("{End} more");
    const quickStart = Array.from(tab.container.querySelectorAll("button"))
      .find((button) => /^Start Coding/.test(button.getAttribute("aria-label") ?? button.textContent ?? ""));
    expect(quickStart).toBeDefined();
    await userEvent.setup().click(quickStart!);
    await waitFor(() => expect(server.posts).toHaveLength(1), { timeout: 3_000 });
    expect(server.conflicts).toBe(1);
    await waitFor(() => expect(tab.activity()).toBe("Activity: Coding"));
    await wait(300);
    const alert = tab.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("your edit to it was not saved");
  });
});

describe("Discard deletes the real block, never the optimistic id", () => {
  async function startPlan(hold: "start" | "bootstrap") {
    const tab = await openTab();
    server.holdNext = hold;
    await tab.type("Plan{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await waitFor(() => expect(server.release).not.toBeNull());
    const release = server.release!;
    server.release = null;
    return { ...tab, release: () => act(async () => { release(); }) };
  }

  it("POST resolved, its bootstrap held: the DELETE goes to the id the POST returned", async () => {
    const tab = await startPlan("bootstrap");
    expect(tab.runtime().shellData?.activeEntry?.id).toMatch(/^optimistic-timer:/);
    let outcome: unknown;
    await act(async () => { outcome = await tab.runtime().deleteActiveTimer(); });
    expect(outcome).toEqual({ ok: true });
    expect(server.deletes).toEqual(["/api/time-entries/started-1"]);
    expect(server.entry).toBeNull();
    await tab.release();
  });

  it("POST in flight: Discard waits behind the Start, then deletes the real block", async () => {
    const tab = await startPlan("start");
    let discarded: Promise<unknown> = Promise.resolve();
    act(() => { discarded = tab.runtime().deleteActiveTimer(); });
    await wait(50);
    expect(server.deletes).toEqual([]);
    await tab.release();
    let outcome: unknown;
    await act(async () => { outcome = await discarded; });
    expect(outcome).toEqual({ ok: true });
    expect(server.deletes).toEqual(["/api/time-entries/started-1"]);
    expect(server.entry).toBeNull();
    await wait(300);
    expect(tab.runtime().shellData?.activeEntry ?? null).toBeNull();
  });
});

function detailsChanged(current: TimeEntryRow, expected: Partial<Details>) {
  const tags = (names: string[]) => [...names].map((name) => name.toLowerCase()).sort().join(",");
  return ("categoryId" in expected && (expected.categoryId ?? null) !== (current.categoryId ?? null))
    || ("description" in expected && (expected.description ?? null) !== (current.description ?? null))
    || ("tagNames" in expected && tags(expected.tagNames ?? []) !== tags(current.tagNames ?? []));
}

const CATEGORIES = [
  { id: "work", name: "Work", color: "blue", isPinned: true },
  { id: "coding", name: "Coding", color: "mint", isPinned: true }
];

function categoryFields(categoryId: string | null) {
  const category = CATEGORIES.find((item) => item.id === categoryId) ?? null;
  return { categoryId: category?.id ?? null, categoryName: category?.name ?? null, categoryColor: category?.color ?? null };
}

function tagsFor(names: string[]) {
  return names.map((name) => ({ id: name.toLowerCase(), name, normalizedName: name.toLowerCase() }));
}

function bootstrap(activeEntry: TimeEntryRow | null, selectedDate = "2026-08-17"): BootstrapData {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    activeEntry,
    categories: CATEGORIES,
    categoryUsage: [],
    tags: tagsFor(["Cubic"]).map((tag) => ({ ...tag, usageCount: 1 })),
    taskSuggestions: [],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    dateRange: {
      selectedDate,
      dayStart: `${selectedDate}T00:00:00.000Z`,
      dayEnd: "2026-08-18T00:00:00.000Z",
      weekStart: "2026-08-17T00:00:00.000Z",
      weekEnd: "2026-08-24T00:00:00.000Z"
    },
    workspace: { id: "workspace" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "041b6dd9",
    ...categoryFields("work"),
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "BAU",
    startedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
    stoppedAt: null,
    updatedAt: "2026-10-13T06:56:37.000Z",
    durationSeconds: 2_100,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
