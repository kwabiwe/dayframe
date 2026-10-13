// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Codex r5 on #361 (owner rule, 12 Oct 2026): the command timer's description is always saved
// verbatim. Only an explicit choice from the `@` Activities list removes typed `@` text. These
// tests drive the real AppShellRuntimeProvider (bootstrap hydration, draft reconciliation,
// autosave PATCH and its rollback) against a fake server, so no hidden state can drop a saved
// "@writing".

type Patch = { categoryId: string | null; description: string | null; tagNames: string[]; url?: string };

const server = {
  entry: null as TimeEntryRow | null,
  /** The block a Start replaced, as the server last had it. */
  completed: null as TimeEntryRow | null,
  patches: [] as Patch[],
  /** Each PATCH body exactly as sent. */
  sent: [] as Record<string, unknown>[],
  patchUrls: [] as string[],
  patchInits: [] as RequestInit[],
  posts: [] as Record<string, unknown>[],
  /** Stop events: the block each one targeted. */
  stops: [] as string[],
  rejectPatches: false,
  rejectStart: false,
  /** The next PATCH or Start waits (the request is recorded) until `release()`. */
  holdNext: null as "patch" | "start" | "bootstrap" | null,
  /** Tags the workspace knows besides the running block's. */
  tags: [] as string[],
  release: null as (() => void) | null
};

/** Whether a field the PATCH's edit was based on (`expectedDetails`) has changed since. */
function detailsChanged(current: TimeEntryRow, expected: Partial<Patch>) {
  const tags = (names: string[]) => [...names].map((name) => name.toLowerCase()).sort().join(",");
  return ("categoryId" in expected && (expected.categoryId ?? null) !== (current.categoryId ?? null))
    || ("description" in expected && (expected.description ?? null) !== (current.description ?? null))
    || ("tagNames" in expected && tags(expected.tagNames ?? []) !== tags(current.tagNames ?? []));
}

async function maybeHold(kind: "patch" | "start" | "bootstrap") {
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
    const reply = (ok: boolean, body: unknown) => ({ ok, status: ok ? 200 : 500, json: async () => body });
    if (url === "/api/timer-state") {
      return reply(true, { activeEntryId: server.entry?.id ?? null, updatedAt: server.entry?.updatedAt ?? null });
    }
    if (url.startsWith("/api/bootstrap")) {
      await maybeHold("bootstrap");
      return reply(true, bootstrap(server.entry));
    }
    if (method === "PATCH" && url.startsWith("/api/time-entries/")) {
      const body = JSON.parse(String(init?.body)) as Partial<Patch> & { expectedDetails?: Partial<Patch> };
      const { expectedDetails, ...sent } = body;
      // Recorded as the details the PATCH asks the block to have: only the fields it sends change
      // (as on the server); the raw request is kept in `sent`.
      const before = server.entry;
      server.patches.push({
        ...(before ? { categoryId: before.categoryId, description: before.description, tagNames: before.tagNames } : {}),
        ...sent
      } as Patch);
      server.sent.push(body);
      server.patchUrls.push(url);
      server.patchInits.push(init ?? {});
      // Only the running block can be patched (an optimistic id is unknown to the server).
      if (url !== `/api/time-entries/${server.entry?.id}`) return reply(false, { error: "Not found" });
      await maybeHold("patch");
      if (server.rejectPatches) return reply(false, { error: "Rejected" });
      if (expectedDetails && detailsChanged(server.entry!, expectedDetails)) {
        return { ok: false, status: 409, json: async () => ({ error: "Changed elsewhere", entry: server.entry }) };
      }
      const updatedAt = new Date(Date.parse(server.entry!.updatedAt) + 60_000).toISOString();
      server.entry = { ...server.entry!, ...sent, updatedAt } as TimeEntryRow;
      return reply(true, { updatedAt });
    }
    if (method === "POST" && url === "/api/time-entries") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      server.posts.push(body);
      await maybeHold("start");
      if (server.rejectStart) return reply(false, { error: "Start rejected" });
      if (server.entry) server.completed = { ...server.entry, stoppedAt: new Date().toISOString() };
      server.entry = {
        ...(server.entry ?? entry()),
        id: `started-${server.posts.length}`,
        categoryId: (body.categoryId as string | undefined) ?? null,
        description: (body.description as string | undefined) ?? null,
        tagNames: (body.tagNames as string[] | undefined) ?? [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      // As `POST /api/time-entries` does: the processed event, with the started block's id.
      return reply(true, { timeEntryId: server.entry.id });
    }
    if (method === "POST" && url === "/api/events") {
      const body = JSON.parse(String(init?.body)) as { type?: string; rawPayload?: { targetEntryId?: string } };
      const target = body.rawPayload?.targetEntryId ?? "";
      server.stops.push(target);
      if (body.type !== "timer_stop" || !server.entry || target !== server.entry.id) return reply(false, { error: "Not running" });
      server.completed = { ...server.entry, stoppedAt: new Date().toISOString() };
      server.entry = null;
      return reply(true, { timeEntryId: target });
    }
    return reply(false, {});
  })
}));

// These tests wait on the real 650 ms autosave debounce and deferred requests, several times each.
vi.setConfig({ testTimeout: 20_000 });

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar } = await import("./PersistentTimerBar");

beforeEach(() => {
  server.entry = null;
  server.completed = null;
  server.patches = [];
  server.sent = [];
  server.patchUrls = [];
  server.patchInits = [];
  server.posts = [];
  server.stops = [];
  server.holdNext = null;
  server.release = null;
  server.rejectStart = false;
  server.tags = [];
  server.rejectPatches = false;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const activitiesOpen = () => screen.queryByRole("listbox", { name: "Activities" }) !== null;

/** Loads `entry` as the shell does on a page load, then renders the bar. */
async function renderShell(entry: TimeEntryRow | null) {
  server.entry = entry;
  let refresh: () => Promise<unknown> = async () => undefined;
  let stop: () => Promise<unknown> = async () => undefined;
  function Loader() {
    const runtime = useAppShellRuntime();
    refresh = () => runtime.refresh({ force: true });
    stop = () => runtime.stopTimer();
    const { hydrate: load } = runtime;
    useEffect(() => load(bootstrap(server.entry)), [load]);
    return runtime.shellData ? <PersistentTimerBar /> : null;
  }
  const { unmount } = render(<AppShellRuntimeProvider><Loader /></AppShellRuntimeProvider>);
  const input = await screen.findByLabelText("Description") as HTMLInputElement;
  // A server copy arriving later (another device started a block, a poll noticed it).
  return { input, unmount, refresh: () => act(async () => { await refresh(); }), stop: () => stop() };
}

function descriptions() {
  return server.patches.map((patch) => patch.description);
}

describe("Codex r5: the saved description can never lose its @words", () => {
  it("loading a running \"Discuss @writing\" never PATCHes it", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }));
    await waitFor(() => expect(input.value).toBe("Discuss @writing"));
    await wait(1_000);
    expect(server.patches).toEqual([]);
  });

  it("a new block arriving mid-edit keeps its own @words", async () => {
    const { input, refresh } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} more");
    server.entry = entry({ id: "next", description: "Call @writing", updatedAt: "2026-08-17T06:00:00.000Z" });
    await refresh();
    await waitFor(() => expect(input.value).toBe("Call @writing"));
    await wait(1_000);
    for (const description of descriptions()) expect(description).not.toBe("Call");
    expect(server.entry?.description).toBe("Call @writing");
  });

  it("a rejected autosave rolls back to the saved text and nothing strips it afterwards", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }, ["urgent"]));
    server.rejectPatches = true;
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{Home}@writing {End} @focus #urgent");
    await user.keyboard("{Enter}");
    expect(input.value).toBe("@writing Discuss @writing @focus");
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 2_000 });
    // The rejected save was the text as shown, never a stripped one.
    expect(server.patches[0]).toMatchObject({ description: "@writing Discuss @writing @focus", tagNames: ["urgent"] });
    await waitFor(() => expect(input.value).toBe("Discuss @writing"));
    server.rejectPatches = false;
    await wait(1_200);
    expect(descriptions()).toEqual(["@writing Discuss @writing @focus"]);
  });

  it("undo restores the saved text and it is saved as is", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(input.value).toBe("Discuss ");
    // The browser's undo (historyUndo) puts the text back in one input event.
    fireEvent.change(input, { target: { value: "Discuss @writing" } });
    await user.keyboard("{Escape}");
    await wait(1_000);
    for (const description of descriptions()) expect(description).toContain("@writing");
    expect(server.entry?.description).toBe("Discuss @writing");
  });

  it("select-all and paste saves exactly the pasted text", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }));
    const user = userEvent.setup();
    await user.click(input);
    input.setSelectionRange(0, input.value.length);
    await user.paste("Discuss @writing later");
    expect(input.value).toBe("Discuss @writing later");
    await waitFor(() => expect(descriptions()).toEqual(["Discuss @writing later"]), { timeout: 2_000 });
  });
});

describe("earlier rounds' repros with the real runtime", () => {
  it("r4: @writing typed before a saved \"Discuss @writing\", End, Escape: nothing is stripped", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{Home}@writing {End}");
    // Placing the caret on existing text never opens the list.
    expect(activitiesOpen()).toBe(false);
    await user.keyboard("{Escape}");
    expect(input.value).toBe("@writing Discuss @writing");
    await waitFor(() => expect(descriptions()).toEqual(["@writing Discuss @writing"]), { timeout: 2_000 });
  });

  it("r3: a running \"Discuss @writing\", End, Enter changes nothing", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @writing" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End}");
    expect(activitiesOpen()).toBe(false);
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(input.value).toBe("Discuss @writing");
    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
    expect(server.patches).toEqual([]);
  });

  it("r3: idle \"Plan @foc @wri\", Tab picks Writing, Enter starts Writing with \"Plan @foc\"", async () => {
    const { input } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan @foc @wri{Tab}");
    expect(input.value).toBe("Plan @foc");
    expect(activitiesOpen()).toBe(false);
    await user.click(input);
    await user.keyboard("{End}{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({ categoryId: "write", description: "Plan @foc" });
  });

  it("r3: deleting one @word after a pick still starts Writing with the rest as written", async () => {
    const { input } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan @foc @other @wri{Tab}");
    expect(input.value).toBe("Plan @foc @other");
    await user.click(input);
    await user.keyboard("{End}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace} ");
    expect(input.value).toBe("Plan @foc ");
    await user.click(screen.getByRole("button", { name: "Start a block" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({ categoryId: "write", description: "Plan @foc" });
  });
});

describe("autosave and Enter while recording", () => {
  it("Escape closes the list and autosave then sends the text verbatim", async () => {
    const { input } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} @wri");
    expect(activitiesOpen()).toBe(true);
    await user.keyboard("{Escape}");
    expect(activitiesOpen()).toBe(false);
    expect(input.value).toBe("Fix bug @wri");
    // Only the edited field is sent, with the value the edit was based on.
    await waitFor(() => expect(server.sent).toEqual([
      { description: "Fix bug @wri", expectedDetails: { description: "Fix bug" } }
    ]), { timeout: 2_000 });
  });

  it("Enter on the list switches the running activity in place and keeps the rest of the text", async () => {
    const { input } = await renderShell(entry({ description: "Discuss @focus wording" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} @wri");
    expect(optionNames()).toEqual(["Writing"]);
    await user.keyboard("{Enter}");
    expect(input.value).toBe("Discuss @focus wording");
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 2_000 });
    expect(server.patches[0]).toMatchObject({ categoryId: "write", description: "Discuss @focus wording" });
    // The same block: no Start, no Stop.
    expect(server.posts).toEqual([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull());
  });
});

describe("Codex r6: no autosave hold; lists belong to their block", () => {
  it("autosave runs while the list is open (verbatim), and after a pick sends the cleaned text", async () => {
    const { input } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} @wri");
    await waitFor(() => expect(descriptions()).toEqual(["Fix bug @wri"]), { timeout: 2_000 });
    expect(activitiesOpen()).toBe(true);
    await user.keyboard("{Enter}");
    expect(input.value).toBe("Fix bug");
    await waitFor(() => expect(server.patches).toHaveLength(2), { timeout: 2_000 });
    expect(server.patches[1]).toMatchObject({ categoryId: "write", description: "Fix bug" });
    expect(server.posts).toEqual([]);
  });

  it("a quick-start switch keeps the outgoing block's edit, even with a list open", async () => {
    const { input } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} new @wri");
    await wait(1_000);
    await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
    await waitFor(() => expect(server.posts).toHaveLength(1), { timeout: 2_000 });
    expect(server.completed?.description).toBe("Fix bug new @wri");
  });

  it("unmounting after the debounce has already saved the edit", async () => {
    const { input, unmount } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} final @wri");
    await wait(1_000);
    unmount();
    expect(descriptions()).toContain("Fix bug final @wri");
    expect(server.entry?.description).toBe("Fix bug final @wri");
  });

  it("a replacement block with the same text never inherits the open list or its pick", async () => {
    const { input, refresh } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} @wri");
    expect(activitiesOpen()).toBe(true);
    server.entry = entry({ id: "next", description: "Fix bug @wri", updatedAt: "2026-08-17T06:00:00.000Z" });
    await refresh();
    expect(input.value).toBe("Fix bug @wri");
    expect(activitiesOpen()).toBe(false);
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(server.patchUrls.filter((url) => url.endsWith("/next"))).toEqual([]);
    expect(server.entry).toMatchObject({ id: "next", categoryId: "focus", description: "Fix bug @wri" });
    // Typing again in the new block opens its own list.
    await user.keyboard("{Backspace}");
    expect(optionNames()).toEqual(["Writing"]);
  });
});

describe("Codex r7: acknowledgements and handoffs keep newer edits", () => {
  const activityLabel = () => screen.getByRole("button", { name: /^Activity:/ }).getAttribute("aria-label");

  it("a pick while the autosave PATCH is pending survives its acknowledgement", async () => {
    const { input } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    server.holdNext = "patch";
    await user.keyboard("{End} @wri");
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 2_000 });
    expect(server.patches[0]).toMatchObject({ categoryId: "focus", description: "Fix bug @wri" });
    await user.keyboard("{Enter}");
    expect(input.value).toBe("Fix bug");
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(server.patches).toHaveLength(2), { timeout: 2_000 });
    expect(server.patches[1]).toMatchObject({ categoryId: "write", description: "Fix bug" });
    await wait(1_000);
    expect(input.value).toBe("Fix bug");
    expect(server.patches).toHaveLength(2);
    expect(server.entry).toMatchObject({ categoryId: "write", description: "Fix bug" });
  });

  it("a plain edit back to the saved text while a PATCH is pending is kept and saved", async () => {
    const { input } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    server.holdNext = "patch";
    await user.keyboard("{End} x");
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 2_000 });
    await user.keyboard("{Backspace}{Backspace}");
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(descriptions()).toEqual(["Fix bug x", "Fix bug"]), { timeout: 2_000 });
    expect(input.value).toBe("Fix bug");
  });

  it("Tags never reopen on a replacement block's text, and Enter cannot tag it", async () => {
    const { input, refresh } = await renderShell(entry({ description: "Fix bug" }, ["urgent"]));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} #ur");
    expect(screen.queryByRole("listbox", { name: "Tags" })).not.toBeNull();
    server.entry = entry({ id: "next", description: "Call #urgent", updatedAt: "2026-08-17T06:00:00.000Z" }, ["urgent"]);
    await refresh();
    await waitFor(() => expect(input.value).toBe("Call #urgent"));
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(server.patchUrls.filter((url) => url.endsWith("/next"))).toEqual([]);
    expect(server.entry).toMatchObject({ id: "next", description: "Call #urgent", tagNames: [] });
  });

  it("a pick while a Start is pending is kept when the real block arrives, and saved to it", async () => {
    const { input } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan @foc{Tab}");
    expect(input.value).toBe("Plan");
    server.holdNext = "start";
    await user.click(input);
    await user.keyboard("{End}{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toMatchObject({ categoryId: "focus", description: "Plan" });
    await user.keyboard(" @wri{Enter}");
    expect(input.value).toBe("Plan");
    expect(activityLabel()).toBe("Activity: Writing");
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 3_000 });
    expect(server.patchUrls[0]).toBe("/api/time-entries/started-1");
    expect(server.patches[0]).toMatchObject({ categoryId: "write", description: "Plan" });
    expect(activityLabel()).toBe("Activity: Writing");
    expect(server.posts).toHaveLength(1);
  });

  it("an activity block change while a Start is pending is kept and saved to the real block", async () => {
    const { input } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan");
    server.holdNext = "start";
    await user.keyboard("{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /^Activity:/ }));
    await user.click(await screen.findByRole("option", { name: /Writing/ }));
    expect(activityLabel()).toBe("Activity: Writing");
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 3_000 });
    expect(server.patches[0]).toMatchObject({ categoryId: "write", description: "Plan" });
    expect(activityLabel()).toBe("Activity: Writing");
  });

  it("a plain edit while a Start is pending is kept and saved to the real block", async () => {
    const { input } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan");
    server.holdNext = "start";
    await user.keyboard("{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await user.keyboard(" more");
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(descriptions()).toEqual(["Plan more"]), { timeout: 3_000 });
    expect(input.value).toBe("Plan more");
  });
});

describe("Codex r8: a genuine change of block starts completion clean", () => {
  async function rejectedSwitch(saved: string, knownTags: string[] = []) {
    const { input } = await renderShell(entry({ description: saved }, knownTags));
    const user = userEvent.setup();
    server.holdNext = "start";
    server.rejectStart = true;
    await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    // The optimistic Writing block is on screen; type the restored block's own text into it.
    await user.click(input);
    await user.keyboard(saved);
    expect(input.value).toBe(saved);
    return { input, user };
  }

  it("a rejected switch does not keep the failed block's Activities list", async () => {
    const { input, user } = await rejectedSwitch("Plan @wri");
    expect(screen.queryByRole("listbox", { name: "Activities" })).not.toBeNull();
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull());
    expect(input.value).toBe("Plan @wri");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(server.patches).toEqual([]);
    expect(server.entry).toMatchObject({ id: "active", categoryId: "focus", description: "Plan @wri" });
  });

  it("a rejected switch does not keep the failed block's Tags list", async () => {
    const { input, user } = await rejectedSwitch("Plan #urgent", ["urgent"]);
    expect(screen.queryByRole("listbox", { name: "Tags" })).not.toBeNull();
    await act(async () => { server.release?.(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull());
    expect(input.value).toBe("Plan #urgent");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(server.patches).toEqual([]);
    expect(server.entry).toMatchObject({ id: "active", description: "Plan #urgent", tagNames: [] });
  });

  it("returning to an earlier block with the same text does not reopen its old list", async () => {
    const { input, refresh } = await renderShell(entry({ description: "Fix bug" }));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("{End} @wri");
    expect(screen.queryByRole("listbox", { name: "Activities" })).not.toBeNull();
    const original = server.entry!;
    server.entry = entry({ id: "next", description: "Call", updatedAt: "2026-08-17T06:00:00.000Z" });
    await refresh();
    await waitFor(() => expect(input.value).toBe("Call"));
    server.entry = { ...original, description: "Fix bug @wri", updatedAt: "2026-08-17T07:00:00.000Z" };
    await refresh();
    await waitFor(() => expect(input.value).toBe("Fix bug @wri"));
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await user.keyboard("{Enter}");
    await wait(1_000);
    expect(server.patches.filter((patch) => patch.categoryId === "write")).toEqual([]);
    expect(server.entry).toMatchObject({ id: "active", categoryId: "focus", description: "Fix bug @wri" });
  });
});

describe("Codex r9: a rejected second Start keeps the first Start's handoff", () => {
  const activityLabel = () => screen.getByRole("button", { name: /^Activity:/ }).getAttribute("aria-label");

  /** Focus / "Plan" started and accepted, its refresh held; a Writing quick start rejected. */
  async function acceptedThenRejected() {
    server.tags = ["urgent"];
    const { input, refresh } = await renderShell(null);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard("Plan @foc{Tab}");
    expect(input.value).toBe("Plan");
    server.holdNext = "bootstrap";
    await user.click(input);
    await user.keyboard("{End}{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await waitFor(() => expect(server.release).not.toBeNull());
    const releaseRefresh = server.release!;
    server.release = null;
    server.rejectStart = true;
    await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
    await waitFor(() => expect(server.posts).toHaveLength(2));
    await waitFor(() => expect(activityLabel()).toBe("Activity: Focus"));
    expect(input.value).toBe("Plan");
    await user.click(input);
    await user.keyboard("{End}");
    // The held refresh lands (the quick start made it stale, so it is dropped), then the next
    // canonical read (the timer-state poll or the periodic reconcile) brings the real block.
    const handOff = async () => {
      await act(async () => { releaseRefresh(); });
      await refresh();
    };
    return { input, user, handOff };
  }

  it("plain text typed on the restored block survives the first Start's handoff", async () => {
    const { input, user, handOff } = await acceptedThenRejected();
    await user.keyboard(" more");
    await handOff();
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 3_000 });
    expect(server.patchUrls[0]).toBe("/api/time-entries/started-1");
    expect(server.patches[0]).toMatchObject({ categoryId: "focus", description: "Plan more" });
    expect(input.value).toBe("Plan more");
  });

  it("an activity pick on the restored block survives the first Start's handoff", async () => {
    const { input, user, handOff } = await acceptedThenRejected();
    await user.keyboard(" @wri{Enter}");
    expect(activityLabel()).toBe("Activity: Writing");
    await handOff();
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 3_000 });
    expect(server.patches[0]).toMatchObject({ categoryId: "write", description: "Plan" });
    expect(activityLabel()).toBe("Activity: Writing");
    expect(input.value).toBe("Plan");
  });

  it("a tag pick on the restored block survives the first Start's handoff", async () => {
    const { input, user, handOff } = await acceptedThenRejected();
    await user.keyboard(" #urg");
    expect(screen.queryByRole("listbox", { name: "Tags" })).not.toBeNull();
    await user.keyboard("{Enter}");
    expect(input.value).toBe("Plan");
    await handOff();
    await waitFor(() => expect(server.patches).toHaveLength(1), { timeout: 3_000 });
    expect(server.patches[0]).toMatchObject({ categoryId: "focus", description: "Plan", tagNames: ["urgent"] });
  });
});

describe("Codex r10: an accepted Start's real id is known from its POST", () => {
  const activityLabel = () => screen.getByRole("button", { name: /^Activity:/ }).getAttribute("aria-label");

  /** Focus / "Plan" started; `hold` keeps either its POST or (once accepted) its refresh waiting. */
  async function startPlan(hold: "start" | "bootstrap") {
    const shell = await renderShell(null);
    const user = userEvent.setup();
    await user.click(shell.input);
    await user.keyboard("Plan @foc{Tab}");
    server.holdNext = hold;
    await user.click(shell.input);
    await user.keyboard("{End}{Enter}");
    await waitFor(() => expect(server.posts).toHaveLength(1));
    await waitFor(() => expect(server.release).not.toBeNull());
    const release = server.release!;
    server.release = null;
    return { ...shell, user, release: () => act(async () => { release(); }) };
  }

  describe("POST accepted, its refresh held", () => {
    it("autosave saves edits to the real block while it still shows optimistically", async () => {
      const { user } = await startPlan("bootstrap");
      await user.keyboard(" more");
      await waitFor(() => expect(server.patchUrls).toEqual(["/api/time-entries/started-1"]), { timeout: 2_000 });
      expect(server.patches[0]).toMatchObject({ categoryId: "focus", description: "Plan more" });
    });

    it("another device's block arriving supersedes it: no list, no edits written to that block", async () => {
      const { input, user, release, refresh } = await startPlan("bootstrap");
      await user.keyboard(" more @wri");
      expect(screen.queryByRole("listbox", { name: "Activities" })).not.toBeNull();
      server.entry = entry({ id: "device-b", description: "Other", updatedAt: "2026-08-17T06:00:00.000Z" });
      await release();
      await refresh();
      await waitFor(() => expect(input.value).toBe("Other"));
      expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
      await user.keyboard("{Enter}");
      await wait(1_000);
      expect(server.patchUrls.filter((url) => url.endsWith("/device-b"))).toEqual([]);
      expect(server.entry).toMatchObject({ id: "device-b", categoryId: "focus", description: "Other" });
    });

    it("Stop after the debounce stops the real block with its edits", async () => {
      const { user, stop } = await startPlan("bootstrap");
      await user.keyboard(" more");
      await wait(1_000);
      await act(async () => { await stop(); });
      expect(server.stops).toEqual(["started-1"]);
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
    });

    it("Stop within the debounce saves the edits to the real block, then stops it", async () => {
      const { user, stop } = await startPlan("bootstrap");
      await user.keyboard(" more");
      await act(async () => { await stop(); });
      expect(server.patchUrls).toContain("/api/time-entries/started-1");
      expect(server.stops).toEqual(["started-1"]);
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
    });

    it("a quick-start switch completes the real block with its saved edits", async () => {
      const { user } = await startPlan("bootstrap");
      await user.keyboard(" more");
      await wait(1_000);
      await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
      await waitFor(() => expect(server.posts).toHaveLength(2));
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
      await waitFor(() => expect(activityLabel()).toBe("Activity: Writing"));
    });

    it("a quick start inside the debounce saves the outgoing edits to the real block first", async () => {
      const { user } = await startPlan("bootstrap");
      await user.keyboard(" more");
      await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
      await waitFor(() => expect(server.posts).toHaveLength(2));
      expect(server.patchUrls).toEqual(["/api/time-entries/started-1"]);
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
    });

    it("leaving the shell sends edits still inside the debounce to the real block", async () => {
      const { user, unmount } = await startPlan("bootstrap");
      await user.keyboard(" final");
      unmount();
      await waitFor(() => expect(server.patchUrls).toEqual(["/api/time-entries/started-1"]));
      expect(server.patches[0]).toMatchObject({ description: "Plan final" });
      // The request outlives the page.
      expect(server.patchInits[0]).toMatchObject({ method: "PATCH", keepalive: true });
      expect(server.sent[0]).toEqual({ description: "Plan final", expectedDetails: { description: "Plan" } });
    });
  });

  describe("POST still in flight", () => {
    it("edits wait, then are saved to the real block as soon as the POST returns", async () => {
      const { input, user, release } = await startPlan("start");
      await user.keyboard(" more");
      await wait(1_000);
      expect(server.patches).toEqual([]);
      await release();
      await waitFor(() => expect(server.patchUrls).toEqual(["/api/time-entries/started-1"]));
      expect(server.patches[0]).toMatchObject({ description: "Plan more" });
      expect(input.value).toBe("Plan more");
    });

    it("Stop waits behind the Start, then stops the real block with the edits", async () => {
      const { user, release, stop } = await startPlan("start");
      await user.keyboard(" more");
      let stopped: Promise<unknown> = Promise.resolve();
      act(() => { stopped = stop(); });
      await release();
      await act(async () => { await stopped; });
      expect(server.stops).toEqual(["started-1"]);
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
    });

    it("a quick start queues behind the Start; the outgoing real block keeps the edits", async () => {
      const { user, release } = await startPlan("start");
      await user.keyboard(" more");
      await user.click(screen.getByRole("button", { name: "Start Writing (2)" }));
      await release();
      await waitFor(() => expect(server.posts).toHaveLength(2));
      expect(server.completed).toMatchObject({ id: "started-1", description: "Plan more" });
      await waitFor(() => expect(activityLabel()).toBe("Activity: Writing"));
    });

    it("leaving the shell before the POST returns cannot target a block (documented loss)", async () => {
      const { user, unmount, release } = await startPlan("start");
      await user.keyboard(" more");
      unmount();
      await release();
      await wait(300);
      // Nothing was sent to an optimistic id; anything sent went to the real block.
      for (const url of server.patchUrls) expect(url).toBe("/api/time-entries/started-1");
    });
  });
});

function optionNames() {
  // The activity's name (a row may also show a muted "Pinned" marker beside it).
  return within(screen.getByRole("listbox", { name: "Activities" })).queryAllByRole("option")
    .map((option) => option.querySelector(".df-flist-label")?.textContent);
}

describe("Stop never starts a new block (production incident, 13 Oct 2026)", () => {
  // The Go/Stop button used to switch from type="button" to type="submit" when Stop re-rendered
  // it as Start, before the browser's default click action ran: every timer-bar Stop since 1 Sep
  // was followed ~100 ms later by a Start of a junk block. jsdom runs that default action before
  // React re-renders, so the guard here is the invariant itself: never a submit button.
  it("the Go/Stop button is a plain button while recording and while idle", async () => {
    await renderShell(entry());
    const stop = screen.getByRole("button", { name: "Stop recording" }) as HTMLButtonElement;
    expect(stop.type).toBe("button");
    await userEvent.click(stop);
    await waitFor(() => expect(server.stops).toEqual(["active"]));
    const start = await screen.findByRole("button", { name: "Start a block" }) as HTMLButtonElement;
    expect(start.type).toBe("button");
    expect(start.form?.querySelector('button[type="submit"], input[type="submit"]')).toBeNull();
    await wait(800);
    expect(server.posts).toEqual([]);
  });

  it("Start from the button still starts one block with the typed description", async () => {
    const { input } = await renderShell(null);
    await userEvent.type(input, "Plan sprint");
    await userEvent.click(screen.getByRole("button", { name: "Start a block" }));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]?.description).toBe("Plan sprint");
    expect(server.stops).toEqual([]);
  });
});

function bootstrap(activeEntry: TimeEntryRow | null): BootstrapData {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    activeEntry,
    categories: [
      { id: "focus", name: "Focus", color: "mint", isPinned: true },
      { id: "write", name: "Writing", color: "blue", isPinned: true }
    ],
    categoryUsage: [],
    tags: [...new Set([...server.tags, ...((activeEntry as (TimeEntryRow & { knownTags?: string[] }) | null)?.knownTags ?? [])])].map((name) => ({
      id: name,
      name,
      normalizedName: name,
      usageCount: 1
    })),
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
    workspace: { id: "workspace" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}, knownTags: string[] = []): TimeEntryRow {
  return {
    id: "active",
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "mint",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Fix bug",
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    stoppedAt: null,
    updatedAt: "2026-08-17T05:00:00.000Z",
    durationSeconds: 1_200,
    tagNames: [],
    tags: [],
    knownTags,
    ...overrides
  } as TimeEntryRow;
}
