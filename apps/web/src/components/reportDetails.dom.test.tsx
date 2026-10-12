// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportResult } from "@/lib/report-service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ isTimerBusy: false, shellData: null, updateActiveEntryFromCalendar: vi.fn() })
}));

const { ReportDetailsTable, reportRowDuration } = await import("./ReportDetailsTable");

const WORK = "10000000-0000-4000-8000-000000000001";

function entry(overrides: Record<string, unknown>) {
  return {
    id: "e1", description: "Write report", categoryId: WORK, categoryName: "Work", categoryColor: "blue",
    placeId: null, placeName: null, tagNames: ["acme"], tags: [], startedAt: "2026-10-05T09:00:00.000Z",
    stoppedAt: "2026-10-05T10:00:00.000Z", durationSeconds: 3600, isRunning: false, overlapCount: 0, overlapSeconds: 0,
    ...overrides
  };
}

function report(entries: unknown[]) {
  return {
    entries,
    appliedFilters: { range: "this-week", from: "2026-10-05", to: "2026-10-11", categories: [], tags: [], places: [], sources: [], description: "", sort: "newest", page: 1 },
    pagination: { page: 1, totalPages: 1, totalEntries: entries.length, hasNext: false, hasPrevious: false },
    filterOptions: { categories: [{ id: WORK, name: "Work", color: "blue", icon: null }], tags: [], places: [], sources: [] },
    capturedNow: "2026-10-05T12:00:00.000Z",
    overlapCandidates: []
  } as unknown as ReportResult;
}

afterEach(cleanup);

describe("Reports matching blocks (UIA-303)", () => {
  it("renders Blocks rows with activity block, description, time range, duration and Edit", () => {
    render(<ReportDetailsTable report={report([entry({})])} />);
    const list = screen.getByRole("list", { name: "Blocks matching the report filters" });
    const row = within(list).getAllByRole("listitem")[0];
    expect(row.className).toContain("df-erow");
    expect(row.querySelector(".df-erow-block.df-block")).toBeTruthy();
    expect(within(row).getByText("Write report")).toBeTruthy();
    expect(within(row).getByText("Work · #acme")).toBeTruthy();
    expect(within(row).getByText("1h")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Edit Write report" })).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByText(/No place/)).toBeNull();
  });

  it("shows a place only on a block that has one", () => {
    render(<ReportDetailsTable report={report([entry({ placeName: "Gym" }), entry({ id: "e2", description: "Other" })])} />);
    expect(screen.getByText("Work · #acme · Gym")).toBeTruthy();
    expect(screen.getAllByText("Work · #acme")).toHaveLength(1);
  });

  it("writes a sub-minute block as <1m, never 0m", () => {
    expect(reportRowDuration({ durationSeconds: 0, startedAt: "2026-10-05T09:00:00Z", stoppedAt: "2026-10-05T09:00:20Z" })).toBe("<1m");
    expect(reportRowDuration({ durationSeconds: 25, startedAt: "2026-10-05T09:00:00Z", stoppedAt: "2026-10-05T09:00:25Z" })).toBe("<1m");
    expect(reportRowDuration({ durationSeconds: 0, startedAt: "2026-10-05T09:00:00Z", stoppedAt: "2026-10-05T09:00:00Z" })).toBe("0m");
  });
});
