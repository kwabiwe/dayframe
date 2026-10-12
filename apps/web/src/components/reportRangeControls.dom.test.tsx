// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { defaultReportFilters, type ReportFilters, type ReportRangeMetadata } from "@/lib/report-filters";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { ReportRangeControls } = await import("./ReportRangeControls");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let reduce = false;
let root: Root;
let container: HTMLDivElement;

// Frozen clock: the fixture's week (5–11 Oct 2026) must match what the presets compute as "now".
const NOW = new Date(2026, 9, 7, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  reduce = false;
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce") ? reduce : false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  push.mockReset();
  render({ ...defaultReportFilters(NOW), range: "this-week" });
});

/** Renders as the page does: the range is in the key, so a new range remounts the controls. */
function render(filters: ReportFilters) {
  const range = { preset: filters.range, label: "5 – 11 Oct", dayCount: 7, canNavigateNext: true, wasClamped: false } as unknown as ReportRangeMetadata;
  act(() => root.render(
    <>
      <ReportRangeControls filters={filters} key={`${filters.range}-${filters.from}-${filters.to}`} range={range} />
      <button type="button">After</button>
    </>
  ));
}

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
    vi.useFakeTimers({ now: NOW });
    act(() => trigger().click());
    act(() => trigger().click());
    expect(menu()?.dataset.state).toBe("closing");
    act(() => trigger().click());
    expect(menu()?.dataset.state).toBe("open");
    act(() => { vi.advanceTimersByTime(500); });
    expect(menu()?.dataset.state).toBe("open");
    key("Escape");
    act(() => { vi.advanceTimersByTime(500); });
    expect(menu()).toBeNull();
  });

  it("makes a closing menu inert and moves real Tab focus past the trigger, Shift+Tab to the trigger", async () => {
    const user = userEvent.setup();
    await user.click(trigger());
    expect(document.activeElement?.textContent).toBe("This week");
    await user.tab();
    expect(menu()?.hasAttribute("inert")).toBe(true);
    // Next after the trigger is the "Next report period" link, never another preset or <body>.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Next report period");
    await user.click(trigger());
    expect(document.activeElement?.textContent).toBe("This week");
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(trigger());
  });

  it("returns focus to the trigger after Apply, across the navigation remount", async () => {
    const user = userEvent.setup();
    await user.click(trigger());
    key("End");
    await user.click(document.activeElement as HTMLElement);
    // The dialog starts with the week's dates; applying them as a custom range is a new range.
    await user.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Apply")!);
    expect(push).toHaveBeenCalledTimes(1);
    const href = new URL(push.mock.calls[0][0], "http://x").searchParams;
    render({ ...defaultReportFilters(NOW), range: "custom", from: href.get("from")!, to: href.get("to")! });
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement).toBe(trigger());
  });

  it("returns focus to the trigger when the checked preset is picked again (Codex r3)", () => {
    act(() => trigger().click());
    expect(document.activeElement?.textContent).toBe("This week");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(document.activeElement).toBe(trigger());
    expect(push).toHaveBeenCalledTimes(1);
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
