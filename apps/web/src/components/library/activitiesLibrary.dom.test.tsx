// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, CategoryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

type Call = { url: string; method: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
let bootstrapReads = 0;
let answer: (call: Call) => Response | Promise<Response> | undefined = () => undefined;
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    if (call.url.startsWith("/api/bootstrap")) bootstrapReads += 1;
    else calls.push(call);
    const answered = await answer(call);
    if (answered) return answered;
    if (url.startsWith("/api/categories?archived=1")) return new Response(JSON.stringify({ categories: [] }), { status: 200 });
    if (url.startsWith("/api/categories")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response("{}", { status: 404 });
  }
}));

const { AppShellRuntimeProvider } = await import("@/components/AppShellRuntime");
const { ActivitiesLibrary } = await import("./ActivitiesLibrary");

const activity = (id: string, name: string, overrides: Partial<CategoryRow> = {}): CategoryRow => ({ id, name, color: "mint", isPinned: false, icon: null, ...overrides });
const ID = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});

afterEach(() => {
  cleanup();
  calls.length = 0;
  answer = () => undefined;
});

function mount(categories: CategoryRow[]) {
  return render(
    <AppShellRuntimeProvider>
      <ActivitiesLibrary initialData={bootstrap(categories)} />
    </AppShellRuntimeProvider>
  );
}

const changes = () => calls.filter((call) => call.method !== "GET");

describe("Library › Activities", () => {
  it("pins to quick start and says so on the toast", async () => {
    const user = userEvent.setup();
    const pinned = Array.from({ length: 5 }, (_, index) => activity(ID(index), `Pinned ${index}`, { isPinned: true }));
    mount([...pinned, activity(ID(7), "Reading"), activity(ID(8), "Piano")]);
    await user.click(await screen.findByRole("button", { name: "Pin Reading to quick start" }));
    await waitFor(() => expect(changes()).toEqual([{ url: "/api/categories", method: "PATCH", body: { id: ID(7), isPinned: true } }]));
    expect((await screen.findByRole("status")).textContent).toContain("Reading pinned to quick start");
  });

  it("refuses a seventh pin without asking the server", async () => {
    const user = userEvent.setup();
    const pinned = Array.from({ length: 6 }, (_, index) => activity(ID(index), `Pinned ${index}`, { isPinned: true }));
    mount([...pinned, activity(ID(7), "Reading")]);
    await user.click(await screen.findByRole("button", { name: "Pin Reading to quick start" }));
    expect(screen.getByRole("alert").textContent).toContain("Quick start holds 6 activities. Unpin one first.");
    expect(changes()).toEqual([]);
  });

  it("creates an activity, sending an icon only when one was picked", async () => {
    const user = userEvent.setup();
    mount([activity(ID(1), "Reading")]);
    await user.click(await screen.findByRole("button", { name: /New activity/ }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByPlaceholderText("Name, like Gardening or Piano");
    await user.type(name, "reading");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("reading already exists.");
    expect(changes()).toEqual([]);

    await user.clear(name);
    await user.type(name, "Gardening");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]).toMatchObject({ url: "/api/categories", method: "POST" });
    expect(changes()[0].body).not.toHaveProperty("icon");
    expect(changes()[0].body).toMatchObject({ name: "Gardening" });
  });

  it("saves a picked icon and colour, and keeps the editor open with the server's refusal", async () => {
    const user = userEvent.setup();
    answer = (call) => call.method === "PATCH" ? new Response(JSON.stringify({ error: "An activity with that name already exists." }), { status: 409 }) : undefined;
    mount([activity(ID(1), "Reading")]);
    await user.click(await screen.findByRole("button", { name: "Edit Reading" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Music" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("already exists"));
    expect(changes()[0].body).toMatchObject({ id: ID(1), name: "Reading", icon: "music" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("archives from the editor with Undo, which restores and re-pins", async () => {
    const user = userEvent.setup();
    mount([activity(ID(1), "Reading", { isPinned: true })]);
    await user.click(await screen.findByRole("button", { name: "Edit Reading" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(changes()[0]).toEqual({ url: `/api/categories?id=${ID(1)}`, method: "DELETE", body: null }));
    const toast = await screen.findByText("Reading archived. Its history stays.");
    const undo = within(toast.closest(".df-toast")! as HTMLElement).getByRole("button", { name: "Undo" });
    // The editor (and its opener) went away: focus moves to Undo.
    await waitFor(() => expect(document.activeElement).toBe(undo));
    await user.click(undo);
    // The server restores unpinned, so the re-pin is its own request after the restore.
    await waitFor(() => expect(changes().slice(1)).toEqual([
      { url: "/api/categories", method: "PATCH", body: { id: ID(1), isArchived: false } },
      { url: "/api/categories", method: "PATCH", body: { id: ID(1), isPinned: true } }
    ]));
  });

  it("runs an Undo pressed while another change saves as soon as that change finishes", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    answer = (call) => call.method === "PATCH" && call.body?.isPinned === true
      ? new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); })
      : undefined;
    mount([activity(ID(1), "Reading"), activity(ID(2), "Piano")]);
    await user.click(await screen.findByRole("button", { name: "Edit Reading" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    const toast = (await screen.findByText("Reading archived. Its history stays.")).closest(".df-toast") as HTMLElement;
    await user.click(screen.getByRole("button", { name: "Pin Piano to quick start" }));
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(changes().filter((call) => call.body?.isArchived === false)).toEqual([]);
    release();
    await waitFor(() => expect(changes().filter((call) => call.body?.isArchived === false)).toEqual([
      { url: "/api/categories", method: "PATCH", body: { id: ID(1), isArchived: false } }
    ]));
  });

  it("refreshes the shell when a restore lands but its re-pin is refused", async () => {
    const user = userEvent.setup();
    answer = (call) => call.method === "PATCH" && call.body?.isPinned === true && call.body?.id === ID(1)
      ? new Response(JSON.stringify({ error: "Quick start holds 6 activities. Unpin one first." }), { status: 409 })
      : undefined;
    mount([activity(ID(1), "Reading", { isPinned: true })]);
    await user.click(await screen.findByRole("button", { name: "Edit Reading" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    const toast = (await screen.findByText("Reading archived. Its history stays.")).closest(".df-toast") as HTMLElement;
    const before = bootstrapReads;
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Quick start holds 6"));
    await waitFor(() => expect(bootstrapReads).toBeGreaterThan(before));
  });

  it("puts focus on the saved activity's Edit even when the save moved it to another group", async () => {
    const user = userEvent.setup();
    let saved = false;
    // After the save, the refreshed data has the activity with its new icon (another group).
    answer = (call) => {
      if (call.method === "PATCH") {
        saved = true;
        return undefined;
      }
      if (call.url.startsWith("/api/bootstrap") && saved) {
        const refreshed = bootstrap([activity(ID(1), "Zither practice", { icon: "music" })]);
        const date = new URL(call.url, "http://localhost").searchParams.get("date") ?? "";
        return new Response(JSON.stringify({ ...refreshed, dateRange: { ...refreshed.dateRange, selectedDate: date } }), { status: 200 });
      }
      return undefined;
    };
    const { container } = mount([activity(ID(1), "Zither practice")]);
    const groupOf = () => container.querySelector(`#category-${ID(1)}`)?.closest("section")?.querySelector("h2")?.firstChild?.textContent;
    expect(groupOf()).toBe("Your own");
    await user.click(await screen.findByRole("button", { name: "Edit Zither practice" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("radio", { name: "Music" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(groupOf()).toBe("Free time");
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit Zither practice"));
  });

  it("keeps each card reachable by its activity link and locks Edit while a change saves", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    answer = (call) => call.method === "PATCH"
      ? new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); })
      : undefined;
    const { container } = mount([activity(ID(1), "Reading")]);
    expect(container.querySelector(`#category-${ID(1)}`)?.getAttribute("aria-label")).toBe("Reading");
    await user.click(await screen.findByRole("button", { name: "Pin Reading to quick start" }));
    expect((screen.getByRole("button", { name: "Edit Reading" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /New activity/ }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((screen.getByRole("button", { name: "Edit Reading" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("moves focus to the restored card's Edit when an Archived row is restored", async () => {
    const user = userEvent.setup();
    let restored = false;
    answer = (call) => {
      if (call.url.startsWith("/api/categories?archived=1")) {
        return new Response(JSON.stringify({ categories: restored ? [] : [activity(ID(2), "Old hobby")] }), { status: 200 });
      }
      if (call.method === "PATCH") {
        restored = true;
        return undefined;
      }
      if (call.url.startsWith("/api/bootstrap") && restored) {
        const refreshed = bootstrap([activity(ID(1), "Reading"), activity(ID(2), "Old hobby")]);
        const date = new URL(call.url, "http://localhost").searchParams.get("date") ?? "";
        return new Response(JSON.stringify({ ...refreshed, dateRange: { ...refreshed.dateRange, selectedDate: date } }), { status: 200 });
      }
      return undefined;
    };
    mount([activity(ID(1), "Reading")]);
    const row = (await screen.findByText("Old hobby")).closest("li")!;
    const restoreButton = within(row as HTMLElement).getByRole("button", { name: "Restore" });
    restoreButton.focus();
    await user.click(restoreButton);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit Old hobby"));
  });

  it("lists archived activities with Restore", async () => {
    const user = userEvent.setup();
    answer = (call) => call.url.startsWith("/api/categories?archived=1")
      ? new Response(JSON.stringify({ categories: [activity(ID(2), "Old hobby")] }), { status: 200 })
      : undefined;
    mount([activity(ID(1), "Reading")]);
    const row = (await screen.findByText("Old hobby")).closest("li")!;
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(changes()).toEqual([{ url: "/api/categories", method: "PATCH", body: { id: ID(2), isArchived: false } }]));
  });

  it("lets one change save at a time", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    answer = (call) => call.method === "PATCH"
      ? new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); })
      : undefined;
    mount([activity(ID(1), "Reading"), activity(ID(2), "Piano")]);
    await user.click(await screen.findByRole("button", { name: "Pin Reading to quick start" }));
    await waitFor(() => expect(changes()).toHaveLength(1));
    // The pins are disabled while a change saves.
    expect((screen.getByRole("button", { name: "Pin Piano to quick start" }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((screen.getByRole("button", { name: "Pin Piano to quick start" }) as HTMLButtonElement).disabled).toBe(false));
  });
});

function bootstrap(categories: CategoryRow[]): BootstrapData {
  const day = new Date(2026, 7, 17).toISOString();
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" },
    workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories,
    categoryUsage: [],
    tags: [],
    taskSuggestions: [],
    reviewItems: [],
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0 },
    activityEvents: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    dateRange: { selectedDate: "2026-08-17", dayStart: day, dayEnd: day, weekStart: day, weekEnd: day }
  } as unknown as BootstrapData;
}
