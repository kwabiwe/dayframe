// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";
import { reportBlocksModel } from "@/lib/reports-blocks";
import { clearReportsZoneSyncRefresh, isReportsZoneSyncRefresh, markReportsZoneSyncRefresh, reportsRouteHref } from "@/lib/reports-zone-sync";

// The route a render is for, as Next's router holds it. Next writes the address bar only after
// the new route has rendered (HistoryUpdater in a layout effect), so tests move `route` first and
// the address afterwards.
const route = vi.hoisted(() => ({ pathname: "/reports", search: "range=this-week" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(route.search)
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportsBlocksPanel } = await import("./ReportsBlocksPanel");

const at = (date: number) => new Date(2026, 9, date).toISOString();
const land = { easing: "ease-out", durationMs: 300 };
const slices = [
  { id: "work", categoryIds: ["work"], name: "Work", color: "blue", seconds: 3600, percentage: 100, isUncategorized: false, href: "/reports?categories=work" }
];

/** A week of report days starting on the given October date, with an hour of Work on its first day. */
function week(firstDate: number) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = firstDate + index;
    return { key: `2026-10-${`${date}`.padStart(2, "0")}`, label: `Day ${date}`, start: at(date), end: at(date + 1) };
  });
  const report = {
    range: { preset: "this-week", dayCount: 7 },
    capturedNow: at(firstDate),
    byCategory: [{ id: "work", name: "Work", color: "blue", seconds: 3600, entryCount: 1 }],
    dailySeries: days.map((day, index) => ({ key: day.key, label: day.label, seconds: index === 0 ? 3600 : 0 })),
    dailyByActivity: days.map((day, index) => ({ ...day, activities: index === 0 ? [{ id: "work", seconds: 3600 }] : [] }))
  } as unknown as ReportResult;
  return reportBlocksModel(report, formatDuration);
}

afterEach(() => {
  clearReportsZoneSyncRefresh();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("Reports after a time zone reconciliation (Codex r1 and r2 on #367)", () => {
  const THIS_WEEK = "/reports?range=this-week";

  /** Renders the panel for `search`, then (as Next's HistoryUpdater does) writes the address. */
  async function renderRoute(root: ReturnType<typeof createRoot>, search: string, blocks: ReturnType<typeof week>) {
    route.search = search;
    await act(async () => root.render(
      <ReportsBlocksPanel blocks={blocks} land={land} slices={slices} totalLabel="logged this week" totalSeconds={3600} />
    ));
    const settled = document.querySelector(".df-wblocks")!.classList.contains("is-settled");
    window.history.replaceState(null, "", `/reports?${search}`);
    return settled;
  }

  function mount() {
    route.search = "range=this-week";
    window.history.replaceState(null, "", THIS_WEEK);
    const container = document.createElement("div");
    document.body.append(container);
    return createRoot(container);
  }

  it("draws the blocks of the shell's zone refresh at rest, and lands the next report the user asks for", async () => {
    const root = mount();
    // The server drew the week in UTC; the first render lands as before.
    expect(await renderRoute(root, "range=this-week", week(5))).toBe(false);

    // The shell wrote the zone cookie and refreshed the same route: the viewer's week arrives at rest.
    markReportsZoneSyncRefresh(reportsRouteHref(window.location.pathname, window.location.search));
    expect(await renderRoute(root, "range=this-week", week(12))).toBe(true);
    expect(isReportsZoneSyncRefresh(THIS_WEEK)).toBe(false);

    // The user's next range lands again, although it renders while the address still shows this week.
    expect(window.location.search).toBe("?range=this-week");
    expect(await renderRoute(root, "range=last-week", week(5))).toBe(false);
    await act(async () => root.unmount());
  });

  it("never mistakes a navigation that renders before the address changes for the zone refresh", async () => {
    const root = mount();
    await renderRoute(root, "range=this-week", week(5));
    markReportsZoneSyncRefresh(reportsRouteHref(window.location.pathname, window.location.search));
    // The user picks another range before the refresh arrives. It renders while the address bar
    // still reads the marked page, and keeps its landing.
    expect(await renderRoute(root, "range=last-week&categories=work", week(12))).toBe(false);
    // The navigation superseded the refresh: the mark is spent, so returning to the marked page
    // lands too.
    expect(isReportsZoneSyncRefresh(THIS_WEEK)).toBe(false);
    expect(await renderRoute(root, "range=this-week", week(19))).toBe(false);
    await act(async () => root.unmount());
  });

  it("names a route the same way from the address bar and from the router", () => {
    expect(reportsRouteHref("/reports", "?range=custom&from=2026-10-01&categories=a,b")).toBe(
      reportsRouteHref("/reports", new URLSearchParams("range=custom&from=2026-10-01&categories=a%2Cb").toString())
    );
    expect(reportsRouteHref("/reports", "")).toBe("/reports");
  });

  it("lets a mark lapse", () => {
    markReportsZoneSyncRefresh("/reports", 1_000);
    expect(isReportsZoneSyncRefresh("/reports", 20_000)).toBe(true);
    expect(isReportsZoneSyncRefresh("/reports", 40_000)).toBe(false);
  });

  it("settles by zeroing the landing's duration, so the class leaving never replays it", () => {
    const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(styles).toMatch(/\.df-wblocks\.is-settled \.df-wb-stack > \.df-tblock \{\s*animation-duration: 0s;\s*\}/);
    const shell = readFileSync(join(process.cwd(), "src/components/AppShell.tsx"), "utf8");
    expect(shell).toMatch(/markReportsZoneSyncRefresh\(reportsRouteHref\(window\.location\.pathname, window\.location\.search\)\);\s*router\.refresh\(\);/);
    // The panel compares the route its render is for, never the address bar.
    const panel = readFileSync(join(process.cwd(), "src/components/reports/ReportsBlocksPanel.tsx"), "utf8");
    expect(panel).toContain("isReportsZoneSyncRefresh(routeHref)");
    expect(panel).not.toContain("window.location");
  });
});
