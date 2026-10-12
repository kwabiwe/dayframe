// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";
import { DONUT_GAP, donutArcs, reportBlocksModel } from "@/lib/reports-blocks";

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportsBlocksPanel, traceBlockAt, traceDayAt } = await import("./ReportsBlocksPanel");

const at = (date: number, hour = 0) => new Date(2026, 9, date, hour).toISOString();
// Day keys are calendar dates: the model reads day numbers and the month grid's blanks from them.
const day = (date: number) => ({ key: `2026-10-${`${date}`.padStart(2, "0")}`, label: `Day ${date}`, start: at(date), end: at(date + 1) });

function report(preset = "this-week", secondDay = false, dayCount = 7, fillDay6 = false): ReportResult {
  const days = Array.from({ length: dayCount }, (_, index) => day(5 + index));
  return {
    range: { preset, dayCount },
    capturedNow: at(6, 12),
    byCategory: [
      { id: "work", name: "Work", color: "blue", seconds: 9 * 3600, entryCount: 3 },
      { id: "uncategorized", name: "No activity", color: null, seconds: 3600, entryCount: 1 }
    ],
    dailySeries: days.map((entry, index) => ({ key: entry.key, label: entry.label, seconds: index === 0 ? 10 * 3600 : 0, coveredSeconds: index === 0 ? 9 * 3600 : 0, additionalOverlappingActivitySeconds: 0 })),
    dailyByActivity: days.map((entry, index) => ({
      ...entry,
      activities: index === 0
        ? [{ id: "work", seconds: 9 * 3600 }, { id: "uncategorized", seconds: 3600 }]
        : index === 2 && secondDay ? [{ id: "uncategorized", seconds: 1800 }, { id: "work", seconds: 2 * 3600 }]
          : index === 1 && fillDay6 ? [{ id: "work", seconds: 3600 }] : []
    }))
  } as unknown as ReportResult;
}

const slices = [
  { id: "work", categoryIds: ["work"], name: "Work", color: "blue", seconds: 9 * 3600, percentage: 90, isUncategorized: false, href: "/reports?categories=work" },
  { id: "uncategorized", categoryIds: ["uncategorized"], name: "No activity", color: null, seconds: 3600, percentage: 10, isUncategorized: true, href: "/reports?categories=uncategorized" }
];
const land = { easing: "ease-out", durationMs: 300 };

/**
 * jsdom has no layout: give each day a 44 px wide, 200 px tall box 50 px apart, and each block a
 * 3 px sliver stacked up from the day's bottom 10 px apart, as small as the month grid's blocks.
 */
function layOut(container: HTMLElement) {
  const box = (left: number, top: number, width: number, height: number) => () =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  container.querySelectorAll<HTMLElement>("[data-trace-day]").forEach((day, dayIndex) => {
    Object.defineProperty(day, "getBoundingClientRect", { configurable: true, value: box(dayIndex * 50, 0, 44, 200) });
    day.querySelectorAll<HTMLElement>("[data-block-key]").forEach((block, blockIndex) => {
      Object.defineProperty(block, "getBoundingClientRect", { configurable: true, value: box(dayIndex * 50, 197 - blockIndex * 10, 44, 3) });
    });
  });
}

/** A pointer event React sees, with its pointer type (jsdom has no PointerEvent). */
function pointer(target: EventTarget, type: string, x: number, y: number, pointerType = "mouse", relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return act(async () => {
    target.dispatchEvent(event);
  });
}

async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  layOut(container);
  return {
    container,
    root,
    centre: () => container.querySelector(".df-donut-center")?.textContent,
    hotKeys: () => [...container.querySelectorAll(".df-tblock.is-hot")].map((block) => block.getAttribute("aria-label")),
    rerender: async (next: React.ReactElement) => {
      await act(async () => root.render(next));
      layOut(container);
    }
  };
}

const week = (secondDay = true, current = slices) => (
  <ReportsBlocksPanel blocks={reportBlocksModel(report("this-week", secondDay), formatDuration)} land={land} slices={current} totalLabel="logged this week" totalSeconds={10 * 3600} />
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Reports blocks and Where it went", () => {
  it("draws a week as one column per day, each named with its activities", () => {
    const html = renderToStaticMarkup(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    );
    expect((html.match(/class="df-wb[ "]/g) ?? []).length).toBe(7);
    expect(html).toContain('aria-label="Day 5: 10h logged, Work 9h, No activity 1h"');
    expect(html).toContain("The days in blocks");
    // UIA-306: a short label for narrow columns and tap wording for coarse pointers.
    expect(html).toContain('<span class="df-wb-label-short">Day 5</span>');
    expect(html).toContain("Tap a day, then an activity, to trace it");
    expect(html).toContain("Where it went");
  });

  it("draws a month with day numbers worked out with the report (no browser re-derivation)", () => {
    const model = reportBlocksModel(report("this-month"), formatDuration)!;
    expect(model.layout).toBe("month");
    // 5 Oct 2026 is a Monday: no blank cells before it.
    expect(model.leadingBlanks).toBe(0);
    expect(model.days.map((entry) => entry.dateNumber)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    const html = renderToStaticMarkup(<ReportsBlocksPanel blocks={model} land={land} slices={slices} totalLabel="logged this month" totalSeconds={10 * 3600} />);
    expect(html).toContain("The month in blocks");
    expect(html).toContain('aria-label="Day 5: 10h logged, Work 9h, No activity 1h"');
  });

  it("highlights an activity's blocks and shows its time in the centre while its row is hovered or focused", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    ));
    const row = container.querySelector<HTMLAnchorElement>('a[aria-label^="Filter by Work"]')!;
    expect(row.getAttribute("href")).toBe("/reports?categories=work");
    await act(async () => row.focus());
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(true);
    expect([...container.querySelectorAll(".df-wb-stack .is-hot")].map((block) => block.getAttribute("data-key"))).toEqual(["work"]);
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("9hWork");
    await act(async () => row.blur());
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("10hlogged this week");
    await act(async () => root.unmount());
  });

  it("traces an activity from the row under the pointer as well as from focus", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    ));
    const row = container.querySelector<HTMLAnchorElement>('a[aria-label^="Filter by No activity"]')!;
    await act(async () => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    expect([...container.querySelectorAll(".df-wb-stack .is-hot")].map((block) => block.getAttribute("data-key"))).toEqual(["uncategorized"]);
    expect(container.querySelector(".df-donut")?.classList.contains("has-hot")).toBe(true);
    expect(container.querySelector('circle[aria-label^="Filter by No activity"]')?.classList.contains("is-hot")).toBe(true);
    expect(row.classList.contains("is-hot")).toBe(true);
    await act(async () => row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(container.querySelector(".df-donut")?.classList.contains("has-hot")).toBe(false);
    await act(async () => root.unmount());
  });

  it("traces an activity from a hovered or focused block: its blocks, slice and row, with the others faded (I1)", async () => {
    const view = await mount(week());
    const { container } = view;
    const blocks = [...container.querySelectorAll<HTMLButtonElement>(".df-wb-stack button.df-tblock")];
    expect(blocks.map((block) => block.getAttribute("aria-label"))).toEqual([
      "Work, 9h, Day 5",
      "No activity, 1h, Day 5",
      "No activity, 30m, Day 7",
      "Work, 2h, Day 7"
    ]);
    expect(blocks.every((block) => block.getAttribute("aria-describedby") === "df-report-blocks-hint")).toBe(true);
    expect(container.querySelector("#df-report-blocks-hint")?.textContent).toContain("arrow keys");
    // The stacks are no longer hidden from assistive technology: the blocks are its controls.
    expect(container.querySelector(".df-wb-stack")?.getAttribute("aria-hidden")).toBeNull();

    // Pointer: on Day 7's Work block (the second sliver up in the third column) traces Work everywhere.
    const list = container.querySelector(".df-wblocks")!;
    await pointer(list, "pointermove", 120, 188);
    expect(list.classList.contains("has-hot")).toBe(true);
    expect(view.hotKeys()).toEqual(["Work, 9h, Day 5", "Work, 2h, Day 7"]);
    expect(container.querySelector('circle[aria-label^="Filter by Work"]')?.classList.contains("is-hot")).toBe(true);
    expect(container.querySelector('a[aria-label^="Filter by Work"]')?.classList.contains("is-hot")).toBe(true);
    expect(view.centre()).toBe("9hWork");
    // Over the empty top of a column, a mouse is on no block.
    await pointer(list, "pointermove", 120, 40);
    expect(list.classList.contains("has-hot")).toBe(false);
    await pointer(list, "pointermove", 120, 198);
    expect(view.centre()).toBe("1hNo activity");
    await pointer(list, "pointerout", 120, 198, "mouse", document.body);
    expect(list.classList.contains("has-hot")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");

    // Keyboard: one tab stop, focus traces, blur clears.
    expect(blocks.map((block) => block.tabIndex)).toEqual([0, -1, -1, -1]);
    await act(async () => blocks[1].focus());
    expect(view.centre()).toBe("1hNo activity");
    expect(blocks.map((block) => block.tabIndex)).toEqual([-1, 0, -1, -1]);
    await act(async () => blocks[1].blur());
    expect(list.classList.contains("has-hot")).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("keeps a focused block's trace when a hover over another block ends (review 2)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector(".df-wblocks")!;
    const noActivity = view.container.querySelector<HTMLButtonElement>('button[aria-label="No activity, 1h, Day 5"]')!;
    await act(async () => noActivity.focus());
    // Hover wins while it lasts …
    await pointer(list, "pointermove", 20, 198);
    expect(view.centre()).toBe("9hWork");
    // … and leaving hands the trace back to focus instead of clearing it.
    await pointer(list, "pointerout", 20, 198, "mouse", document.body);
    expect(view.centre()).toBe("1hNo activity");
    expect(view.hotKeys()).toEqual(["No activity, 1h, Day 5", "No activity, 30m, Day 7"]);
    // A row's hover ending does not clear it either.
    const row = view.container.querySelector('a[aria-label^="Filter by Work"]')!;
    await act(async () => row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    expect(view.centre()).toBe("9hWork");
    await act(async () => row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(view.centre()).toBe("1hNo activity");
    await act(async () => noActivity.blur());
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => view.root.unmount());
  });

  it("gives touch a day to pick, then 44 px activity rows to pin a trace (review 3)", async () => {
    const view = await mount(week());
    const { container } = view;
    const list = container.querySelector(".df-wblocks")!;
    const panel = container.querySelector(".df-day-pick")!;
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(panel.hasAttribute("inert")).toBe(true);
    const tap = async (x: number, y: number) => {
      await pointer(list, "pointerdown", x, y, "touch");
      await pointer(list, "pointerup", x, y, "touch");
    };
    // A finger in the gap beside Day 7's column (x 141–150 is within its slop) picks the day; a
    // touch never traces a 3 px block directly.
    await tap(147, 120);
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(container.querySelector('li[data-trace-day="2026-10-07"]')?.classList.contains("is-picked")).toBe(true);
    expect(list.classList.contains("has-hot")).toBe(false);
    const rows = [...panel.querySelectorAll<HTMLButtonElement>(".df-day-pick-row")];
    expect(rows.map((row) => row.textContent)).toEqual(["No activity30m", "Work2h"]);
    expect(panel.querySelector("ul")?.getAttribute("aria-label")).toBe("Activities on Day 7");
    // Touch never leaves a hover behind.
    await pointer(list, "pointerout", 147, 120, "touch", document.body);
    // Tapping a row pins its activity; tapping it again unpins.
    await act(async () => rows[1].click());
    expect(view.centre()).toBe("9hWork");
    expect(rows[1].getAttribute("aria-pressed")).toBe("true");
    expect(view.hotKeys()).toEqual(["Work, 9h, Day 5", "Work, 2h, Day 7"]);
    await act(async () => rows[1].click());
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => rows[0].click());
    expect(view.centre()).toBe("1hNo activity");
    // Another day switches the panel and keeps the pin.
    await tap(20, 100);
    expect(panel.querySelector("h3")?.textContent).toBe("Day 5");
    expect(view.centre()).toBe("1hNo activity");
    // The picked day again, or an empty day, closes the panel and ends the pin.
    await tap(20, 100);
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    // The collapsing panel keeps the last day's rows (no blank mid-exit), inert.
    expect(panel.querySelector("h3")?.textContent).toBe("Day 5");
    await tap(20, 100);
    await tap(70, 100);
    expect(panel.classList.contains("is-open")).toBe(false);
    // Close ends the panel and its pin.
    await tap(20, 100);
    await act(async () => panel.querySelector<HTMLButtonElement>(".df-day-pick-row")!.click());
    expect(view.centre()).toBe("9hWork");
    await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="Close Day 5"]')!.click());
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    // A pointer down outside the card ends both; one inside the panel does not.
    await tap(20, 100);
    await act(async () => panel.querySelector<HTMLButtonElement>(".df-day-pick-row")!.click());
    await pointer(panel, "pointerdown", 0, 0, "touch");
    expect(view.centre()).toBe("9hWork");
    await pointer(document.body, "pointerdown", 600, 600, "touch");
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    // A touch the page takes for a scroll (pointercancel) picks nothing.
    await pointer(list, "pointerdown", 20, 100, "touch");
    await pointer(list, "pointercancel", 20, 100, "touch");
    await pointer(list, "pointerup", 20, 100, "touch");
    expect(panel.classList.contains("is-open")).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("titles the day panel with a heading under the card's heading (review r3)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector(".df-wblocks")!;
    await pointer(list, "pointerdown", 20, 100, "touch");
    await pointer(list, "pointerup", 20, 100, "touch");
    const heading = view.container.querySelector(".df-day-pick h3");
    expect(heading?.textContent).toBe("Day 5");
    expect(view.container.querySelector(".df-report-blocks h2")?.textContent).toBe("The days in blocks");
    await act(async () => view.root.unmount());
  });

  it("returns focus from the closing panel to the day's first block, or the card when it has none (review r3)", async () => {
    const view = await mount(week());
    const { container } = view;
    const list = container.querySelector(".df-wblocks")!;
    const open = async (x: number) => {
      await pointer(list, "pointerdown", x, 100, "touch");
      await pointer(list, "pointerup", x, 100, "touch");
    };
    const firstOfDay7 = () => container.querySelector<HTMLButtonElement>('button[aria-label="No activity, 30m, Day 7"]');
    // Close.
    await open(120);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-day-pick-close")!.focus());
    await act(async () => container.querySelector<HTMLButtonElement>(".df-day-pick-close")!.click());
    expect(document.activeElement).toBe(firstOfDay7());
    expect(container.querySelector(".df-day-pick")?.contains(document.activeElement)).toBe(false);
    await act(async () => firstOfDay7()!.blur());
    // Escape from a focused row.
    await open(120);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-day-pick-row")!.focus());
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(container.querySelector(".df-day-pick")?.classList.contains("is-open")).toBe(false);
    expect(document.activeElement).toBe(firstOfDay7());
    await act(async () => firstOfDay7()!.blur());
    // A pointer down outside lets focus go where the pointer lands (nothing stays in the panel).
    await open(120);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-day-pick-row")!.focus());
    await pointer(document.body, "pointerdown", 600, 600, "touch");
    expect(container.querySelector(".df-day-pick")?.contains(document.activeElement)).toBe(false);
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    // New data that leaves the day without blocks: focus goes to the day itself, now its own stop.
    await open(120);
    await act(async () => container.querySelector<HTMLButtonElement>(".df-day-pick-row")!.focus());
    await view.rerender(week(false));
    expect(document.activeElement).toBe(container.querySelector('li[data-trace-day="2026-10-07"]'));
    await act(async () => view.root.unmount());
  });

  it("keeps the closing panel's rows when new data drops the day (review r3)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector(".df-wblocks")!;
    await pointer(list, "pointerdown", 120, 100, "touch");
    await pointer(list, "pointerup", 120, 100, "touch");
    const panel = view.container.querySelector(".df-day-pick")!;
    expect(panel.querySelector("h3")?.textContent).toBe("Day 7");
    // Day 7 loses its time in the new report: the panel closes with the day it showed.
    await view.rerender(week(false));
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(panel.querySelector("h3")?.textContent).toBe("Day 7");
    expect([...panel.querySelectorAll(".df-day-pick-row")].map((row) => row.textContent)).toEqual(["No activity30m", "Work2h"]);
    await act(async () => view.root.unmount());
  });

  it("lets more than seven days scroll sideways inside the card on phones instead of squeezing (review r3)", async () => {
    const long = renderToStaticMarkup(
      <ReportsBlocksPanel blocks={reportBlocksModel(report("custom", false, 14), formatDuration)} land={land} slices={slices} totalLabel="logged in this range" totalSeconds={10 * 3600} />
    );
    expect((long.match(/class="df-wb[ "]/g) ?? []).length).toBe(14);
    expect(long).toContain('class="df-wblocks is-long"');
    const short = renderToStaticMarkup(week());
    expect(short).toContain('class="df-wblocks"');
  });

  it("ends a pin made without focus, and the day panel, on Escape anywhere (review 2)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector(".df-wblocks")!;
    await pointer(list, "pointerdown", 20, 100, "touch");
    await pointer(list, "pointerup", 20, 100, "touch");
    await act(async () => view.container.querySelector<HTMLButtonElement>(".df-day-pick-row")!.click());
    expect(view.centre()).toBe("9hWork");
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(view.centre()).toBe("10hlogged this week");
    expect(view.container.querySelector(".df-day-pick")?.classList.contains("is-open")).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("ignores a touch whose report data changed before it was released (review 3)", async () => {
    const view = await mount(week());
    const list = () => view.container.querySelector(".df-wblocks")!;
    await pointer(list(), "pointerdown", 20, 100, "touch");
    await view.rerender(week(true, slices.map((slice) => ({ ...slice }))));
    await pointer(list(), "pointerup", 20, 100, "touch");
    expect(view.container.querySelector(".df-day-pick")?.classList.contains("is-open")).toBe(false);
    // A fresh touch on the new data works.
    await pointer(list(), "pointerdown", 20, 100, "touch");
    await pointer(list(), "pointerup", 20, 100, "touch");
    expect(view.container.querySelector(".df-day-pick")?.classList.contains("is-open")).toBe(true);
    // New data closes an open panel too.
    await view.rerender(week(true, slices.map((slice) => ({ ...slice }))));
    expect(view.container.querySelector(".df-day-pick")?.classList.contains("is-open")).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("pins an activation that does not move focus (VoiceOver), cleared by a pointer down outside or Escape (review 1)", async () => {
    const view = await mount(week());
    const work = view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 9h, Day 5"]')!;
    await act(async () => work.click());
    expect(view.centre()).toBe("9hWork");
    await pointer(document.body, "pointerdown", 600, 600);
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => work.click());
    await act(async () => work.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => view.root.unmount());
  });

  it("clears every trace when the report data or filters change, even when the activity remains (review 1)", async () => {
    const view = await mount(week());
    const work = view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 9h, Day 5"]')!;
    await act(async () => work.click());
    expect(view.centre()).toBe("9hWork");
    // A filter navigation: the same activities arrive as new data.
    await view.rerender(week(true, slices.map((slice) => ({ ...slice, href: `${slice.href}&tags=a` }))));
    expect(view.container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => view.root.unmount());
  });

  it("drops the trace of a focused block that a report update removed without a blur (review 1)", async () => {
    const view = await mount(week());
    const daySeven = view.container.querySelector<HTMLButtonElement>('button[aria-label="No activity, 30m, Day 7"]')!;
    await act(async () => daySeven.focus());
    expect(view.centre()).toBe("1hNo activity");
    await view.rerender(week(false));
    expect(view.container.querySelector('button[aria-label="No activity, 30m, Day 7"]')).toBeNull();
    // The removed block's trace is gone; focus (lost with the block, review r4) returns to the
    // card's tab stop, the first block still there, without tracing it (review r5): the centre
    // shows the refreshed total.
    const work = view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 9h, Day 5"]')!;
    expect(work.tabIndex).toBe(0);
    expect(document.activeElement).toBe(work);
    expect(view.container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    // A person's next keyboard move traces again.
    await act(async () => {
      work.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(view.centre()).toBe("1hNo activity");
    await act(async () => view.root.unmount());
  });

  it("reaches every day from the keyboard when only the first day has time, in the strip and the month grid (review r4)", async () => {
    for (const preset of ["this-week", "this-month"]) {
      const view = await mount(
        <ReportsBlocksPanel blocks={reportBlocksModel(report(preset), formatDuration)} land={land} slices={slices} totalLabel="logged" totalSeconds={10 * 3600} />
      );
      const stops = [...view.container.querySelectorAll<HTMLElement>("[data-roving-key]")];
      // Two blocks on Day 5, then one stop per empty day; one tab stop in all.
      expect(stops).toHaveLength(8);
      expect(stops.filter((stop) => stop.tabIndex === 0)).toHaveLength(1);
      await act(async () => stops[0].focus());
      for (let step = 0; step < 6; step += 1) {
        await act(async () => {
          document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
        });
      }
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Day 11: 0m logged");
      expect(view.container.querySelector(".df-wblocks, .df-month")?.classList.contains("has-hot")).toBe(false);
      await act(async () => view.root.unmount());
    }
  });

  it("keeps arrow keys working when a focused empty day gains blocks, without tracing (review r5)", async () => {
    for (const preset of ["this-week", "this-month"]) {
      const panel = (fill: boolean) => (
        <ReportsBlocksPanel blocks={reportBlocksModel(report(preset, true, 7, fill), formatDuration)} land={land} slices={slices} totalLabel="logged" totalSeconds={10 * 3600} />
      );
      const view = await mount(panel(false));
      const day6 = view.container.querySelector<HTMLElement>('[data-trace-day="2026-10-06"]')!;
      await act(async () => day6.focus());
      expect(document.activeElement).toBe(day6);
      await view.rerender(panel(true));
      const filled = view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 1h, Day 6"]')!;
      expect(document.activeElement).toBe(filled);
      expect(filled.tabIndex).toBe(0);
      expect(view.container.querySelector(".df-wblocks, .df-month")?.classList.contains("has-hot")).toBe(false);
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
      });
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 2h, Day 7");
      await act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
      });
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 9h, Day 5");
      await act(async () => view.root.unmount());
    }
  });

  it("carries the activity across empty days (review r5)", async () => {
    const view = await mount(week());
    const key = (name: string) => act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: name }));
    });
    // Work is Day 5's first block but Day 7's second: crossing the empty Day 6 keeps Work.
    await act(async () => view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 9h, Day 5"]')!.focus());
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Day 6: 0m logged");
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 2h, Day 7");
    // And back again.
    await key("ArrowLeft");
    await key("ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 9h, Day 5");
    // No activity carries the same way.
    await key("ArrowUp");
    await key("ArrowRight");
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("No activity, 30m, Day 7");
    await act(async () => view.root.unmount());
  });

  it("moves focus out of the panel before it turns inert when new data closes it (review r4)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector(".df-wblocks")!;
    await pointer(list, "pointerdown", 120, 100, "touch");
    await pointer(list, "pointerup", 120, 100, "touch");
    const panel = view.container.querySelector<HTMLElement>(".df-day-pick")!;
    expect(panel.hasAttribute("inert")).toBe(false);
    await act(async () => panel.querySelector<HTMLButtonElement>(".df-day-pick-row")!.focus());
    const focusWhenInert: Array<Element | null> = [];
    const setAttribute = Element.prototype.setAttribute;
    const spy = vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (name === "inert" && this === panel) focusWhenInert.push(document.activeElement);
      setAttribute.call(this, name, value);
    });
    await view.rerender(week(true, slices.map((slice) => ({ ...slice }))));
    spy.mockRestore();
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(focusWhenInert).toHaveLength(1);
    expect(panel.contains(focusWhenInert[0])).toBe(false);
    expect(focusWhenInert[0]?.getAttribute("aria-label")).toBe("No activity, 30m, Day 7");
    // Moved by the program, so no fresh trace (review r5).
    expect(view.container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(view.centre()).toBe("10hlogged this week");
    await act(async () => view.root.unmount());
  });

  it("hands focus to Where it went before new data removes the whole blocks card (review r4)", async () => {
    const view = await mount(week());
    await act(async () => view.container.querySelector<HTMLButtonElement>('button[aria-label="Work, 2h, Day 7"]')!.focus());
    let focusAtRemoval: Element | null = null;
    const card = view.container.querySelector(".df-report-blocks")!;
    const removeChild = Node.prototype.removeChild;
    const spy = vi.spyOn(Node.prototype, "removeChild").mockImplementation(function <T extends Node>(this: Node, child: T): T {
      if ((child as Node) === card) focusAtRemoval = document.activeElement;
      return removeChild.call(this, child) as T;
    });
    await view.rerender(<ReportsBlocksPanel blocks={null} land={land} slices={slices} totalLabel="logged" totalSeconds={10 * 3600} />);
    spy.mockRestore();
    expect(view.container.querySelector(".df-report-blocks")).toBeNull();
    const where = view.container.querySelector(".df-where");
    expect(focusAtRemoval).toBe(where);
    expect(document.activeElement).toBe(where);
    await act(async () => view.root.unmount());
  });

  it("finds a day under a finger and a block under a mouse, 2 px either way (hit targets, review 3, 4)", async () => {
    const view = await mount(week());
    const list = view.container.querySelector<HTMLElement>(".df-wblocks")!;
    // Day 7's column spans x 100–144; its blocks are 3 px slivers at y 197–200 and 187–190.
    expect(traceDayAt(list, 120, 20)).toBe("2026-10-07");
    expect(traceDayAt(list, 147, 199)).toBe("2026-10-07");
    // Nearer the empty Day 8 (x 150–194), or on it, a finger is on Day 8.
    expect(traceDayAt(list, 148, 199)).toBe("2026-10-08");
    expect(traceDayAt(list, 400, 100)).toBeNull();
    // A mouse is on a block only within 2 px of it, vertically and horizontally.
    expect(traceBlockAt(list, 141, 20)).toBeNull();
    expect(traceBlockAt(list, 141, 191.5)).toBe("work");
    expect(traceBlockAt(list, 141, 192.5)).toBeNull();
    expect(traceBlockAt(list, 146, 199)).toBe("uncategorized");
    expect(traceBlockAt(list, 147, 199)).toBeNull();
    await act(async () => view.root.unmount());
  });

  it("moves between blocks with arrow keys, keeping the activity across days", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ReportsBlocksPanel blocks={reportBlocksModel(report("this-week", true), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    ));
    const key = (name: string) => act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: name }));
    });
    const blocks = [...container.querySelectorAll<HTMLButtonElement>(".df-wb-stack button.df-tblock")];
    await act(async () => blocks[0].focus());
    // Up is the next block in the stack (stacks grow upwards).
    await key("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("No activity, 1h, Day 5");
    // Right goes to the next day; an empty day (Day 6) is a stop of its own (review r4) …
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Day 6: 0m logged");
    expect(document.activeElement?.tagName).toBe("LI");
    // … that traces nothing; the next day with the activity keeps it.
    await key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("No activity, 30m, Day 7");
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("1hNo activity");
    await key("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 2h, Day 7");
    await key("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Work, 9h, Day 5");
    // End reaches the last day, empty or not (review r4: trailing empty days are reachable).
    await key("End");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Day 11: 0m logged");
    expect(blocks.map((block) => block.tabIndex)).toEqual([-1, -1, -1, -1]);
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    await key("ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Day 10: 0m logged");
    await act(async () => root.unmount());
  });

  it("traces from month-grid blocks too, each day a named group of focusable blocks", async () => {
    const view = await mount(
      <ReportsBlocksPanel blocks={reportBlocksModel(report("this-month"), formatDuration)} land={land} slices={slices} totalLabel="logged this month" totalSeconds={10 * 3600} />
    );
    const cell = view.container.querySelector(".df-mday:not(.is-empty)")!;
    expect(cell.getAttribute("role")).toBe("group");
    expect(cell.hasAttribute("data-trace-day")).toBe(true);
    expect(view.container.querySelector('.df-mday-stack button[aria-label="Work, 9h, Day 5"]')).not.toBeNull();
    const grid = view.container.querySelector(".df-month")!;
    await pointer(grid, "pointermove", 20, 199);
    expect(grid.classList.contains("has-hot")).toBe(true);
    expect([...view.container.querySelectorAll(".df-mday-stack .is-hot")].map((entry) => entry.getAttribute("data-key"))).toEqual(["work"]);
    await pointer(grid, "pointerout", 20, 199, "mouse", document.body);
    expect(grid.classList.contains("has-hot")).toBe(false);
    await act(async () => view.root.unmount());
  });

  it("leaves a slight gap after each donut slice, and a single activity as a full ring (I2)", () => {
    const circumference = 100;
    expect(donutArcs([75, 25], 100, circumference)).toEqual([
      { dash: 75 - DONUT_GAP, offset: -0 },
      { dash: 25 - DONUT_GAP, offset: -75 }
    ]);
    // A sliver never goes negative.
    expect(donutArcs([99.5, 0.5], 100, circumference)[1].dash).toBe(0.01);
    expect(donutArcs([100], 100, circumference)).toEqual([{ dash: 100, offset: -0 }]);
    expect(donutArcs([100, 0], 100, circumference)[0].dash).toBe(100);
    const html = renderToStaticMarkup(
      <ReportsBlocksPanel blocks={null} land={land} slices={[slices[0]]} totalLabel="logged this week" totalSeconds={9 * 3600} />
    );
    const full = 2 * Math.PI * 46;
    expect(html).toContain(`stroke-dasharray="${full} 0"`);
  });

  it("keeps the slices exposed to assistive technology and rings the one holding keyboard focus", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    ));
    const svg = container.querySelector("svg.df-donut")!;
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("role")).toBe("group");
    const slice = container.querySelector<SVGCircleElement>('circle[aria-label^="Filter by Work"]')!;
    expect(slice.getAttribute("role")).toBe("link");
    expect(container.querySelector(".df-donut-focus")).toBeNull();
    await act(async () => slice.focus());
    expect(container.querySelectorAll(".df-donut-focus")).toHaveLength(1);
    await act(async () => slice.blur());
    expect(container.querySelector(".df-donut-focus")).toBeNull();
    await act(async () => root.unmount());
  });

  it("drops a highlight whose slice a filter navigation removed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const other = { id: "other", categoryIds: ["a", "b"], name: "Other", color: null, seconds: 3600, percentage: 10, isUncategorized: false, href: "/reports?categories=a,b" };
    const render = (current: typeof slices) => act(async () => root.render(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={current} totalLabel="logged this week" totalSeconds={10 * 3600} />
    ));
    await render([slices[0], other]);
    // Keyboard focus on Other's donut slice: highlighted and ringed.
    await act(async () => container.querySelector<SVGCircleElement>('circle[aria-label^="Filter by Other"]')!.focus());
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("1hOther");
    expect(container.querySelectorAll(".df-donut-focus")).toHaveLength(1);
    // The filtered report replaces Other with its activities; the same panel stays mounted.
    await render([slices[0], { ...other, id: "a", categoryIds: ["a"], name: "A" }]);
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("10hlogged this week");
    // Back to the unfiltered report: Other returns, but nothing is focused or hovered, so it stays plain.
    await render([slices[0], other]);
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("10hlogged this week");
    expect(container.querySelector(".df-donut-focus")).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows only Where it went for ranges without a blocks card", () => {
    const html = renderToStaticMarkup(<ReportsBlocksPanel blocks={null} land={land} slices={slices} totalLabel="logged in this range" totalSeconds={10 * 3600} />);
    expect(html).not.toContain("in blocks");
    expect(html).toContain("df-report-panel is-single");
  });
});
