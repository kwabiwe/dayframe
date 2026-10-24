// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ clearTimerError: vi.fn(), isTimerBusy: false, startEntryAgain: vi.fn(), updateActiveEntryFromCalendar: vi.fn() })
}));

vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn() }));

const { EntriesTable } = await import("./EntriesTable");

describe("Calendar › List rows (Calendar v3, owner choice A, 24 Oct 2026)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    });
  });
  afterEach(() => cleanup());

  it("leads with Today's block mark sized by length, then the place, trip or tags line, and stacks start over end", () => {
    render(
      <EntriesTable
        capturedNow={new Date("2026-08-11T20:00:00.000Z")}
        categories={[]}
        entries={[
          entry("a", "Library hour", { placeName: "Exampleton Library", minutes: 15 }),
          entry("b", "Train home", { placeName: "Exampleton Station", automaticMoveEventId: "move", minutes: 60 }),
          entry("c", "Planning", { tagNames: ["planning"], minutes: 120 }),
          entry("d", "Admin", { minutes: 30 })
        ]}
        groupByDay
        onChanged={vi.fn().mockResolvedValue(undefined)}
        onDeleteEntries={vi.fn()}
        onScroll={vi.fn()}
        scrollContainerRef={vi.fn()}
        tags={[]}
      />
    );
    const row = (title: string) => [...document.querySelectorAll<HTMLElement>(".timeline-list-row")]
      .find((candidate) => candidate.querySelector<HTMLInputElement>(".timeline-inline-description-input")?.value === title)!;
    // Today's mark: its height follows the block's length (blockRowHeight: 22–44 px).
    const markHeight = (title: string) => Number.parseFloat(row(title).querySelector<HTMLElement>(".timeline-task-block")!.style.height);
    expect(markHeight("Library hour")).toBeLessThan(markHeight("Train home"));
    expect(markHeight("Train home")).toBeLessThan(markHeight("Planning"));
    // Never Apple's thin colour bar: the mark is the block with its icon.
    expect(row("Library hour").querySelector(".timeline-task-block svg")).not.toBeNull();
    // The second line: a pin and the place, a route for a trip, a tag and the tags; neither, none (the mock-up).
    const second = (title: string) => row(title).querySelector<HTMLElement>(".timeline-task-secondary-line")!;
    expect(second("Library hour").textContent).toBe("Exampleton Library");
    expect(second("Library hour").querySelector("svg")).not.toBeNull();
    expect(second("Train home").textContent).toBe("Exampleton Station");
    expect(second("Planning").querySelector("svg")).not.toBeNull();
    expect(second("Planning").textContent).toContain("planning");
    expect(row("Admin").querySelector(".timeline-task-secondary-line")).toBeNull();
    // The place is said once (no second place line under the title).
    expect(row("Library hour").textContent?.match(/Exampleton Library/g)).toHaveLength(1);
  });
});

function entry(id: string, description: string, options: {
  placeName?: string; automaticMoveEventId?: string; tagNames?: string[]; minutes: number;
}): TimeEntryRow {
  const offset = id.charCodeAt(0) - "a".charCodeAt(0);
  const startedAt = new Date(Date.UTC(2026, 7, 11, 8 + offset * 3, 0)).toISOString();
  const stoppedAt = new Date(Date.parse(startedAt) + options.minutes * 60_000).toISOString();
  return {
    id, projectId: null, projectName: null, projectColor: null, clientName: null,
    categoryId: null, categoryName: null, categoryColor: null,
    placeId: null, placeName: options.placeName ?? null, automaticMoveEventId: options.automaticMoveEventId ?? null,
    source: "manual_web", confidence: "1", reviewStatus: "accepted", description,
    startedAt, stoppedAt, updatedAt: stoppedAt, durationSeconds: options.minutes * 60,
    tagNames: options.tagNames ?? [], tags: []
  };
}
