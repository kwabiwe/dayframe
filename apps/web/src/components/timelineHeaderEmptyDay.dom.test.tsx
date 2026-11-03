// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

// Codex r3 on #625: with the real List and header, moving from a listed day to an empty today leaves no stale top day:
// the header falls back to the requested day.

const navigation = vi.hoisted(() => ({ search: "" }));
const weeks = vi.hoisted(() => ({ entries: [] as unknown[], start: new Date(2026, 9, 12), end: new Date(2026, 9, 19) }));
const runtime = vi.hoisted(() => {
  const values: Record<string, unknown> = { dateLoadError: null, isDateLoading: false, isTimerBusy: false, shellData: null };
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
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime,
  useRuntimePageData: (value: unknown) => value
}));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })) }));
vi.mock("@/components/useCalendarListWeeks", () => ({
  useCalendarListWeeks: () => ({
    entries: weeks.entries, rangeStart: weeks.start, rangeEnd: weeks.end, loading: null, error: null,
    reachedEarliest: true, reachedLatest: true, load: () => undefined, failedWeeks: [], retryWeek: () => undefined
  })
}));

const local = (day: number, hour: number) => new Date(2026, 9, day, hour);
const entry = (id: string, day: number): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "1", reviewStatus: "accepted", description: `Block ${id}`,
  startedAt: local(day, 9).toISOString(), stoppedAt: local(day, 10).toISOString(), updatedAt: local(day, 9).toISOString(),
  durationSeconds: 3600, tagNames: [], tags: []
});

function bootstrap(selected: number, weekStart: number, entries: TimeEntryRow[]): BootstrapData {
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" }, workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [], categoryUsage: [], clients: [], projects: [], tags: [], places: [], learnedPlaces: [], automationRules: [],
    taskSuggestions: [], reviewItems: [], activityEvents: [],
    entries, historyEntries: entries, dayEntries: entries.filter((row) => new Date(row.startedAt).getDate() === selected), weekEntries: entries,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0, reviewCardCount: 0 },
    todaySeries: [], weekSeries: [],
    dateRange: { selectedDate: `2026-10-${selected}`, previousDate: "", nextDate: "", dayStart: local(selected, 0).toISOString(),
      dayEnd: local(selected + 1, 0).toISOString(), weekStart: local(weekStart, 0).toISOString(), weekEnd: local(weekStart + 7, 0).toISOString() }
  } as unknown as BootstrapData;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(local(26, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const label = () => document.querySelector(".df-cal-datebox .timeline-period-trigger")?.textContent ?? "";

describe("Calendar › List header with nothing listed (Codex r3 on #625)", () => {
  it("steps past empty days and releases their date when the person scrolls", async () => {
    const { TimeReviewViews } = await import("./TimeReviewViews");
    const entries = [entry("friday", 23)];
    navigation.search = "date=2026-10-23&scope=week&view=list";
    window.history.replaceState(null, "", `/timeline?${navigation.search}`);
    weeks.entries = entries;
    weeks.start = local(19, 0);
    weeks.end = local(26, 0);
    const view = (day: number) => (
      <TimeReviewViews initialData={bootstrap(day, 19, entries)} initialPreference={null}
        initialTodayKey="2026-10-26" renderedAt={local(26, 12).toISOString()} />
    );
    const { container, getByRole, rerender } = render(view(23));
    await act(async () => undefined);
    expect(label()).toContain("Fri 23 Oct");
    async function step(direction: "Next" | "Previous", day: number) {
      await act(async () => { fireEvent.click(getByRole("button", { name: `${direction} day` })); });
      navigation.search = window.location.search.slice(1);
      expect(new URLSearchParams(navigation.search).get("date")).toBe(`2026-10-${day}`);
      rerender(view(day));
      await act(async () => undefined);
    }

    await step("Next", 24);
    expect(label()).toContain("Sat 24 Oct");
    await step("Next", 25);
    expect(label()).toContain("Sun 25 Oct");

    const list = container.querySelector(".timeline-list-scroll")!;
    await act(async () => {
      fireEvent.wheel(list);
      fireEvent.scroll(list);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(label()).toContain("Fri 23 Oct");
    await step("Next", 24);
    expect(label()).toContain("Sat 24 Oct");

    // Friday is the earliest heading. Scroll cannot reach an earlier row, but the arrows can.
    await step("Previous", 23);
    await step("Previous", 22);
    expect(label()).toContain("Thu 22 Oct");
    await step("Previous", 21);
    expect(label()).toContain("Wed 21 Oct");
  });

  it("names the requested day, not the earlier one, when the List moves from the 14th to an empty today", async () => {
    const { TimeReviewViews } = await import("./TimeReviewViews");
    const fourteenth = [entry("on-14", 14)];
    navigation.search = "date=2026-10-14&scope=day&view=list";
    weeks.entries = fourteenth;
    weeks.start = local(12, 0);
    weeks.end = local(19, 0);
    const view = (data: BootstrapData) => (
      <TimeReviewViews initialData={data} initialPreference={null} initialTodayKey="2026-10-26" renderedAt={local(26, 12).toISOString()} />
    );
    const { rerender } = render(view(bootstrap(14, 12, fourteenth)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(document.querySelectorAll("tr[data-day-start-ms]")).toHaveLength(1);
    expect(label()).toContain("Wed 14 Oct");

    // Calendar on today, the 26th: a new week with nothing in it.
    navigation.search = "date=2026-10-26&scope=day&view=list";
    weeks.entries = [];
    weeks.start = local(26, 0);
    weeks.end = local(33, 0);
    rerender(view(bootstrap(26, 26, [])));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(document.querySelectorAll("tr[data-day-start-ms]")).toHaveLength(0);
    expect(label()).toContain("Today · 26 Oct");
    expect(label()).not.toContain("14 Oct");
  });
});
