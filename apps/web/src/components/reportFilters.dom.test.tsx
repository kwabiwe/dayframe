// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportFilters } from "@/lib/report-filters";
import type { ReportFilterOptions } from "@/lib/report-service";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportFiltersPanel } = await import("./ReportFiltersPanel");

const WORK = "10000000-0000-4000-8000-000000000001";
const TAG = "20000000-0000-4000-8000-000000000001";

const options = {
  categories: [{ id: WORK, name: "Work", color: "blue", isPinned: true }],
  tags: [{ id: TAG, name: "acme", normalizedName: "acme", usageCount: 2 }],
  places: [],
  sources: [{ id: "health_sleep", name: "Apple Health sleep" }]
} as unknown as ReportFilterOptions;

function filters(overrides: Partial<ReportFilters> = {}): ReportFilters {
  return { range: "this-week", from: "2026-10-05", to: "2026-10-11", categories: [], tags: [], places: [], sources: [], description: "", sort: "newest", page: 3, ...overrides };
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("Reports filters", () => {
  it("applies the dialog's draft in one navigation, back to the first page", async () => {
    const user = userEvent.setup();
    render(<ReportFiltersPanel filters={filters()} options={options} rangeLabel="This week" />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Work" }));
    await user.click(within(dialog).getByRole("button", { name: "acme" }));
    await user.click(within(dialog).getByRole("button", { name: "Apple Health sleep" }));
    await user.type(within(dialog).getByLabelText("Description contains"), "  launch ");
    expect(push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("categories")).toBe(WORK);
    expect(url.searchParams.get("tags")).toBe(TAG);
    expect(url.searchParams.get("sources")).toBe("health_sleep");
    expect(url.searchParams.get("description")).toBe("launch");
    expect(url.searchParams.get("page")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows active filters as removable chips with Clear all keeping the range", () => {
    render(<ReportFiltersPanel filters={filters({ categories: [WORK], tags: [TAG] })} options={options} rangeLabel="This week" />);
    expect(screen.getByRole("button", { name: "Filter · 2" })).toBeTruthy();
    const work = screen.getByRole("link", { name: "Remove Work filter" });
    expect(new URL(work.getAttribute("href")!, "http://localhost").searchParams.get("categories")).toBeNull();
    const clear = new URL(screen.getByRole("link", { name: "Clear all report filters" }).getAttribute("href")!, "http://localhost");
    expect(clear.searchParams.get("tags")).toBeNull();
    expect(clear.searchParams.get("range")).toBe("this-week");
  });

  it("resets the draft without navigating until Apply", async () => {
    const user = userEvent.setup();
    render(<ReportFiltersPanel filters={filters({ categories: [WORK] })} options={options} rangeLabel="This week" />);
    await user.click(screen.getByRole("button", { name: "Filter · 1" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Work" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect(within(dialog).getByRole("button", { name: "Work" }).getAttribute("aria-pressed")).toBe("false");
    expect(push).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(push).not.toHaveBeenCalled();
  });
});
