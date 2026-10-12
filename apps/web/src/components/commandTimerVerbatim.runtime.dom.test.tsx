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
  patchUrls: [] as string[],
  posts: [] as Record<string, unknown>[],
  rejectPatches: false
};

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
    if (url.startsWith("/api/bootstrap")) return reply(true, bootstrap(server.entry));
    if (method === "PATCH" && url.startsWith("/api/time-entries/")) {
      const body = JSON.parse(String(init?.body)) as Patch;
      server.patches.push(body);
      server.patchUrls.push(url);
      if (server.rejectPatches) return reply(false, { error: "Rejected" });
      const updatedAt = new Date(Date.parse(server.entry!.updatedAt) + 60_000).toISOString();
      server.entry = { ...server.entry!, description: body.description, categoryId: body.categoryId, tagNames: body.tagNames, updatedAt };
      return reply(true, { updatedAt });
    }
    if (method === "POST" && url === "/api/time-entries") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      server.posts.push(body);
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
      return reply(true, {});
    }
    return reply(false, {});
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar } = await import("./PersistentTimerBar");

beforeEach(() => {
  server.entry = null;
  server.completed = null;
  server.patches = [];
  server.patchUrls = [];
  server.posts = [];
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
  function Loader() {
    const runtime = useAppShellRuntime();
    refresh = () => runtime.refresh({ force: true });
    const { hydrate: load } = runtime;
    useEffect(() => load(bootstrap(server.entry)), [load]);
    return runtime.shellData ? <PersistentTimerBar /> : null;
  }
  const { unmount } = render(<AppShellRuntimeProvider><Loader /></AppShellRuntimeProvider>);
  const input = await screen.findByLabelText("Description") as HTMLInputElement;
  // A server copy arriving later (another device started a block, a poll noticed it).
  return { input, unmount, refresh: () => act(async () => { await refresh(); }) };
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
    await waitFor(() => expect(server.patches).toEqual([
      { categoryId: "focus", description: "Fix bug @wri", placeId: null, tagNames: [] }
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

function optionNames() {
  return within(screen.getByRole("listbox", { name: "Activities" })).queryAllByRole("option").map((option) => option.textContent);
}

function bootstrap(activeEntry: TimeEntryRow | null): BootstrapData {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    activeEntry,
    categories: [
      { id: "focus", name: "Focus", color: "mint", isPinned: true },
      { id: "write", name: "Writing", color: "blue", isPinned: true }
    ],
    categoryUsage: [],
    tags: (activeEntry as (TimeEntryRow & { knownTags?: string[] }) | null)?.knownTags?.map((name) => ({
      id: name,
      name,
      normalizedName: name,
      usageCount: 1
    })) ?? [],
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
