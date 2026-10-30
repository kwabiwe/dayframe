// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow, TimeEntryRow } from "@/lib/queries";
import type { ContinuousListProps } from "./EntriesTable";

// Request-storm fix (30 Oct 2026): staging's Calendar › List made thousands of requests, because every edit or delete
// re-read every week and every day the List had ever loaded (on the local seed, one delete after scrolling back nine
// weeks made 10 bootstrap and 69 location reads). Calendar › List must make a bounded number of requests: its initial
// loads, then reads only on real triggers (scrolling to days not loaded, an edit, a bootstrap refresh), each a fixed cost
// however much history is loaded, and none from the running block's clock (performance.md). Synthetic data only.

const navigation = vi.hoisted(() => ({ search: "" }));
const listed = vi.hoisted(() => ({ continuous: null as ContinuousListProps | null, onChanged: null as null | (() => Promise<void>) }));
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
const clientFetch = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));
// The List itself (its Places column and "?" rows render from the props below and fetch nothing); the props are kept.
vi.mock("@/components/EntriesTable", () => ({
  EntriesTable: ({ continuous, onChanged }: { continuous?: ContinuousListProps; onChanged?: () => Promise<void> }) => {
    listed.continuous = continuous ?? null;
    listed.onChanged = onChanged ?? null;
    return null;
  }
}));

const local = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour);
const entry = (id: string, start: Date, running = false): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "1", reviewStatus: "accepted", description: `Block ${id}`,
  startedAt: start.toISOString(), stoppedAt: running ? null : new Date(start.getTime() + 3_600_000).toISOString(),
  updatedAt: start.toISOString(), durationSeconds: running ? 0 : 3600, tagNames: [], tags: []
});
const RUNNING = entry("running", local(10, 30, 11), true);

function bootstrap(): BootstrapData {
  const entries = [RUNNING];
  return {
    activeEntry: RUNNING,
    user: { id: "user", email: "user@example.test", name: "Test User", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400 },
    workspace: { id: "workspace", name: "Exampleton" }, workspaces: [{ id: "workspace", name: "Exampleton" }],
    categories: [], categoryUsage: [], clients: [], projects: [], tags: [], places: [], learnedPlaces: [], automationRules: [],
    taskSuggestions: [], reviewItems: [], activityEvents: [],
    entries, historyEntries: entries, dayEntries: entries, weekEntries: entries,
    stats: { todaySeconds: 0, weekSeconds: 0, todayCoveredSeconds: 0, weekCoveredSeconds: 0, todayAdditionalOverlapSeconds: 0, weekAdditionalOverlapSeconds: 0, reviewCount: 0, reviewCardCount: 0 },
    todaySeries: [], weekSeries: [],
    dateRange: { selectedDate: "2026-10-30", previousDate: "2026-10-29", nextDate: "2026-10-31", dayStart: local(10, 30).toISOString(),
      dayEnd: local(10, 31).toISOString(), weekStart: local(10, 26).toISOString(), weekEnd: local(11, 2).toISOString() }
  } as unknown as BootstrapData;
}

/** Every week has a block (the way back never ends), and every day a location timeline. */
function respond(url: string) {
  const path = url.split("?")[0];
  const date = new URLSearchParams(url.split("?")[1] ?? "").get("date") ?? "";
  if (path === "/api/bootstrap") {
    const [year, month, day] = date.split("-").map(Number);
    return { ok: true, json: async () => ({ workspace: { id: "workspace" }, user: { id: "user" }, weekEntries: [entry(`week-${date}`, new Date(year, month - 1, day + 2, 9))] }) };
  }
  if (path === "/api/timeline") {
    return { ok: true, json: async () => ({ date, timeZone: "UTC", dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], items: [], openTrip: null }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}
const counts = () => {
  const byPath: Record<string, number> = {};
  for (const [url] of clientFetch.mock.calls) {
    const path = String(url).split("?")[0];
    byPath[path] = (byPath[path] ?? 0) + 1;
  }
  return byPath;
};
const delta = (before: Record<string, number>, after: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).map(([path, count]) => [path, count - (before[path] ?? 0)]).filter(([, count]) => Number(count) > 0));
const flush = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};
async function seconds(total: number) {
  for (let second = 0; second < total; second += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })
  });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { disconnect() {} observe() {} unobserve() {} } });
  vi.useFakeTimers({ now: local(10, 30, 12) });
  navigation.search = "date=2026-10-30&scope=day&view=list";
  window.history.replaceState(null, "", `/timeline?${navigation.search}`);
  listed.continuous = null;
  listed.onChanged = null;
  clientFetch.mockReset();
  clientFetch.mockImplementation(async (url: string) => respond(url));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const WEEKS_BACK = 12;

describe("Calendar › List request budget (request-storm fix, 30 Oct 2026)", () => {
  it("makes a fixed number of requests per real trigger, with a block running, however much history is loaded", async () => {
    const { TimeReviewViews } = await import("./TimeReviewViews");
    const page = (data: BootstrapData) => <TimeReviewViews initialData={data} initialPreference={null} initialTodayKey="2026-10-30" renderedAt={local(10, 30, 12).toISOString()} />;
    const view = render(page(bootstrap()));
    await flush();
    expect(listed.continuous).not.toBeNull();

    // Scroll back WEEKS_BACK weeks: each week is one bootstrap read and its seven days' location reads (initial loads).
    for (let week = 1; week <= WEEKS_BACK; week += 1) {
      act(() => listed.continuous!.onLoad("earlier"));
      await flush();
      await flush();
      act(() => listed.continuous!.onVisibleDay!(local(10, 30 - 7 * week).getTime()));
      await flush();
    }
    // …and back up to today.
    act(() => listed.continuous!.onVisibleDay!(local(10, 30).getTime()));
    await flush();
    const loaded = counts();
    expect(loaded["/api/bootstrap"]).toBe(WEEKS_BACK);
    expect(loaded["/api/timeline"]).toBeLessThanOrEqual(7 * (WEEKS_BACK + 1) + 2);

    // Five minutes with the block running (the clock ticks each second) and nothing else: no request at all.
    await seconds(300);
    expect(delta(loaded, counts())).toEqual({});

    // Three bootstrap refreshes (a new shell snapshot each): the selected day and today again, nothing else.
    let mark = counts();
    for (let refresh = 0; refresh < 3; refresh += 1) {
      view.rerender(page(bootstrap()));
      await flush();
      await seconds(5);
    }
    const refreshes = delta(mark, counts());
    expect(refreshes["/api/bootstrap"] ?? 0).toBe(0);
    expect(refreshes["/api/timeline"] ?? 0).toBeLessThanOrEqual(3 * 2);

    // Three edits at the top of the List: only the weeks and days near the top day are read again at once.
    mark = counts();
    for (let edit = 0; edit < 3; edit += 1) {
      await act(async () => { await listed.onChanged!(); });
      await flush();
      await seconds(2);
    }
    const edits = delta(mark, counts());
    // Per edit: at most the 2 loaded weeks overlapping 7 days around the 30th (the anchor week is the shell's own data)
    // and at most those 15 days. The old code read all 12 weeks and 91 days on every edit.
    expect(edits["/api/bootstrap"] ?? 0).toBeLessThanOrEqual(3 * 2);
    expect(edits["/api/timeline"] ?? 0).toBeLessThanOrEqual(3 * 15);

    // Scrolling back down into the edited-over history reads each stale week and day once, as it comes near.
    mark = counts();
    for (let week = 1; week <= WEEKS_BACK; week += 1) {
      act(() => listed.continuous!.onVisibleDay!(local(10, 30 - 7 * week).getTime()));
      await flush();
      await flush();
    }
    const revisit = delta(mark, counts());
    expect(revisit["/api/bootstrap"] ?? 0).toBeLessThanOrEqual(WEEKS_BACK);
    expect(revisit["/api/timeline"] ?? 0).toBeLessThanOrEqual(7 * (WEEKS_BACK + 1));
    // …and a second pass over the same days reads nothing more.
    mark = counts();
    act(() => listed.continuous!.onVisibleDay!(local(10, 30).getTime()));
    await flush();
    for (let week = 1; week <= WEEKS_BACK; week += 1) {
      act(() => listed.continuous!.onVisibleDay!(local(10, 30 - 7 * week).getTime()));
      await flush();
    }
    expect(delta(mark, counts())).toEqual({});

    // Nothing in the whole session read anything but the bootstrap and the location timeline.
    expect(Object.keys(counts()).sort()).toEqual(["/api/bootstrap", "/api/timeline"]);
  });

  it("reads clashes past the bootstrap's cap at most once a minute, even when the shell refreshes every 3 s", async () => {
    const { useClashesBeyondCap } = await import("./location/useClashesBeyondCap");
    const presentation = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: 1, snapshotToken: "s", nextCursor: null, records: [] })
    }));
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `review-${index}` }) as ReviewItemRow);
    const { rerender } = renderHook(({ version }) => useClashesBeyondCap({
      bootstrapItems: items, dataVersion: version, fetcher: presentation as never, owner: "workspace:user", todayStartMs: local(10, 30).getTime()
    }), { initialProps: { version: 0 } });
    for (let tick = 1; tick <= 100; tick += 1) {
      rerender({ version: tick });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }
    // 100 refreshes over five minutes: at most one read a minute (plus the first).
    expect(presentation.mock.calls.length).toBeGreaterThan(0);
    expect(presentation.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
