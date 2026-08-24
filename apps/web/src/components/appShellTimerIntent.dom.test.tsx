// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-17")
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: mocks.clientFetch
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");
const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => cleanup());

describe("AppShellRuntime latest timer intent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps PersistentTimerBar Start and Quick Action reachable while exact Stop A is in flight", async () => {
    const timerA = entry({ id: "80000000-0000-4000-8000-000000000001", description: "A" });
    const timerB = entry({
      id: "80000000-0000-4000-8000-000000000002",
      categoryId: "focus",
      categoryName: "Focus",
      description: null
    });
    const initial = bootstrap(timerA);
    const final = bootstrap(timerB);
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let releaseStop: (() => void) | undefined;
    const stopPending = new Promise<void>((resolve) => { releaseStop = resolve; });
    let serverData = initial;

    mocks.clientFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const body = typeof options?.body === "string"
        ? JSON.parse(options.body) as Record<string, unknown>
        : undefined;
      requests.push({ url, ...(body ? { body } : {}) });

      if (url === `/api/time-entries/${timerA.id}`) {
        return response({ ok: true, id: timerA.id, updatedAt: "2026-08-17T05:00:01.000Z" });
      }
      if (url === "/api/events") {
        await stopPending;
        serverData = bootstrap(null, [{ ...timerA, stoppedAt: "2026-08-17T05:00:02.000Z" }]);
        return response({ eventId: "stop-a", stopOutcome: "stopped" }, 201);
      }
      if (url === "/api/time-entries") {
        serverData = final;
        return response({ eventId: "start-b", timeEntryId: timerB.id }, 201);
      }
      if (url.startsWith("/api/bootstrap")) return response(serverData);
      if (url === "/api/timer-state") {
        return response({
          activeEntryId: serverData.activeEntry?.id ?? null,
          updatedAt: serverData.activeEntry?.updatedAt ?? null,
          serverNow: "2026-08-17T05:00:03.000Z"
        });
      }
      return response({}, 404);
    });

    render(
      <AppShellRuntimeProvider>
        <PersistentTimerBar />
        <TimerIntentHarness initial={initial} />
      </AppShellRuntimeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Hydrate timer A" }));
    await waitFor(() => expect(screen.getByTestId("active-timer").textContent).toBe("A"));

    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    await waitFor(() => expect(requests.some((request) => request.url === "/api/events")).toBe(true));
    const start = screen.getByRole("button", { name: "Start timer" }) as HTMLButtonElement;
    const quickAction = screen.getByRole("button", { name: /Focus/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(start.getAttribute("aria-busy")).toBeNull();
    expect(quickAction.disabled).toBe(false);

    fireEvent.click(start);
    quickAction.focus();
    await userEvent.keyboard("{Enter}");
    expect(requests.filter((request) => request.url === "/api/time-entries")).toHaveLength(0);

    await act(async () => {
      releaseStop?.();
      await stopPending;
    });
    await waitFor(() => expect(screen.getByTestId("active-timer").textContent).toBe("Focus"));

    const stop = requests.find((request) => request.url === "/api/events");
    expect(requests.some((request) => request.url === `/api/time-entries/${timerA.id}`)).toBe(false);
    expect(stop?.body).toEqual(expect.objectContaining({
      type: "timer_stop",
      clientEventId: `web-timer-stop:${timerA.id}`,
      rawPayload: {
        origin: "web_timer",
        stopScope: "entry",
        targetEntryId: timerA.id
      }
    }));
    const starts = requests.filter((request) => request.url === "/api/time-entries");
    expect(starts).toHaveLength(1);
    expect(starts[0].body).toEqual({ mode: "start", categoryId: "focus", tagNames: [] });
    expect(requests.findIndex((request) => request.url === "/api/events"))
      .toBeLessThan(requests.findIndex((request) => request.url === "/api/time-entries"));
  });
});

function TimerIntentHarness({ initial }: { initial: BootstrapData }) {
  const { data, hydrate } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(initial)}>Hydrate timer A</button>
    <output data-testid="active-timer">
      {data?.activeEntry
        ? data.activeEntry.categoryName ?? data.activeEntry.description ?? "running"
        : "idle"}
    </output>
  </>;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function bootstrap(activeEntry: TimeEntryRow | null, entries = activeEntry ? [activeEntry] : []): BootstrapData {
  return {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "mint", isPinned: true }],
    categoryUsage: [],
    tags: [],
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
    workspace: { id: "workspace", name: "Dayframe" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "A",
    startedAt: "2026-08-17T04:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-17T05:00:00.000Z",
    durationSeconds: 3600,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
