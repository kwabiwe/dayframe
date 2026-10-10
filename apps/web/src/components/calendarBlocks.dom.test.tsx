// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => createElement("a", { href, ...props }, children)
}));

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({
    clearTimerError: vi.fn(),
    createManualEntry: vi.fn(),
    isTimerBusy: false,
    startEntryAgain: vi.fn(),
    updateActiveEntryFromCalendar: vi.fn()
  }),
  useRuntimePageData: (value: unknown) => value
}));

const { CalendarReview } = await import("./TimeReviewViews");

const local = (hour: number, minute = 0) => new Date(2026, 7, 2, hour, minute).toISOString();

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderCalendar(entries: TimeEntryRow[], reviewItems: ReviewItemRow[] = []) {
  return render(createElement(CalendarReview, {
    calendarHoursMode: "fullDay",
    capturedNow: new Date(2026, 7, 2, 12, 0),
    categories: [],
    entries,
    onDeleteEntries: vi.fn(),
    onScroll: vi.fn(),
    onSynced: vi.fn().mockResolvedValue(undefined),
    places: [],
    reviewItems,
    scrollContainerRef: vi.fn(),
    tags: [],
    visibleDays: [new Date(2026, 7, 2, 12, 0, 0, 0)]
  }));
}

describe("Calendar in Blocks", () => {
  it("draws categorised blocks solid, keeps the neutral hatch for no activity and marks the running one", () => {
    renderCalendar([
      entry({ id: "a", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(9), stoppedAt: local(10) }),
      entry({ id: "b", startedAt: local(10), stoppedAt: local(10, 30) }),
      entry({ id: "c", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(11), stoppedAt: null })
    ]);
    const block = (id: string) => document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)!;
    expect(block("a").classList.contains("df-block")).toBe(true);
    expect(block("a").style.getPropertyValue("--block")).toContain("light-dark(");
    expect(block("a").style.color).toBe("var(--on-block)");
    expect(block("b").classList.contains("is-uncategorized")).toBe(true);
    expect(block("b").classList.contains("df-block")).toBe(false);
    expect(block("c").classList.contains("is-running")).toBe(true);
  });

  it("shows a now line on today and open suggestions as Review links in their own lane", () => {
    renderCalendar([], [
      review({ id: "r1", title: "Gym visit", suggestedStartedAt: local(7), suggestedStoppedAt: local(8) }),
      review({ id: "r2", title: "No window", suggestedStartedAt: local(7), suggestedStoppedAt: null })
    ]);
    expect(document.querySelector(".calendar-now-line")).not.toBeNull();
    const links = document.querySelectorAll<HTMLAnchorElement>(".calendar-review-block");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/review");
    expect(links[0].getAttribute("aria-label")).toBe("Gym visit, needs review, 07:00 to 08:00. Open Review.");
  });

  it("labels each day heading with its full date and its logged total", () => {
    renderCalendar([entry({ id: "a", startedAt: local(9), stoppedAt: local(10) })]);
    const heading = document.querySelector(".calendar-day-heading")!;
    expect(heading.querySelector(".calendar-day-date small")?.textContent).toBe("Sun");
    expect(heading.querySelector(".calendar-day-date b")?.textContent).toBe("2");
    expect(heading.querySelector(".calendar-day-total")?.getAttribute("aria-label")).toBe("1h 00m logged");
  });
});

function review(overrides: Partial<ReviewItemRow>): ReviewItemRow {
  return {
    id: "review",
    type: "location",
    title: "Suggestion",
    status: "open",
    suggestedCategoryId: null,
    categoryName: null,
    categoryColor: null,
    suggestedStartedAt: null,
    suggestedStoppedAt: null,
    ...overrides
  } as ReviewItemRow;
}

function entry(overrides: Partial<TimeEntryRow>): TimeEntryRow {
  return {
    id: "entry",
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
    description: "Block",
    startedAt: local(9),
    stoppedAt: local(10),
    updatedAt: local(9),
    durationSeconds: 3600,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
