// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryRow } from "@/lib/queries";

const mocks = vi.hoisted(() => ({
  clientFetch: vi.fn(),
  refresh: vi.fn(),
  runtime: {
    clearTimerError: vi.fn(),
    isTimerBusy: false,
    startEntryAgain: vi.fn(),
    updateActiveEntryFromCalendar: vi.fn()
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => mocks.runtime
}));

vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: mocks.clientFetch
}));

const { EntriesTable } = await import("./EntriesTable");

describe("EntriesTable typed times in 12-hour mode (Codex r2 on #446)", () => {
  beforeEach(() => {
    window.localStorage.setItem("dayframe.clockFormat", "12h");
    mocks.clientFetch.mockReset().mockResolvedValue(okResponse());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it.each(["10:15 PM", "1015pm"])("saves %s typed key by key into Finish as 22:15", async (typed) => {
    const user = userEvent.setup();
    renderTable({ entries: [entry("entry-a", "Planning")] });
    const finish = screen.getByLabelText("Finish time for Planning") as HTMLInputElement;
    expect(finish.value).toMatch(/ (AM|PM)$/);
    await user.click(finish);
    await user.clear(finish);
    await user.type(finish, typed);
    expect(finish.value).toBe(typed === "1015pm" ? "10:15 PM" : typed);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalled());
    const body = JSON.parse(String(mocks.clientFetch.mock.calls[0][1].body));
    const saved = new Date(body.stoppedAt);
    expect([saved.getHours(), saved.getMinutes()]).toEqual([22, 15]);
  });

  it("clears a typed 12-hour time with Backspace, never re-adding AM", async () => {
    const user = userEvent.setup();
    renderTable({ entries: [entry("entry-a", "Planning")] });
    const finish = screen.getByLabelText("Finish time for Planning") as HTMLInputElement;
    await user.click(finish);
    await user.clear(finish);
    await user.type(finish, "8:15 pm");
    for (let index = 0; index < 12; index += 1) await user.keyboard("{Backspace}");
    expect(finish.value).toBe("");
  });
});

function renderTable({
  entries,
  onChanged = vi.fn().mockResolvedValue(undefined)
}: {
  entries: TimeEntryRow[];
  onChanged?: () => Promise<void>;
}) {
  return render(
    <EntriesTable
      capturedNow={new Date("2026-08-11T12:00:00.000Z")}
      categories={[]}
      entries={entries}
      groupByDay
      onChanged={onChanged}
      onDeleteEntries={vi.fn()}
      onScroll={vi.fn()}
      scrollContainerRef={vi.fn()}
      tags={[]}
    />
  );
}

function entry(id: string, description: string | null = null): TimeEntryRow {
  const offset = id.charCodeAt(id.length - 1) - "a".charCodeAt(0);
  const startedAt = new Date(Date.UTC(2026, 7, 11, 8 + offset, 0)).toISOString();
  const stoppedAt = new Date(Date.UTC(2026, 7, 11, 8 + offset, 30)).toISOString();
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    placeId: null,
    placeName: null,
    source: "manual_web",
    confidence: "1",
    reviewStatus: "accepted",
    description,
    startedAt,
    stoppedAt,
    updatedAt: stoppedAt,
    durationSeconds: 1_800,
    tagNames: [],
    tags: []
  };
}

function okResponse() {
  return {
    json: vi.fn().mockResolvedValue({ ok: true, ids: ["entry-a", "entry-b"], updatedCount: 2 }),
    ok: true,
    status: 200
  } as unknown as Response;
}

