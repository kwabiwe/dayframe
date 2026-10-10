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

    // Inbox 09:00–10:00 plus Deep work running since 11:00: 2h 00m framed at 12:00.
    expect(container.querySelector("#df-today-total")?.textContent).toContain("2h 00m");
    expect(rowLabels(container)).toEqual(["Deep work", "Inbox"]);
    await act(async () => root?.unmount());
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
