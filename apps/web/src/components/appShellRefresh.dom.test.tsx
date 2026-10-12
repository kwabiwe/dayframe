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
  it("never lets an older answer replace a newer one (Codex r6)", async () => {
    render(<AppShellRuntimeProvider><Harness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // first: its body is held
    fireEvent.click(screen.getByRole("button", { name: "Refresh" })); // second
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.(bootstrap(600)));
    await waitFor(() => expect(screen.getByTestId("goal").textContent).toBe("600"));
    const readAt = Number(screen.getByTestId("read-at").textContent);
    expect(readAt).toBeGreaterThan(0);
    await act(async () => answers[0]?.(bootstrap(540)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    // The older body arrived last: it is dropped.
    expect(screen.getByTestId("goal").textContent).toBe("600");
    expect(Number(screen.getByTestId("read-at").textContent)).toBe(readAt);
  });

  it("moves the read time only for a load from the server, never for a failure or hydration (Codex r7)", async () => {
    render(<AppShellRuntimeProvider><Harness /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate" }));
    expect(screen.getByTestId("read-at").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => answers[0]?.(null));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByTestId("read-at").textContent).toBe("0");
    expect(screen.getByTestId("goal").textContent).toBe("480");
  });
});

function Harness() {
  const { data, dataReadAt, hydrate, refresh } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(bootstrap(480))}>Hydrate</button>
    <button onClick={() => void refresh({ force: true })}>Refresh</button>
    <output data-testid="goal">{data?.user.dailyGoalMinutes ?? ""}</output>
    <output data-testid="read-at">{dataReadAt}</output>
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
