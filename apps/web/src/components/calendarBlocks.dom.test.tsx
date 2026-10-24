// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
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
  vi.restoreAllMocks();
});

/** The compact editor closes when its anchor looks off screen, so give the grid real boxes. */
function installEditorGeometry() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  for (const name of ["setPointerCapture", "releasePointerCapture"] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: () => undefined });
  }
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  const box = (x: number, y: number, width: number, height: number) =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
    if (this.classList.contains("calendar-grid-scroller")) return box(0, 0, 1_000, 850);
    if (this.matches("[data-calendar-day-body]")) return box(104, 0, 800, 1_536);
    if (this.matches("[data-calendar-block-key]")) return box(120, 400, 760, 60);
    if (this.classList.contains("calendar-compact-editor")) return box(12, 12, 360, 320);
    return box(0, 0, 100, 44);
  });
}

function renderCalendar(entries: TimeEntryRow[], reviewItems: ReviewItemRow[] = [], day = new Date(2026, 7, 2, 12, 0, 0, 0)) {
  return render(calendarElement(entries, reviewItems, day));
}

function calendarElement(entries: TimeEntryRow[], reviewItems: ReviewItemRow[], day: Date) {
  return createElement(CalendarReview, {
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
    visibleDays: [day]
  });
}

describe("Calendar in Blocks", () => {
  it("draws categorised blocks tinted with their colour bar, keeps the neutral hatch for no activity and marks the running one (dense-day rules)", () => {
    renderCalendar([
      entry({ id: "a", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(9), stoppedAt: local(10) }),
      entry({ id: "b", startedAt: local(10), stoppedAt: local(10, 30) }),
      entry({ id: "c", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(11), stoppedAt: null })
    ]);
    const block = (id: string) => document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)!;
    expect(block("a").classList.contains("df-block")).toBe(false);
    expect(block("a").style.getPropertyValue("--block")).toContain("light-dark(");
    expect(block("a").style.getPropertyValue("--calendar-block-accent")).toBe("var(--block)");
    expect(block("a").style.color).toBe("var(--text-primary)");
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
    expect(links[0].getAttribute("href")).toBe("/review#review-r1");
    expect(links[0].getAttribute("aria-label")).toBe("Gym visit, needs review, 07:00 to 08:00. Open Review.");
  });

  it("lets a press an open editor takes only dismiss it, never also open Review", async () => {
    installEditorGeometry();
    renderCalendar(
      [entry({ id: "a", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(9), stoppedAt: local(10) })],
      [review({ id: "r1", title: "Gym visit", suggestedStartedAt: local(7), suggestedStoppedAt: local(8) })]
    );
    const link = document.querySelector<HTMLAnchorElement>(".calendar-review-block")!;
    const navigations: boolean[] = [];
    const record = (event: MouseEvent) => {
      if (event.target !== link) return;
      navigations.push(!event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    const press = (pointerId: number) => {
      for (const type of ["pointerdown", "pointerup"]) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, "pointerId", { value: pointerId });
        link.dispatchEvent(event);
      }
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    };

    press(1);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-entry-id="a"] .calendar-entry-primary')!.click();
    });
    // The editor starts listening for outside presses on the next task.
    for (let index = 0; index < 5; index += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(document.querySelector('[data-testid="calendar-compact-editor"]')).not.toBeNull();
    await act(async () => press(2));
    window.removeEventListener("click", record);
    expect(navigations).toEqual([true, false]);
  });

  it("keeps suggestions out of the tab order and inert to Enter while an editor is open", async () => {
    installEditorGeometry();
    renderCalendar(
      [entry({ id: "a", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(9), stoppedAt: local(10) })],
      [review({ id: "r1", title: "Gym visit", suggestedStartedAt: local(7), suggestedStoppedAt: local(8) })]
    );
    const link = document.querySelector<HTMLAnchorElement>(".calendar-review-block")!;
    expect(link.getAttribute("tabindex")).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-entry-id="a"] .calendar-entry-primary')!.click();
    });
    expect(link.getAttribute("tabindex")).toBe("-1");
    // A keyboard activation is a click with detail 0.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("lets Enter open Review again once a period change has hidden the editor", async () => {
    installEditorGeometry();
    const entries = [
      entry({ id: "a", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", startedAt: local(9), stoppedAt: local(10) }),
      entry({ id: "n", startedAt: new Date(2026, 7, 1, 9).toISOString(), stoppedAt: new Date(2026, 7, 1, 10).toISOString() })
    ];
    const reviews = [
      review({ id: "r1", title: "Gym visit", suggestedStartedAt: local(7), suggestedStoppedAt: local(8) }),
      review({ id: "r2", title: "Walk", suggestedStartedAt: new Date(2026, 7, 1, 7).toISOString(), suggestedStoppedAt: new Date(2026, 7, 1, 8).toISOString() })
    ];
    const view = renderCalendar(entries, reviews);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-entry-id="a"] .calendar-entry-primary')!.click();
    });
    view.rerender(calendarElement(entries, reviews, new Date(2026, 7, 1, 12, 0, 0, 0)));
    const link = document.querySelector<HTMLAnchorElement>(".calendar-review-block")!;
    expect(link.getAttribute("tabindex")).toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    // Note whether Calendar cancelled it, then stop jsdom's own navigation.
    let cancelledByCalendar: boolean | null = null;
    const record = (event: MouseEvent) => {
      cancelledByCalendar = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", record);
    link.dispatchEvent(click);
    window.removeEventListener("click", record);
    expect(cancelledByCalendar).toBe(false);
  });

  it("labels each day heading with its full date and its logged total", () => {
    renderCalendar([entry({ id: "a", startedAt: local(9), stoppedAt: local(10) })]);
    const heading = document.querySelector(".calendar-day-heading")!;
    expect(heading.querySelector(".calendar-day-date small")?.textContent).toBe("Sun");
    expect(heading.querySelector(".calendar-day-date b")?.textContent).toBe("2");
    expect(heading.querySelector(".calendar-day-total")?.getAttribute("aria-label")).toBe("1h logged");
  });
});

describe("Calendar brackets for named patterns (location v3 PR 14b)", () => {
  const schoolRun = { key: "trip-1", name: "School run", parts: 3 };
  const part = (id: string, from: [number, number], to: [number, number], overrides: Partial<TimeEntryRow> = {}) => entry({
    id,
    description: id,
    source: "location_learning",
    startedAt: local(...from),
    stoppedAt: local(...to),
    locationGroup: schoolRun,
    ...overrides
  });
  // Parts at least 18 px tall at 64 px an hour, so none is lifted into an overlap lane by its minimum height.
  const trip = () => [part("there", [8, 0], [8, 20]), part("stay", [8, 20], [9, 0]), part("back", [9, 0], [9, 20])];
  const label = (id: string) => document.querySelector(`[data-entry-id="${id}"] .calendar-entry-primary`)!.getAttribute("aria-label");
  const left = (id: string) => document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)!.style.left;

  it("draws one decorative bracket with the name from the first part's start to the last part's end", () => {
    renderCalendar([...trip(), entry({ id: "work", startedAt: local(10), stoppedAt: local(12) })]);
    const brackets = document.querySelectorAll<HTMLElement>(".df-cal-bracket");
    expect(brackets).toHaveLength(1);
    const bracket = brackets[0];
    expect(bracket.dataset.calendarBracket).toBe("named:trip-1");
    expect(bracket.getAttribute("aria-hidden")).toBe("true");
    // The blocks' own maths at 64 px an hour: 08:00 is 512 px down and 80 minutes is 85 px.
    expect(bracket.style.top).toBe("512px");
    expect(bracket.style.height).toBe("85px");
    expect(bracket.textContent).toBe("School run");
    expect(bracket.querySelector("button, a, [tabindex]")).toBeNull();
    // The parts stay three separate blocks; the whole day moves right of the bracket's rail, which in Day view
    // is wide enough for the name written level (dense-day rules).
    expect(document.querySelectorAll(".calendar-time-block")).toHaveLength(4);
    for (const id of ["there", "stay", "back", "work"]) expect(left(id)).toBe("52px");
  });

  it("names each part's place in the trip once, on its own block", () => {
    renderCalendar([...trip(), entry({ id: "work", startedAt: local(10), stoppedAt: local(12) })]);
    expect(label("there")).toContain("Part 1 of 3 of School run.");
    expect(label("stay")).toContain("Part 2 of 3 of School run.");
    expect(label("back")).toContain("Part 3 of 3 of School run.");
    expect(label("work")).not.toContain("School run");
  });

  it("draws nothing while a part is missing or a block sits between the parts", () => {
    const [there, stay] = trip();
    renderCalendar([there, stay]);
    expect(document.querySelector(".df-cal-bracket")).toBeNull();
    expect(left("there")).toBe("8px");
    expect(label("there")).not.toContain("Part");
    cleanup();
    renderCalendar([...trip(), entry({ id: "coffee", startedAt: local(8, 25), stoppedAt: local(8, 50) })]);
    expect(document.querySelector(".df-cal-bracket")).toBeNull();
  });

  it("goes with its parts: a deleted part removes it and Undo brings it back", () => {
    const view = renderCalendar(trip());
    expect(document.querySelectorAll(".df-cal-bracket")).toHaveLength(1);
    view.rerender(calendarElement(trip().filter((block) => block.id !== "stay"), [], new Date(2026, 7, 2, 12, 0, 0, 0)));
    expect(document.querySelector(".df-cal-bracket")).toBeNull();
    expect(left("there")).toBe("8px");
    view.rerender(calendarElement(trip(), [], new Date(2026, 7, 2, 12, 0, 0, 0)));
    expect(document.querySelectorAll(".df-cal-bracket")).toHaveLength(1);
  });

  it("keeps the bracket beside the blocks in overlap lanes", () => {
    renderCalendar([entry({ id: "long", startedAt: local(7, 30), stoppedAt: local(8, 30) }), ...trip()]);
    expect(document.querySelectorAll(".df-cal-bracket")).toHaveLength(1);
    // The first lane starts right of the rail; the second shares what is left of the column.
    expect(left("long")).toBe("52px");
    expect(left("there")).toContain("(100% - 44px)");
    expect(left("there")).toContain("45px");
  });

  it("draws no bracket for a trip across midnight, on either day", () => {
    const night = (id: string, from: Date, to: Date) => entry({
      id, source: "location_learning", startedAt: from.toISOString(), stoppedAt: to.toISOString(), locationGroup: schoolRun
    });
    const late = [
      night("there", new Date(2026, 7, 1, 23, 40), new Date(2026, 7, 1, 23, 50)),
      night("stay", new Date(2026, 7, 1, 23, 50), new Date(2026, 7, 2, 0, 20)),
      night("back", new Date(2026, 7, 2, 0, 20), new Date(2026, 7, 2, 0, 30))
    ];
    renderCalendar(late);
    expect(document.querySelector(".df-cal-bracket")).toBeNull();
    cleanup();
    renderCalendar(late, [], new Date(2026, 7, 1, 12, 0, 0, 0));
    expect(document.querySelector(".df-cal-bracket")).toBeNull();
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
