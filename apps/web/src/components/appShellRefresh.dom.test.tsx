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
});

describe("AppShellRuntime refresh", () => {
  it("never lets an older answer replace a newer one, and says which loads were fresh (Codex r6)", async () => {
    const results: Array<BootstrapData | null> = [];
    render(<AppShellRuntimeProvider><Harness results={results} /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // first: its body is held
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // second
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.(bootstrap(600)));
    await waitFor(() => expect(screen.getByTestId("goal").textContent).toBe("600"));
    await act(async () => answers[0]?.(bootstrap(540)));
    await waitFor(() => expect(results).toHaveLength(2));
    // The older body arrived last: it is dropped, and reported as not fresh.
    expect(screen.getByTestId("goal").textContent).toBe("600");
    expect(results.map((result) => result?.user.dailyGoalMinutes ?? null).sort()).toEqual([600, null].sort());
  });

  it("reports a failed load as not fresh, and as the data shown without freshOnly", async () => {
    const results: Array<BootstrapData | null> = [];
    render(<AppShellRuntimeProvider><Harness results={results} /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers[0]?.(null));
    await waitFor(() => expect(results).toEqual([null]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh shown" }));
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.(null));
    await waitFor(() => expect(results[1]?.user.dailyGoalMinutes).toBe(480));
  });
});

function Harness({ results }: { results: Array<BootstrapData | null> }) {
  const { data, hydrate, refresh } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(bootstrap(480))}>Hydrate</button>
    <button onClick={() => void refresh({ force: true, freshOnly: true }).then((result) => { results.push(result); })}>Refresh</button>
    <button onClick={() => void refresh({ force: true }).then((result) => { results.push(result); })}>Refresh shown</button>
    <output data-testid="goal">{data?.user.dailyGoalMinutes ?? ""}</output>
  </>;
}

function bootstrap(dailyGoalMinutes: number): BootstrapData {
  return {
    activeEntry: null,
    categories: [],
    tags: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    dateRange: { selectedDate: "2026-08-17", dayStart: "2026-08-17T00:00:00.000Z", dayEnd: "2026-08-18T00:00:00.000Z", weekStart: "2026-08-17T00:00:00.000Z", weekEnd: "2026-08-24T00:00:00.000Z" },
    user: { id: "user-1", dailyGoalMinutes, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace-1", name: "Mine" }
  } as unknown as BootstrapData;
}
