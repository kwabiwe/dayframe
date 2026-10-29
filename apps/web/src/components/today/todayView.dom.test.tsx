// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow, TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("")
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  void input;
  if (init?.method === "DELETE") return new Response("{}", { status: 200 });
  return new Response("{}", { status: 404 });
});

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (input: string, init?: RequestInit) => fetchMock(input, init)
}));

const { AppShellRuntimeProvider } = await import("@/components/AppShellRuntime");
const { TodayView } = await import("./TodayView");

// Local wall-clock times, so the test holds in any time zone.
const local = (hour: number, minute = 0) => new Date(2026, 7, 17, hour, minute).toISOString();
const NOW = new Date(2026, 7, 17, 12, 0);
const renderedAt = NOW.toISOString();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fetchMock.mockClear();
  document.body.innerHTML = "";
});

function tree(data: BootstrapData) {
  return (
    <AppShellRuntimeProvider>
      <TodayView initialData={data} renderedAt={renderedAt} />
    </AppShellRuntimeProvider>
  );
}

async function mount(data: BootstrapData) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(tree(data)));
  return { container, root };
}

/** An open location suggestion: one "?" in Calendar › List. */
function checkItem(id: string, startedAt: string, stoppedAt: string): ReviewItemRow {
  return {
    id, type: "location_place", title: "Visited a place", eventSource: "location", eventType: "geofence_stay", projectName: null,
    categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null,
    suggestedStartedAt: startedAt, suggestedStoppedAt: stoppedAt, confidence: "medium", status: "open", notes: null, rawPayload: null,
    createdAt: startedAt
  };
}

/** Today's rows, without a named pattern's parts (they sit in its panel, open or not). */
function rowLabels(container: HTMLElement) {
  return [...container.querySelectorAll(".df-erow-main")]
    .filter((button) => !button.closest(".df-erow-children"))
    .map((button) => button.getAttribute("aria-label")?.split(",")[0]);
}

describe("Today", () => {
  it("hydrates the server frame without a mismatch, then draws today in the browser's time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const data = bootstrap();
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree(data));
    document.body.append(container);
    expect(container.querySelector(".df-today")?.getAttribute("aria-busy")).toBe("true");

    vi.setSystemTime(new Date(NOW.getTime() + 7_000));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree(data), { onRecoverableError: (error) => recoverable.push(error) });
    });
    expect(consoleError.mock.calls.flat().map(String).join("\n")).not.toMatch(/hydrat/i);
    expect(recoverable).toEqual([]);

    // Inbox 09:00–10:00 plus Deep work running since 11:00: 2h framed at 12:00.
    expect(container.querySelector("#df-today-total")?.textContent).toContain("2h");
    expect(rowLabels(container)).toEqual(["Deep work", "Inbox"]);
    await act(async () => root?.unmount());
  });

  it("fills the goal only with activities that count toward it (UIA-043)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const counting = await mount(bootstrap());
    // Both hours count: the line reads as before.
    expect(counting.container.querySelector(".df-today-sub")?.textContent).toBe("framed today · 25% of your 8h goal");
    await act(async () => counting.root.unmount());

    const data = bootstrap();
    data.categories = data.categories.map((category) => category.id === "admin" ? { ...category, countsTowardGoal: false } : category);
    const { container, root } = await mount(data);
    expect(container.querySelector("#df-today-total")?.textContent).toContain("2h");
    expect(container.querySelector(".df-today-sub")?.textContent).toBe("framed today · 1h toward your 8h goal (13%)");
    await act(async () => root.unmount());

    // Admin archived: gone from `categories`, still listed as not counting.
    const archived = bootstrap();
    archived.categories = archived.categories.filter((category) => category.id !== "admin");
    archived.goalExcludedCategoryIds = ["admin"];
    const after = await mount(archived);
    expect(after.container.querySelector(".df-today-sub")?.textContent).toBe("framed today · 1h toward your 8h goal (13%)");
    await act(async () => after.root.unmount());
  });

  it("deletes a finished block with Backspace, offers Undo on the toast and restores it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    const { container, root } = await mount(bootstrap());
    const inbox = [...container.querySelectorAll<HTMLButtonElement>(".df-erow-main")].find((button) =>
      button.getAttribute("aria-label")?.startsWith("Inbox"));
    expect(inbox).toBeDefined();

    inbox!.focus();
    await act(async () => {
      inbox!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    // The row fades for 180 ms before it leaves.
    await act(async () => vi.advanceTimersByTime(200));
    expect(rowLabels(container)).toEqual(["Deep work"]);
    const toast = container.querySelector(".df-toast");
    expect(toast?.textContent).toContain("Deleted Inbox");

    await act(async () => {
      toast!.querySelector<HTMLButtonElement>(".df-toast-action")!.click();
    });
    expect(rowLabels(container)).toEqual(["Deep work", "Inbox"]);
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await act(async () => root.unmount());
  });

  it("commits the delete when the Undo window ends, and ⌘Z only undoes outside a text field", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    const { container, root } = await mount(bootstrap());
    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete Inbox"]');
    await act(async () => deleteButton!.click());
    await act(async () => vi.advanceTimersByTime(200));

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    });
    expect(rowLabels(container)).toEqual(["Deep work"]);

    await act(async () => vi.advanceTimersByTime(5_100));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/time-entries/${INBOX_ID}`,
      expect.objectContaining({ method: "DELETE" })
    );
    await act(async () => root.unmount());
  });

  it("shows an overnight block's whole interval and duration", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const data = bootstrap();
    const night = entry({
      id: "80000000-0000-4000-8000-000000000003",
      description: "Late shift",
      startedAt: new Date(2026, 7, 16, 23, 0).toISOString(),
      stoppedAt: local(1),
      durationSeconds: 7200
    });
    data.historyEntries = [...data.historyEntries, night];
    const { container, root } = await mount(data);
    const row = [...container.querySelectorAll(".df-erow-main")].find((button) =>
      button.getAttribute("aria-label")?.startsWith("Late shift"));
    expect(row?.getAttribute("aria-label")).toContain("23:00 to 01:00, 2h");
    expect(row?.querySelector(".df-erow-dur")?.textContent).toBe("2h");
    await act(async () => root.unmount());
  });

  it("shares overlapping time in Where today went, so the bars add up to the hero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const data = bootstrap();
    // Inbox (Admin) 09:00–10:00 and Deep work (Focus) running since 09:30: 3h framed at 12:00,
    // but 3h 30m logged. The shared 09:30–10:00 splits 15m each.
    const live = { ...data.activeEntry!, startedAt: local(9, 30), updatedAt: local(9, 30) } as TimeEntryRow;
    const finished = data.entries.find((item) => item.id === INBOX_ID)!;
    data.activeEntry = live;
    data.entries = [finished, live];
    data.historyEntries = data.entries;
    data.dayEntries = data.entries;
    data.weekEntries = data.entries;
    const { container, root } = await mount(data);
    expect(container.querySelector("#df-today-total")?.textContent).toContain("3h");
    const bars = [...container.querySelectorAll(".df-bar-row")].map((row) => [
      row.querySelector("b")?.textContent,
      row.querySelector(".df-tnum")?.textContent
    ]);
    expect(bars).toEqual([
      ["Focus", "2h 15m"],
      ["Admin", "45m"]
    ]);
    const barSeconds = bars.reduce((sum, [, text]) => sum + displayedSeconds(text ?? ""), 0);
    expect(barSeconds).toBe(3 * 3600);
    await act(async () => root.unmount());
  });

  it("gathers activities after the top four into Other, so six overlapping activities still add up to the hero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const data = bootstrap();
    // Six activities all 09:00–10:00: a 1h hero, 10m each. Top four by name, then Other with 20m.
    const names = ["Admin", "Cooking", "Errands", "Focus", "Gym", "Reading"];
    data.categories = names.map((name) => ({ id: name.toLowerCase(), name, color: "mint", isPinned: false })) as BootstrapData["categories"];
    data.entries = names.map((name, index) =>
      entry({
        id: `80000000-0000-4000-8000-00000000001${index}`,
        categoryId: name.toLowerCase(),
        categoryName: name,
        description: name,
        startedAt: local(9),
        stoppedAt: local(10),
        durationSeconds: 3600
      }));
    data.activeEntry = null;
    data.historyEntries = data.entries;
    data.dayEntries = data.entries;
    data.weekEntries = data.entries;
    const { container, root } = await mount(data);
    expect(container.querySelector("#df-today-total")?.textContent).toContain("1h");
    expect(container.querySelector(".df-today-went .df-faint")?.textContent).toBe("6 activities");
    const rows = [...container.querySelectorAll(".df-bar-row")];
    expect(rows.map((row) => [row.querySelector("b")?.firstChild?.textContent, row.querySelector(".df-tnum")?.textContent])).toEqual([
      ["Admin", "10m"],
      ["Cooking", "10m"],
      ["Errands", "10m"],
      ["Focus", "10m"],
      ["Other", "20m"]
    ]);
    expect(rows[4].querySelector("b")?.textContent).toBe("Other: Gym and Reading");
    expect(rows[4].querySelector(".df-bar-fill")?.classList.contains("is-none")).toBe(true);
    expect(rows.reduce((sum, row) => sum + displayedSeconds(row.querySelector(".df-tnum")?.textContent ?? ""), 0)).toBe(3600);
    expect(container.querySelector("#df-today-went-note")?.textContent).toContain("then Other for the rest");
    await act(async () => root.unmount());
  });

  it("says what is left to check today in one quiet chip that opens Calendar's List at the first one (location v4 step 14)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const data = bootstrap();
    // The chip counts today's "?" from the badge's own list (owner, 28 Oct 2026): yesterday's and an
    // answered one don't count here, and the server's dayCheckCount only stands in before hydration.
    const reviewItems = [
      checkItem("check-today-late", local(10), local(10, 30)),
      checkItem("check-today-early", local(9), local(9, 20)),
      checkItem("check-yesterday", new Date(2026, 7, 16, 15).toISOString(), new Date(2026, 7, 16, 16).toISOString()),
      { ...checkItem("check-answered", local(8), local(8, 30)), status: "accepted" }
    ];
    const { container, root } = await mount({ ...data, reviewItems, stats: { ...data.stats, reviewCount: 4, reviewCardCount: 2, checkCount: 5, dayCheckCount: 7 } });
    expect(container.querySelector<HTMLElement>(".df-today-checks")?.dataset.open).toBe("true");
    const chip = container.querySelector<HTMLAnchorElement>(".df-today-checks a");
    expect(chip?.textContent).toContain("2 to check today");
    // It opens today's oldest question in Calendar's List.
    expect(chip?.getAttribute("href")).toBe("/timeline?view=list&scope=day&date=2026-08-17&check=check-today-early");
    // The Review card is gone; nothing shows when there is nothing to check today.
    expect(container.textContent).not.toContain("moments waiting");
    await act(async () => root.render(tree({ ...data, reviewItems: reviewItems.slice(2), stats: { ...data.stats, dayCheckCount: 7 } })));
    // It closes (its row folds away and fades; at once with Reduce Motion), hidden from assistive tech and the keyboard.
    const closed = container.querySelector<HTMLElement>(".df-today-checks");
    expect(closed?.dataset.open).toBe("false");
    expect(closed?.getAttribute("aria-hidden")).toBe("true");
    expect(closed?.hasAttribute("inert")).toBe(true);
    // It keeps its words while it closes.
    expect(closed?.textContent).toContain("2 to check today");
    await act(async () => root.unmount());
  });

  describe("a named pattern (location v3 PR 14)", () => {
    const group = { key: "named:stay", name: "School run", parts: 3 };
    const part = (id: string, from: number, to: number, extra: Partial<TimeEntryRow> = {}) => entry({
      id, source: "location_learning", description: null, categoryId: "travel", categoryName: "Travel", categoryColor: "slate",
      startedAt: local(8, from), stoppedAt: local(8, to), durationSeconds: (to - from) * 60, locationGroup: group, ...extra
    });
    const ids = ["81000000-0000-4000-8000-000000000001", "81000000-0000-4000-8000-000000000002", "81000000-0000-4000-8000-000000000003"];
    function withTrip() {
      const data = bootstrap();
      const trip = [
        part(ids[0], 0, 10),
        part(ids[1], 10, 30, { description: "School", categoryId: "admin", categoryName: "Admin", categoryColor: "steel" }),
        part(ids[2], 30, 40)
      ];
      const entries = [...data.entries, ...trip];
      return { ...data, entries, historyEntries: entries, dayEntries: entries, weekEntries: entries } as BootstrapData;
    }

    it("shows its parts as one row with its name, its whole time and a strip, and opens to the parts", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const { container, root } = await mount(withTrip());
      expect(rowLabels(container)).toEqual(["Deep work", "Inbox", "School run"]);
      const named = container.querySelector<HTMLButtonElement>(".df-erow-named .df-erow-main")!;
      expect(named.getAttribute("aria-label")).toContain("School run, 3 parts: Travel, then School, then Travel, 08:00 to 08:40, 40m. Show the parts");
      expect(named.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelectorAll(".df-erow-parts i")).toHaveLength(3);
      expect(container.querySelector(".df-erow-named .df-erow-when")?.textContent).toBe("08:00–08:40 · 3 parts");
      // Phones hide the time column; the text column keeps the span and parts (Codex r1 on #501).
      expect(container.querySelector(".df-erow-named .df-erow-named-meta")?.textContent).toBe("08:00–08:40 · 3 parts");
      expect(container.querySelector(".df-erow-children")?.hasAttribute("inert")).toBe(true);
      // No Start again on a group; its parts keep their own.
      expect(container.querySelector('.df-erow-named button[aria-label^="Start"]')).toBeNull();
      await act(async () => named.click());
      expect(named.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector(".df-erow-children")?.hasAttribute("inert")).toBe(false);
      expect(container.querySelectorAll(".df-erow-children .df-erow")).toHaveLength(3);
      await act(async () => root.unmount());
    });

    it("moves focus to the group's header, not a hidden part, when its neighbour is deleted (Codex r1 on #501)", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      vi.setSystemTime(NOW);
      const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        callback(0);
        return 0;
      });
      const { container, root } = await mount(withTrip());
      const inbox = [...container.querySelectorAll<HTMLButtonElement>(".df-erow-main")].find((button) =>
        button.getAttribute("aria-label")?.startsWith("Inbox"))!;
      inbox.focus();
      await act(async () => inbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
      await act(async () => vi.advanceTimersByTime(200));
      expect(document.activeElement).toBe(container.querySelector(".df-erow-named .df-erow-main"));
      frame.mockRestore();
      await act(async () => root.unmount());
    });

    it("deletes all its parts with one Undo", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      vi.setSystemTime(NOW);
      const { container, root } = await mount(withTrip());
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Delete School run: all 3 parts"]')!.click());
      await act(async () => vi.advanceTimersByTime(200));
      expect(rowLabels(container)).toEqual(["Deep work", "Inbox"]);
      const toast = container.querySelector(".df-toast");
      expect(toast?.textContent).toContain("Deleted 3 School run blocks");
      await act(async () => toast!.querySelector<HTMLButtonElement>(".df-toast-action")!.click());
      expect(rowLabels(container)).toEqual(["Deep work", "Inbox", "School run"]);
      await act(async () => vi.advanceTimersByTime(6_000));
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
      await act(async () => root.unmount());
    });
  });

  it("never offers Delete or Start again on the running block", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { container, root } = await mount(bootstrap());
    expect(container.querySelector('button[aria-label="Delete Deep work"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Start Deep work again"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Edit Deep work"]')).not.toBeNull();
    await act(async () => root.unmount());
  });
});

const INBOX_ID = "80000000-0000-4000-8000-000000000002";

/** "2h 15m" → 8100; the bars and hero read in whole minutes. */
function displayedSeconds(text: string) {
  const hours = /(\d+)h/.exec(text)?.[1] ?? "0";
  const minutes = /(\d+)m/.exec(text)?.[1] ?? "0";
  return Number(hours) * 3600 + Number(minutes) * 60;
}

function bootstrap(): BootstrapData {
  const finished = entry({
    id: INBOX_ID,
    categoryId: "admin",
    categoryName: "Admin",
    categoryColor: "steel",
    description: "Inbox",
    startedAt: local(9),
    stoppedAt: local(10),
    durationSeconds: 3600
  });
  const live = entry();
  const entries = [finished, live];
  return {
    activeEntry: live,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" },
    workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [
      { id: "focus", name: "Focus", color: "mint", isPinned: true },
      { id: "admin", name: "Admin", color: "steel", isPinned: false }
    ],
    categoryUsage: [],
    tags: [],
    taskSuggestions: [],
    reviewItems: [],
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0, reviewCardCount: 0 },
    activityEvents: [],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    dateRange: {
      selectedDate: "2026-08-17",
      dayStart: local(0),
      dayEnd: new Date(2026, 7, 18).toISOString(),
      weekStart: local(0),
      weekEnd: new Date(2026, 7, 24).toISOString()
    }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "80000000-0000-4000-8000-000000000001",
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
    description: "Deep work",
    startedAt: local(11),
    stoppedAt: null,
    updatedAt: local(11),
    durationSeconds: 0,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
