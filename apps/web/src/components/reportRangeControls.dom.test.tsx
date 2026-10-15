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

  it("returns focus to the trigger after Done, across the navigation remount", async () => {
    const user = userEvent.setup();
    await user.click(trigger());
    key("End");
    await user.click(document.activeElement as HTMLElement);
    // The dialog starts with the week's dates; applying them as a custom range is a new range.
    await user.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Done")!);
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
    const cancel = document.querySelector<HTMLButtonElement>('button[aria-label="Close Custom dates"]')!;
    await act(async () => {
      cancel.click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement).toBe(trigger());
  });

  describe("custom dates range calendar (date-picker audit, 14 Oct 2026)", () => {
    const day = (date: string) => document.querySelector<HTMLButtonElement>(`.dayframe-calendar-grid [data-date="${date}"]`)!;
    const caption = () => document.querySelector(".report-range-caption")!.textContent;
    const done = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Done")!;
    function openCustom() {
      act(() => trigger().click());
      key("End");
      act(() => (document.activeElement as HTMLElement).click());
    }

    it("opens on the current range, future days dimmed, Done neutral and enabled", () => {
      openCustom();
      expect(caption()).toBe("5 – 11 Oct 2026 · 7 days");
      expect(day("2026-10-05").className).toContain("is-range-start");
      expect(day("2026-10-08").getAttribute("aria-pressed")).toBe("true");
      expect(day("2026-10-08").className).toContain("is-unavailable");
      expect(day("2026-10-11").className).toContain("is-range-end");
      expect(day("2026-10-04").getAttribute("aria-pressed")).toBe("false");
      expect(done().className).toContain("df-range-done");
      expect(done().className).not.toContain("df-rbtn--live");
      expect(done().disabled).toBe(false);
    });

    it("takes first then last day in either order, restarts on a third tap, and pushes once on Done", () => {
      openCustom();
      act(() => day("2026-10-06").click());
      expect(caption()).toBe("From Tue 6 Oct · tap the last day");
      expect(done().disabled).toBe(true);
      expect(day("2026-10-08").getAttribute("aria-pressed")).toBe("false");
      act(() => day("2026-10-02").click());
      expect(caption()).toBe("2 – 6 Oct 2026 · 5 days");
      expect(day("2026-10-02").getAttribute("aria-label")).toContain("first day");
      expect(day("2026-10-06").getAttribute("aria-label")).toContain("last day");
      act(() => day("2026-10-01").click());
      expect(caption()).toBe("From Thu 1 Oct · tap the last day");
      act(() => day("2026-10-01").click());
      expect(caption()).toBe("Thu 1 Oct 2026 · 1 day");
      expect(day("2026-10-01").className).toContain("is-range-single");
      act(() => done().click());
      expect(push).toHaveBeenCalledTimes(1);
      const href = new URL(push.mock.calls[0][0], "http://x").searchParams;
      expect([href.get("range"), href.get("from"), href.get("to")]).toEqual(["custom", "2026-10-01", "2026-10-01"]);
    });

    it("never takes a day after today", () => {
      openCustom();
      act(() => day("2026-10-09").click());
      expect(caption()).toBe("5 – 11 Oct 2026 · 7 days");
      expect(trigger()).toBeTruthy();
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Next month"]')!.disabled).toBe(true);
    });

    it("closes without loading again when Done keeps the custom range already showing", () => {
      act(() => root.render(<></>));
      render({ ...defaultReportFilters(NOW), range: "custom", from: "2026-10-01", to: "2026-10-03" });
      openCustom();
      expect(caption()).toBe("1 – 3 Oct 2026 · 3 days");
      act(() => done().click());
      expect(push).not.toHaveBeenCalled();
      expect(document.querySelector(".report-range-caption")).toBeNull();
    });
  });
});
