// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import type { ContinuousListProps } from "./EntriesTable";

// Owner bug (29 Oct 2026; Codex r1 on #625): in Calendar › List the header — date, week strip, week total and its
// report link — names the day at the top of the List, and choosing the URL's own day again brings the List back to it.

const navigation = vi.hoisted(() => ({ search: "" }));
const listed = vi.hoisted(() => ({ continuous: null as ContinuousListProps | null }));
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
vi.mock("@/components/EntriesTable", () => ({
  EntriesTable: ({ continuous }: { continuous?: ContinuousListProps }) => {
    listed.continuous = continuous ?? null;
    return null;
  }
}));

const local = (day: number, hour: number) => new Date(2026, 9, day, hour);
const entry = (id: string, day: number, hours: number): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "1", reviewStatus: "accepted", description: `Block ${id}`,
  startedAt: local(day, 9).toISOString(), stoppedAt: local(day, 9 + hours).toISOString(), updatedAt: local(day, 9).toISOString(),
  durationSeconds: hours * 3600, tagNames: [], tags: []
});
// The URL's week (12–18 Oct) has one hour on the 14th; the week before, loaded by the List, three hours on the 8th.
const THIS_WEEK = entry("this-week", 14, 1);
const WEEK_BEFORE = entry("week-before", 8, 3);

vi.mock("@/components/useCalendarListWeeks", () => ({
  useCalendarListWeeks: () => ({
    entries: [WEEK_BEFORE], rangeStart: new Date(2026, 9, 5), rangeEnd: new Date(2026, 9, 19), loading: null, error: null,
    reachedEarliest: false, reachedLatest: true, load: () => undefined
  })
}));

function bootstrap(): BootstrapData {
  const entries = [THIS_WEEK];
  return {
    activeEntry: null,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Dayframe" }, workspaces: [{ id: "workspace", name: "Dayframe" }],
    categories: [], categoryUsage: [], clients: [], projects: [], tags: [], places: [], learnedPlaces: [], automationRules: [],
    taskSuggestions: [], reviewItems: [], activityEvents: [],
    entries, historyEntries: entries, dayEntries: [], weekEntries: entries,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0, reviewCardCount: 0 },
    todaySeries: [], weekSeries: [],
    dateRange: { selectedDate: "2026-10-14", previousDate: "2026-10-13", nextDate: "2026-10-15", dayStart: local(14, 0).toISOString(),
      dayEnd: local(15, 0).toISOString(), weekStart: local(12, 0).toISOString(), weekEnd: local(19, 0).toISOString() }
  } as unknown as BootstrapData;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(local(18, 12));
  navigation.search = "date=2026-10-14&scope=day&view=list";
  window.history.replaceState(null, "", `/timeline?${navigation.search}`);
  listed.continuous = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderList() {
  const { TimeReviewViews } = await import("./TimeReviewViews");
  const view = render(<TimeReviewViews initialData={bootstrap()} initialPreference={null} initialTodayKey="2026-10-18" renderedAt={local(18, 12).toISOString()} />);
  await act(async () => undefined);
  return view;
}
const pressedDay = (container: HTMLElement) => container.querySelector('.df-cal-day[aria-pressed="true"]')?.getAttribute("aria-label") ?? null;
const dayLabels = (container: HTMLElement) => [...container.querySelectorAll(".df-cal-day")].map((day) => day.getAttribute("aria-label"));

describe("Calendar › List header follows the List's top day (Codex r1 on #625)", () => {
  it("moves the week strip, its totals and its report link to the week the List has scrolled into", async () => {
    const { container } = await renderList();
    expect(dayLabels(container)[0]).toMatch(/12 Oct/);
    expect(container.querySelector(".df-cal-weektotal")?.textContent).toBe("1h this week");

    // The List reports the 8th at its top: the week before.
    act(() => listed.continuous!.onVisibleDay!(local(8, 0).getTime()));
    expect(container.querySelector(".timeline-range-navigation")?.textContent).toContain("Thu, 8 Oct 2026");
    expect(dayLabels(container)[0]).toMatch(/5 Oct/);
    expect(dayLabels(container)[6]).toMatch(/11 Oct/);
    expect(pressedDay(container)).toMatch(/8 Oct/);
    expect(container.querySelector(".df-cal-weektotal")?.textContent).toBe("3h in the week of 5 Oct");
    const report = new URL(container.querySelector<HTMLAnchorElement>(".df-cal-weektotal")!.getAttribute("href")!, "https://dayframe.test");
    expect([report.searchParams.get("from"), report.searchParams.get("to")]).toEqual(["2026-10-05", "2026-10-11"]);
  });

  it("brings the List back to the URL's day when that day is chosen again, by mouse and by keyboard", async () => {
    const { container, getByRole } = await renderList();
    const first = listed.continuous!.focusRequest;
    // Scrolled to the 12th (same week); the 14th is the URL's day.
    act(() => listed.continuous!.onVisibleDay!(local(12, 0).getTime()));
    expect(pressedDay(container)).toMatch(/12 Oct/);
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const fourteenth = () => getByRole("button", { name: /14 Oct/ });
    await user.click(fourteenth());
    const afterClick = listed.continuous!.focusRequest;
    expect(afterClick).not.toBe(first);
    expect(afterClick.startsWith("2026-10-14")).toBe(true);
    // Scrolled away again; the keyboard chooses the 14th.
    act(() => listed.continuous!.onVisibleDay!(local(12, 0).getTime()));
    fourteenth().focus();
    await user.keyboard("{Enter}");
    expect(listed.continuous!.focusRequest).not.toBe(afterClick);
    const afterEnter = listed.continuous!.focusRequest;
    await user.keyboard(" ");
    expect(listed.continuous!.focusRequest).not.toBe(afterEnter);
    // No load or history entry for an unchanged day.
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-10-14");
  });
});
