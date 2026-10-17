// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-17")
}));

// Each bootstrap request waits for the test to hand it a body (`answers`), in request order.
const answers: Array<(body: BootstrapData | null) => void> = [];
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string) => {
    if (!url.startsWith("/api/bootstrap")) return { ok: false, json: async () => ({}) };
    let release: (body: BootstrapData | null) => void = () => undefined;
    const body = new Promise<BootstrapData | null>((resolve) => { release = resolve; });
    answers.push(release);
    return {
      ok: true,
      json: async () => {
        const value = await body;
        if (!value) throw new Error("bad body");
        return value;
      }
    };
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");

afterEach(() => {
  cleanup();
  answers.length = 0;
  document.cookie = "dayframe_tz=; Max-Age=0; Path=/";
});

describe("AppShellRuntime refresh", () => {
  it("never lets an older answer replace a newer one (Codex r6)", async () => {
    render(<AppShellRuntimeProvider><Harness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // first: its body is held
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // second
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.(bootstrap(600)));
    await waitFor(() => expect(screen.getByTestId("goal").textContent).toBe("600"));
    await act(async () => answers[0]?.(bootstrap(540)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    // The older body arrived last: it is dropped.
    expect(screen.getByTestId("goal").textContent).toBe("600");
  });

  it("records every server copy of the goals in the tab's goal record, Settings open or not (Codex r10)", async () => {
    const { goalDrafts, __resetGoalDraftsForTests } = await import("@/lib/goal-stepper");
    __resetGoalDraftsForTests();
    render(<AppShellRuntimeProvider><Harness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers[0]?.(bootstrap(720, 3)));
    await waitFor(() => expect(screen.getByTestId("goal").textContent).toBe("720"));
    await waitFor(() => expect(goalDrafts.get("user-1").known).toEqual({ dailyGoalMinutes: 720, weeklyGoalMinutes: 2400, goalsRevision: 3 }));
    // Older server-rendered data afterwards never replaces it.
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    expect(goalDrafts.get("user-1").known?.goalsRevision).toBe(3);
  });
});

describe("AppShellRuntime and the viewer's zone (Codex r2 on #484)", () => {
  it("never lets page props drawn for no zone replace data built for the browser's zone", async () => {
    document.cookie = "dayframe_tz=Europe/London; Path=/";
    render(<AppShellRuntimeProvider><ZoneHarness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate London" }));
    await waitFor(() => expect(screen.getByTestId("zone").textContent).toBe("Europe/London"));
    const requests = answers.length;
    fireEvent.click(screen.getByRole("button", { name: "Hydrate no zone" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByTestId("zone").textContent).toBe("Europe/London");
    expect(answers).toHaveLength(requests);
  });

  it("shows such props when nothing better is there, then fetches the zoned copy", async () => {
    document.cookie = "dayframe_tz=Europe/London; Path=/";
    render(<AppShellRuntimeProvider><ZoneHarness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate no zone" }));
    await waitFor(() => expect(screen.getByTestId("date").textContent).toBe("2026-08-17"));
    await waitFor(() => expect(answers.length).toBeGreaterThan(0));
    await act(async () => answers.at(-1)?.(bootstrap(480, 1, "Europe/London")));
    await waitFor(() => expect(screen.getByTestId("zone").textContent).toBe("Europe/London"));
  });
});

function ZoneHarness() {
  const { data, hydrate } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(bootstrap(480, 1, null))}>Hydrate no zone</button>
    <button onClick={() => hydrate(bootstrap(480, 1, "Europe/London"))}>Hydrate London</button>
    <output data-testid="date">{data?.dateRange.selectedDate ?? ""}</output>
    <output data-testid="zone">{data?.viewerTimeZone ?? ""}</output>
  </>;
}

function Harness() {
  const { data, hydrate, refresh } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(bootstrap(480))}>Hydrate</button>
    <button onClick={() => void refresh({ force: true })}>Refresh</button>
    <output data-testid="goal">{data?.user.dailyGoalMinutes ?? ""}</output>
  </>;
}

function bootstrap(dailyGoalMinutes: number, goalsRevision = 1, viewerTimeZone: string | null = null): BootstrapData {
  return {
    viewerTimeZone,
    activeEntry: null,
    categories: [],
    tags: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    dateRange: { selectedDate: "2026-08-17", dayStart: "2026-08-17T00:00:00.000Z", dayEnd: "2026-08-18T00:00:00.000Z", weekStart: "2026-08-17T00:00:00.000Z", weekEnd: "2026-08-24T00:00:00.000Z" },
    user: { id: "user-1", dailyGoalMinutes, weeklyGoalMinutes: 2400, goalsRevision },
    workspace: { id: "workspace-1", name: "Mine" }
  } as unknown as BootstrapData;
}
