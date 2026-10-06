// @vitest-environment jsdom

import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    installDom();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens this week's calendar shortly before now instead of at midnight", async () => {
    await act(async () => {
      render(createElement(TimeReviewViews, { initialData: bootstrap(), initialPreference: null, renderedAt: new Date().toISOString() }));
    });

    const scroller = screen.getByLabelText("Calendar time grid");
    // 16:30 minus 90 minutes is 15:00; the default zoom is 64 px per hour.
    expect(scroller.scrollTop).toBe(15 * 64);
  });
});

describe("Calendar position after leaving and returning", () => {
  beforeEach(() => {
    navigation.search = "date=2026-10-06&scope=week&view=calendar";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 16, 30));
    installDom();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it.each(["list", "timesheet"])("restores where the user left the calendar after visiting %s", async (otherView) => {
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(createElement(TimeReviewViews, { initialData: bootstrap(), initialPreference: null, renderedAt: new Date().toISOString() }));
    });
    const scroller = screen.getByLabelText("Calendar time grid");
    scroller.scrollTop = 320;
    fireEvent.scroll(scroller);

    navigation.search = `date=2026-10-06&scope=week&view=${otherView}`;
    await act(async () => view?.rerender(createElement(TimeReviewViews, { initialData: bootstrap(), initialPreference: null, renderedAt: new Date().toISOString() })));
    navigation.search = "date=2026-10-06&scope=week&view=calendar";
    await act(async () => view?.rerender(createElement(TimeReviewViews, { initialData: bootstrap(), initialPreference: null, renderedAt: new Date().toISOString() })));

    expect(screen.getByLabelText("Calendar time grid").scrollTop).toBe(320);
  });
});

describe("Timeline hydration with a running timer", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it.each(["calendar", "list", "timesheet"])("hydrates the %s view a minute after the server render without a mismatch", async (viewName) => {
    navigation.search = `date=2026-10-06&scope=week&view=${viewName}`;
    installDom();
    const renderedAt = new Date(2026, 9, 6, 16, 30, 0, 250).toISOString();
    const data = bootstrap(running());
    const tree = createElement(TimeReviewViews, { initialData: data, initialPreference: null, renderedAt });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(renderedAt));
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);

    vi.setSystemTime(new Date(Date.parse(renderedAt) + 60_000));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => recoverable.push(error) });
    });

    expect(recoverable).toEqual([]);
    await act(async () => root?.unmount());
  });
});

function running() {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Deep work",
    startedAt: new Date(2026, 9, 6, 15, 52, 30).toISOString(),
    stoppedAt: null,
    updatedAt: new Date(2026, 9, 6, 15, 52, 30).toISOString(),
    durationSeconds: 0,
    tagNames: [],
    tags: []
  };
}

function installDom() {
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
}

function bootstrap(active: ReturnType<typeof running> | null = null): BootstrapData {
  const entries = active ? [active] : [];
  return {
    activeEntry: active,
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
    entries: entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
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
