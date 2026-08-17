// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("date=2026-08-17")
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: vi.fn(async (url: string) => {
    if (url === "/api/timer-state") {
      return {
        ok: true,
        json: async () => ({ activeEntryId: "active", updatedAt: "2026-08-17T05:00:00.000Z" })
      };
    }
    return { ok: false, json: async () => ({}) };
  })
}));

const { AppShellRuntimeProvider, useAppShellRuntime } = await import("./AppShellRuntime");

afterEach(() => cleanup());

describe("AppShellRuntime timer draft reconciliation", () => {
  it("preserves newer typing while accepting untouched category and tag changes", async () => {
    const initial = bootstrap(entry({
      categoryId: "work",
      description: "TY1",
      tagNames: ["local"],
      updatedAt: "2026-08-17T05:00:00.000Z"
    }));
    const remote = bootstrap(entry({
      categoryId: "focus",
      description: "TY1",
      tagNames: ["remote"],
      updatedAt: "2026-08-17T05:01:00.000Z"
    }));

    render(<AppShellRuntimeProvider><Harness initial={initial} remote={remote} /></AppShellRuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hydrate initial" }));
    await waitFor(() => expect(screen.getByTestId("draft").textContent).toBe("work|TY1|local"));

    fireEvent.click(screen.getByRole("button", { name: "Type description" }));
    expect(screen.getByTestId("draft").textContent).toBe("work|TY1 VPN|local");

    fireEvent.click(screen.getByRole("button", { name: "Hydrate remote" }));
    await waitFor(() => expect(screen.getByTestId("draft").textContent).toBe("focus|TY1 VPN|remote"));
  });

});

function Harness({ initial, remote }: { initial: BootstrapData; remote: BootstrapData }) {
  const { hydrate, setTimerDraft, timerDraft } = useAppShellRuntime();
  return <>
    <button onClick={() => hydrate(initial)}>Hydrate initial</button>
    <button onClick={() => setTimerDraft((current) => ({ ...current, description: "TY1 VPN" }))}>
      Type description
    </button>
    <button onClick={() => hydrate(remote)}>Hydrate remote</button>
    <output data-testid="draft">
      {timerDraft.categoryId}|{timerDraft.description}|{timerDraft.tagNames.join(",")}
    </output>
  </>;
}

function bootstrap(activeEntry: TimeEntryRow): BootstrapData {
  return {
    activeEntry,
    categories: [],
    tags: [],
    entries: [activeEntry],
    historyEntries: [activeEntry],
    dayEntries: [activeEntry],
    weekEntries: [activeEntry],
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

function entry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "active",
    categoryId: "work",
    categoryName: "Work",
    categoryColor: "blue",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "TY1",
    startedAt: "2026-08-17T04:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-08-17T05:00:00.000Z",
    durationSeconds: 3600,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
