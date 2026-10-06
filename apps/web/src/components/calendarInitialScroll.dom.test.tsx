// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData } from "@/lib/queries";

const navigation = vi.hoisted(() => ({ search: "date=2026-10-06&scope=week&view=calendar" }));

const runtime = vi.hoisted(() => {
  const values: Record<string, unknown> = {
    dateLoadError: null,
    isDateLoading: false,
    isTimerBusy: false,
    shellData: null
  };
  return new Proxy(values, {
    get(target, key: string) {
      if (key in target) return target[key];
      target[key] = vi.fn(async () => ({ ok: true }));
      return target[key];
    }
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/timeline",
  useSearchParams: () => new URLSearchParams(navigation.search)
}));

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime,
  useRuntimePageData: (value: unknown) => value
}));

const { TimeReviewViews } = await import("./TimeReviewViews");

const scrollTops = new WeakMap<Element, number>();

describe("Calendar opening position", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 16, 30));
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) { return scrollTops.get(this) ?? 0; },
      set(this: Element, value: number) { scrollTops.set(this, value); }
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class { disconnect() {} observe() {} unobserve() {} }
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens this week's calendar shortly before now instead of at midnight", async () => {
    await act(async () => {
      render(createElement(TimeReviewViews, { initialData: bootstrap(), initialPreference: null }));
    });

    const scroller = screen.getByLabelText("Calendar time grid");
    // 16:30 minus 90 minutes is 15:00; the default zoom is 64 px per hour.
    expect(scroller.scrollTop).toBe(15 * 64);
  });
});

function bootstrap(): BootstrapData {
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" },
    workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [],
    categoryUsage: [],
    clients: [],
    projects: [],
    tags: [],
    places: [],
    learnedPlaces: [],
    automationRules: [],
    taskSuggestions: [],
    reviewItems: [],
    activityEvents: [],
    entries: [],
    historyEntries: [],
    dayEntries: [],
    weekEntries: [],
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0 },
    todaySeries: [],
    weekSeries: [],
    dateRange: {
      selectedDate: "2026-10-06",
      previousDate: "2026-10-05",
      nextDate: "2026-10-07",
      dayStart: new Date(2026, 9, 6).toISOString(),
      dayEnd: new Date(2026, 9, 7).toISOString(),
      weekStart: new Date(2026, 9, 5).toISOString(),
      weekEnd: new Date(2026, 9, 12).toISOString()
    }
  } as unknown as BootstrapData;
}
