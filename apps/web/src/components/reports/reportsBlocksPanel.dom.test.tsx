// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";
import { reportBlocksModel } from "@/lib/reports-blocks";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportsBlocksPanel } = await import("./ReportsBlocksPanel");

const at = (date: number, hour = 0) => new Date(2026, 9, date, hour).toISOString();
const day = (date: number) => ({ key: `d${date}`, label: `Day ${date}`, start: at(date), end: at(date + 1) });

function report(preset = "this-week"): ReportResult {
  const days = [5, 6, 7, 8, 9, 10, 11].map(day);
  return {
    range: { preset, dayCount: 7 },
    capturedNow: at(6, 12),
    byCategory: [
      { id: "work", name: "Work", color: "blue", seconds: 9 * 3600, entryCount: 3 },
      { id: "uncategorized", name: "No activity", color: null, seconds: 3600, entryCount: 1 }
    ],
    dailySeries: days.map((entry, index) => ({ key: entry.key, label: entry.label, seconds: 0, coveredSeconds: index === 0 ? 9 * 3600 : 0, additionalOverlappingActivitySeconds: 0 })),
    dailyByActivity: days.map((entry, index) => ({ ...entry, activities: index === 0 ? [{ id: "work", seconds: 9 * 3600 }, { id: "uncategorized", seconds: 3600 }] : [] }))
  } as unknown as ReportResult;
}

const slices = [
  { id: "work", categoryIds: ["work"], name: "Work", color: "blue", seconds: 9 * 3600, percentage: 90, isUncategorized: false, href: "/reports?categories=work" },
  { id: "uncategorized", categoryIds: ["uncategorized"], name: "No activity", color: null, seconds: 3600, percentage: 10, isUncategorized: true, href: "/reports?categories=uncategorized" }
];
const land = { easing: "ease-out", durationMs: 300 };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Reports blocks and Where it went", () => {
  it("draws a week as one column per day, each named with its activities", () => {
    const html = renderToStaticMarkup(
      <ReportsBlocksPanel blocks={reportBlocksModel(report(), formatDuration)} land={land} slices={slices} totalLabel="logged this week" totalSeconds={10 * 3600} />
    );
    expect((html.match(/class="df-wb[ "]/g) ?? []).length).toBe(7);
    expect(html).toContain('aria-label="Day 5: 9h 00m framed, Work 9h 00m, No activity 1h 00m"');
    expect(html).toContain("The days in blocks");
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
    expect(html).toContain('aria-label="Day 5: 9h 00m framed, Work 9h 00m, No activity 1h 00m"');
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
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("9h 00mWork");
    await act(async () => row.blur());
    expect(container.querySelector(".df-wblocks")?.classList.contains("has-hot")).toBe(false);
    expect(container.querySelector(".df-donut-center")?.textContent).toBe("10h 00mlogged this week");
    await act(async () => root.unmount());
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

  it("shows only Where it went for ranges without a blocks card", () => {
    const html = renderToStaticMarkup(<ReportsBlocksPanel blocks={null} land={land} slices={slices} totalLabel="logged in this range" totalSeconds={10 * 3600} />);
    expect(html).not.toContain("in blocks");
    expect(html).toContain("df-report-panel is-single");
  });
});
