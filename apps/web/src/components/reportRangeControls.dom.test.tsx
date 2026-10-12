// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultReportFilters, type ReportRangeMetadata } from "@/lib/report-filters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportRangeControls } = await import("./ReportRangeControls");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let reduce = false;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  reduce = false;
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce") ? reduce : false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const filters = { ...defaultReportFilters(new Date(2026, 9, 7)), range: "this-week" as const };
  const range = { preset: "this-week", label: "5 – 11 Oct", dayCount: 7, canNavigateNext: false, wasClamped: false } as unknown as ReportRangeMetadata;
  act(() => root.render(<ReportRangeControls filters={filters} range={range} />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const trigger = () => container.querySelector<HTMLButtonElement>(".df-range-trigger")!;
const menu = () => container.querySelector<HTMLElement>("[role=menu]");
const key = (k: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("Reports range menu (W8, menu pattern and motion)", () => {
  it("focuses the checked preset, moves with arrows/Home/End and returns focus on Escape", () => {
    act(() => trigger().click());
    expect(document.activeElement?.textContent).toBe("This week");
    key("ArrowDown");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    key("End");
    expect(document.activeElement?.textContent).toBe("Custom…");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Today");
    key("Home");
    expect(document.activeElement?.textContent).toBe("Today");
    key("Escape");
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the menu mounted while it fades out, and reopening mid-exit cancels the unmount", () => {
    vi.useFakeTimers();
    act(() => trigger().click());
    act(() => trigger().click());
    expect(menu()?.dataset.state).toBe("closing");
    act(() => trigger().click());
    expect(menu()?.dataset.state).toBe("open");
    act(() => { vi.advanceTimersByTime(500); });
    expect(menu()?.dataset.state).toBe("open");
    key("Tab");
    act(() => { vi.advanceTimersByTime(500); });
    expect(menu()).toBeNull();
  });

  it("closes at once under Reduce Motion", () => {
    reduce = true;
    act(() => trigger().click());
    key("Escape");
    expect(menu()).toBeNull();
  });

  it("returns focus to the trigger when the custom dates dialog closes", async () => {
    act(() => trigger().click());
    key("End");
    act(() => (document.activeElement as HTMLElement).click());
    const cancel = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
    await act(async () => {
      cancel.click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(trigger());
  });
});
