// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

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

function rowLabels(container: HTMLElement) {
  return [...container.querySelectorAll(".df-erow-main")].map((button) => button.getAttribute("aria-label")?.split(",")[0]);
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
    expect(toast?.textContent).toContain("“Inbox” deleted");

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
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0 },
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
