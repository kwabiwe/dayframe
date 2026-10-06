// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-17")
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async () => new Response("{}", { status: 404 }))
}));

const { AppShellRuntimeProvider } = await import("./AppShellRuntime");
const { DashboardRealtime } = await import("./DashboardRealtime");

const renderedAt = "2026-08-17T05:00:00.250Z";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("DashboardRealtime hydration", () => {
  it("hydrates a running timer's allocation without a server/client mismatch", async () => {
    const data = bootstrap(entry());
    const tree = (
      <AppShellRuntimeProvider>
        <DashboardRealtime initialData={data} renderedAt={renderedAt} />
      </AppShellRuntimeProvider>
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(renderedAt));
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);

    // The browser hydrates several seconds after the server rendered.
    vi.setSystemTime(new Date(Date.parse(renderedAt) + 7_000));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => recoverable.push(error) });
    });

    // React 19 reports hydration mismatches through onRecoverableError; the console check is a backstop.
    const logged = consoleError.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toMatch(/hydrat/i);
    expect(recoverable).toEqual([]);

    await act(async () => root?.unmount());
  });

  it("moves to live time once hydrated", async () => {
    const data = bootstrap(entry());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(renderedAt) + 30 * 60_000));
    const container = document.createElement("div");
    document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AppShellRuntimeProvider>
          <DashboardRealtime initialData={data} renderedAt={renderedAt} />
        </AppShellRuntimeProvider>
      );
    });

    // Started 04:00, live at 05:30: 2h 30m logged rather than the 2h 00m seen at render time.
    expect(container.textContent).toContain("2h 30m");
    await act(async () => root.unmount());
  });
});

function bootstrap(activeEntry: TimeEntryRow | null): BootstrapData {
  const finished = entry({
    id: "80000000-0000-4000-8000-000000000002",
    categoryId: "admin",
    categoryName: "Admin",
    categoryColor: "steel",
    description: "Inbox",
    startedAt: "2026-08-17T02:00:00.000Z",
    stoppedAt: "2026-08-17T03:00:00.000Z",
    durationSeconds: 3600
  });
  const entries = activeEntry ? [finished, activeEntry] : [finished];
  return {
    activeEntry,
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
      dayStart: "2026-08-17T00:00:00.000Z",
      dayEnd: "2026-08-18T00:00:00.000Z",
      weekStart: "2026-08-17T00:00:00.000Z",
      weekEnd: "2026-08-24T00:00:00.000Z"
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
    startedAt: "2026-08-17T04:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-17T04:00:00.000Z",
    durationSeconds: 0,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
