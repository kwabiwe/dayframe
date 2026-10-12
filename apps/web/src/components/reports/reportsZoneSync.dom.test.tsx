// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";
import { reportBlocksModel } from "@/lib/reports-blocks";
import { clearReportsZoneSyncRefresh, isReportsZoneSyncRefresh, markReportsZoneSyncRefresh } from "@/lib/reports-zone-sync";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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

describe("Reports after a time zone reconciliation (Codex r1 on #367)", () => {
  it("draws the blocks of the shell's zone refresh at rest, and lands the next report the user asks for", async () => {
    window.history.replaceState(null, "", "/reports?range=this-week");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const panel = (blocks: ReturnType<typeof week>) => (
      <ReportsBlocksPanel blocks={blocks} land={land} slices={slices} totalLabel="logged this week" totalSeconds={3600} />
    );
    const list = () => container.querySelector(".df-wblocks")!;

    // The server drew the week in UTC; the first render lands as before.
    await act(async () => root.render(panel(week(5))));
    expect(list().classList.contains("is-settled")).toBe(false);

    // The shell wrote the zone cookie and refreshed: the viewer's week arrives at rest.
    markReportsZoneSyncRefresh("/reports?range=this-week");
    await act(async () => root.render(panel(week(12))));
    expect(list().classList.contains("is-settled")).toBe(true);
    expect(isReportsZoneSyncRefresh("/reports?range=this-week")).toBe(false);

    // The user's next range lands again.
    window.history.replaceState(null, "", "/reports?range=last-week");
    await act(async () => root.render(panel(week(5))));
    expect(list().classList.contains("is-settled")).toBe(false);
    await act(async () => root.unmount());
  });

  it("never treats a navigation to another page of Reports as the zone refresh", async () => {
    window.history.replaceState(null, "", "/reports?range=this-week");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ReportsBlocksPanel blocks={week(5)} land={land} slices={slices} totalLabel="logged" totalSeconds={3600} />));
    markReportsZoneSyncRefresh("/reports?range=this-week");
    // The user chose another range before the refresh arrived.
    window.history.replaceState(null, "", "/reports?range=last-week");
    await act(async () => root.render(<ReportsBlocksPanel blocks={week(12)} land={land} slices={slices} totalLabel="logged" totalSeconds={3600} />));
    expect(container.querySelector(".df-wblocks")?.classList.contains("is-settled")).toBe(false);
    await act(async () => root.unmount());
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
    expect(shell).toMatch(/markReportsZoneSyncRefresh\(currentReportsHref\(\)\);\s*router\.refresh\(\);/);
  });
});
