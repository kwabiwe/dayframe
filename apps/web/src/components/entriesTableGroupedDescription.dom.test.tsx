// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("EntriesTable grouped-description editing", () => {
  beforeEach(() => {
    mocks.clientFetch.mockReset().mockResolvedValue(okResponse());
    mocks.refresh.mockReset();
    mocks.runtime.clearTimerError.mockReset();
    mocks.runtime.startEntryAgain.mockReset().mockResolvedValue({ ok: true });
    mocks.runtime.updateActiveEntryFromCalendar.mockReset().mockResolvedValue({ ok: true });
    mocks.runtime.isTimerBusy = false;
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

  it("sends every grouped ID once and optimistically merges matching rows", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderTable({
      entries: [entry("entry-a"), entry("entry-b"), entry("entry-c", "Planning")],
      onChanged
    });
    const input = sharedDescription("Uncategorized", 2);

    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "  Planning  {Enter}");

    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalledOnce());
    expect(mocks.clientFetch).toHaveBeenCalledWith("/api/time-entries/batch-description", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["entry-a", "entry-b"], description: "Planning" })
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    const merged = sharedDescription("Planning", 3);
    await waitFor(() => expect(document.activeElement).toBe(merged));
    expect(screen.getByRole("button", { name: "Expand 3 Planning entries" })).not.toBeNull();
    expect(screen.queryByLabelText(/Uncategorized shared description/)).toBeNull();
  });

  it("enters from F2, cancels with Escape, and saves the restored field on blur", async () => {
    renderTable({ entries: [entry("entry-a"), entry("entry-b")] });
    const input = sharedDescription("Uncategorized", 2);

    input.focus();
    fireEvent.keyDown(input, { key: "F2" });
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: "Draft to cancel" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("Uncategorized");
    expect(mocks.clientFetch).not.toHaveBeenCalled();

    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "Blurred update");
    fireEvent.blur(input, { relatedTarget: document.body });

    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.clientFetch.mock.calls[0][1].body)).toEqual({
      ids: ["entry-a", "entry-b"],
      description: "Blurred update"
    });
  });

  it("retains and refocuses a failed draft, then retries the same batch", async () => {
    mocks.clientFetch
      .mockResolvedValueOnce(errorResponse("The grouped update was rejected."))
      .mockResolvedValueOnce(okResponse());
    renderTable({ entries: [entry("entry-a"), entry("entry-b")] });
    const input = sharedDescription("Uncategorized", 2);

    await userEvent.dblClick(input);
    await userEvent.clear(input);
    await userEvent.type(input, "Keep this draft{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("The grouped update was rejected.");
    expect(input.value).toBe("Keep this draft");
    expect(input.readOnly).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(mocks.clientFetch).toHaveBeenCalledOnce();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.clientFetch).toHaveBeenCalledTimes(2));
    for (const call of mocks.clientFetch.mock.calls) {
      expect(JSON.parse(call[1].body)).toEqual({
        ids: ["entry-a", "entry-b"],
        description: "Keep this draft"
      });
    }
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

function sharedDescription(description: string, count: number) {
  return screen.getByLabelText(
    `${description} shared description for ${count} grouped entries. Click to edit all occurrences.`
  ) as HTMLInputElement;
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

function errorResponse(error: string) {
  return {
    json: vi.fn().mockResolvedValue({ error }),
    ok: false,
    status: 409
  } as unknown as Response;
}
