// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { LocationTimeline } from "@dayframe/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, ReviewItemRow, TimeEntryRow } from "@/lib/queries";
import type { ContinuousListProps } from "./EntriesTable";

// Request-storm fix (30 Oct 2026): staging's Calendar › List made thousands of requests, because every edit or delete
// re-read every week and every day the List had ever loaded (on the local seed, one delete after scrolling back nine
// weeks made 10 bootstrap and 69 location reads). Calendar › List must make a bounded number of requests: its initial
// loads, then reads only on real triggers (scrolling to days not loaded, an edit, a bootstrap refresh), each a fixed cost
// however much history is loaded, and none from the running block's clock (performance.md). Synthetic data only.

const navigation = vi.hoisted(() => ({ search: "" }));
const listed = vi.hoisted(() => ({ continuous: null as ContinuousListProps | null, onChanged: null as null | (() => Promise<void>), entries: [] as Array<{ id: string }> }));
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
  EntriesTable: ({ continuous, entries, onChanged }: { continuous?: ContinuousListProps; entries?: Array<{ id: string }>; onChanged?: () => Promise<void> }) => {
    listed.continuous = continuous ?? null;
    listed.onChanged = onChanged ?? null;
    listed.entries = entries ?? [];
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
  it("makes a fixed number of requests per real trigger, with a block running, however much history is loaded", { timeout: 30_000 }, async () => {
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

    // An edit at the top, then one jump straight to the oldest loaded week: only the destination's window is read (at most
    // the 3 weeks and 15 days around it), never the history passed over (Codex r1 on #634: 11 and 83 before).
    act(() => listed.continuous!.onVisibleDay!(local(10, 30).getTime()));
    await flush();
    await act(async () => { await listed.onChanged!(); });
    await flush();
    mark = counts();
    act(() => listed.continuous!.onVisibleDay!(local(10, 30 - 7 * WEEKS_BACK).getTime()));
    await flush();
    await flush();
    const jump = delta(mark, counts());
    expect(jump["/api/bootstrap"] ?? 0).toBeLessThanOrEqual(3);
    expect(jump["/api/timeline"] ?? 0).toBeLessThanOrEqual(15);

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

// Freshness with bounded reads (Codex r1 on #634): the hooks against a server whose weeks and days change.
describe("Calendar › List freshness under the request budget (Codex r1 on #634)", () => {
  const ANCHOR = local(10, 26);
  const weekKey = (weeksBack: number) => {
    const day = new Date(ANCHOR);
    day.setDate(day.getDate() - 7 * weeksBack);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };
  /** A server: one block per week (by its start key) unless changed; `failing` weeks answer 500. */
  function server() {
    const weeks = new Map<string, TimeEntryRow[]>();
    const failing = new Set<string>();
    clientFetch.mockImplementation(async (url: string) => {
      const date = new URLSearchParams(url.split("?")[1] ?? "").get("date") ?? "";
      if (failing.has(date)) return { ok: false, status: 500, json: async () => ({}) };
      const [year, month, day] = date.split("-").map(Number);
      const entries = weeks.get(date) ?? [entry(`week-${date}`, new Date(year, month - 1, day + 2, 9))];
      return { ok: true, json: async () => ({ workspace: { id: "w" }, user: { id: "u" }, weekEntries: entries }) };
    });
    return { weeks, failing };
  }
  async function loadWeeks(count: number, props: { focusDate: string; staleKey: number; refreshToken: number; affectedDates?: string[] }) {
    const { useCalendarListWeeks } = await import("./useCalendarListWeeks");
    const view = renderHook((current: typeof props) => useCalendarListWeeks({
      anchorWeekStart: ANCHOR, currentWeekStart: ANCHOR, enabled: true, owner: "w:u", ...current
    }), { initialProps: props });
    for (let week = 0; week < count; week += 1) {
      act(() => view.result.current.load("earlier"));
      await flush();
      await flush();
    }
    return view;
  }
  const ids = (entries: readonly TimeEntryRow[]) => entries.map((row) => row.id);
  const bootstrapReads = () => clientFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/bootstrap")).length;

  it("reads an edited block's own week at once, far from the top day: its old row goes", async () => {
    const remote = server();
    // Sparse history: the top day is 19 Aug; the block moved away was on 5 Aug (its week is outside the window).
    const view = await loadWeeks(12, { focusDate: "2026-08-19", staleKey: 0, refreshToken: 0 });
    expect(ids(view.result.current.entries)).toContain(`week-${weekKey(12)}`);
    remote.weeks.set(weekKey(12), []);
    const before = bootstrapReads();
    view.rerender({ focusDate: "2026-08-19", staleKey: 0, refreshToken: 1, affectedDates: ["2026-08-05", "2026-10-28"] });
    await flush();
    await flush();
    expect(ids(view.result.current.entries)).not.toContain(`week-${weekKey(12)}`);
    // The window around 19 Aug (the 3 weeks overlapping 12–26 Aug) and the edited week: never all 12.
    expect(bootstrapReads() - before).toBeLessThanOrEqual(4);
  });

  it("keeps a week stale when its read fails, and reads it again on the next visit", async () => {
    const remote = server();
    const view = await loadWeeks(6, { focusDate: "2026-10-30", staleKey: 0, refreshToken: 0 });
    const far = weekKey(5);
    remote.weeks.set(far, []);
    remote.failing.add(far);
    // A bootstrap refresh: everything loaded is stale, nothing read at once.
    const before = bootstrapReads();
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    expect(bootstrapReads()).toBe(before);
    // Visiting it: the read fails, the old row stays.
    view.rerender({ focusDate: far, staleKey: 1, refreshToken: 0 });
    await flush();
    await flush();
    expect(ids(view.result.current.entries)).toContain(`week-${far}`);
    // Away and back: read again, and this time the remote deletion shows.
    remote.failing.delete(far);
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    view.rerender({ focusDate: far, staleKey: 1, refreshToken: 0 });
    await flush();
    await flush();
    expect(ids(view.result.current.entries)).not.toContain(`week-${far}`);
    // Fresh now: another visit reads nothing.
    const fresh = bootstrapReads();
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    view.rerender({ focusDate: far, staleKey: 1, refreshToken: 0 });
    await flush();
    expect(bootstrapReads()).toBe(fresh);
  });

  it("keeps a week stale when an edit's read of it fails, and reads it again on the next visit", async () => {
    const remote = server();
    const view = await loadWeeks(3, { focusDate: "2026-10-30", staleKey: 0, refreshToken: 0 });
    const near = weekKey(1);
    remote.weeks.set(near, []);
    remote.failing.add(near);
    view.rerender({ focusDate: "2026-10-30", staleKey: 0, refreshToken: 1 });
    await flush();
    await flush();
    expect(ids(view.result.current.entries)).toContain(`week-${near}`);
    remote.failing.delete(near);
    view.rerender({ focusDate: weekKey(3), staleKey: 0, refreshToken: 1 });
    await flush();
    view.rerender({ focusDate: "2026-10-30", staleKey: 0, refreshToken: 1 });
    await flush();
    await flush();
    expect(ids(view.result.current.entries)).not.toContain(`week-${near}`);
  });

  it("reads at most two of the empty weeks that end the way back at once after an edit, however many there are", async () => {
    const remote = server();
    const view = await loadWeeks(12, { focusDate: "2026-10-30", staleKey: 0, refreshToken: 0 });
    // All 12 become empty elsewhere; a bootstrap refresh, then a visit to each, finds them so.
    for (let week = 1; week <= 12; week += 1) remote.weeks.set(weekKey(week), []);
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    for (let week = 1; week <= 12; week += 1) {
      view.rerender({ focusDate: weekKey(week), staleKey: 1, refreshToken: 0 });
      await flush();
      await flush();
    }
    expect(view.result.current.entries).toEqual([]);
    expect(view.result.current.reachedEarliest).toBe(true);
    // An edit at the top: the window's 2 weeks and the 2 oldest empty ones, not all 12.
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    const before = bootstrapReads();
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 1 });
    await flush();
    await flush();
    expect(bootstrapReads() - before).toBeLessThanOrEqual(4);
  });

  const day = (date: string, marker: string): LocationTimeline =>
    ({ date, timeZone: marker, dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], items: [], openTrip: null }) as LocationTimeline;

  it("marks place days stale on a bootstrap refresh, reads one when visited, and again after a failed read", async () => {
    const markers = new Map<string, string>();
    const failing = new Set<string>();
    clientFetch.mockImplementation(async (url: string) => {
      const date = decodeURIComponent(String(url).split("date=")[1]);
      if (failing.has(date)) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => day(date, markers.get(date) ?? "before") };
    });
    const { useLocationTimelines } = await import("./location/LocationListRows");
    const dates = Array.from({ length: 28 }, (_, index) => {
      const at = local(10, 30 - index);
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    });
    const view = renderHook(({ liveKey, focus }) => useLocationTimelines(dates, ["2026-10-30"], liveKey, 0, "w:u", true, focus),
      { initialProps: { liveKey: 0, focus: "2026-10-30" } });
    for (let pass = 0; pass < 12; pass += 1) await flush();
    expect(view.result.current.size).toBe(28);
    const far = "2026-10-05";
    markers.set(far, "after");
    failing.add(far);
    const reads = () => clientFetch.mock.calls.length;
    let before = reads();
    // A bootstrap refresh: today (live) again, nothing else at once.
    view.rerender({ liveKey: 1, focus: "2026-10-30" });
    await flush();
    expect(reads() - before).toBe(1);
    // A visit: the failed read keeps the old copy; the next visit reads again and shows the change.
    view.rerender({ liveKey: 1, focus: far });
    for (let pass = 0; pass < 8; pass += 1) await flush();
    expect(view.result.current.get(far)?.timeZone).toBe("before");
    failing.delete(far);
    view.rerender({ liveKey: 1, focus: "2026-10-30" });
    await flush();
    before = reads();
    view.rerender({ liveKey: 1, focus: far });
    for (let pass = 0; pass < 8; pass += 1) await flush();
    expect(view.result.current.get(far)?.timeZone).toBe("after");
    // At most the 15 days around the destination.
    expect(reads() - before).toBeLessThanOrEqual(15);
  });
});

describe("Calendar › List freshness under the request budget (Codex r2 on #634)", () => {
  const weekStart = (weeksBack: number) => {
    const day = local(10, 26 - 7 * weeksBack);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  };
  const bootstrapCalls = () => clientFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/bootstrap")).length;

  it("an edit never re-reads every outstanding historical read: 20 delayed reads, one edit, a fixed number more", async () => {
    // Every bootstrap read waits until released.
    const held: Array<() => void> = [];
    let holding = false;
    clientFetch.mockImplementation((url: string) => {
      const answer = respond(url);
      if (!holding) return Promise.resolve(answer);
      return new Promise((resolve) => held.push(() => resolve(answer)));
    });
    const { useCalendarListWeeks } = await import("./useCalendarListWeeks");
    type Props = { focusDate: string; staleKey: number; refreshToken: number };
    const view = renderHook((props: Props) => useCalendarListWeeks({
      anchorWeekStart: local(10, 26), currentWeekStart: local(10, 26), enabled: true, owner: "workspace:user", ...props
    }), { initialProps: { focusDate: "2026-10-30", staleKey: 0, refreshToken: 0 } });
    for (let week = 0; week < 24; week += 1) {
      act(() => view.result.current.load("earlier"));
      await flush();
      await flush();
    }
    // A bootstrap refresh, then a slow scroll down through history: its window reads are all still out.
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    holding = true;
    for (let step = 1; step <= 21; step += 3) {
      view.rerender({ focusDate: weekStart(step), staleKey: 1, refreshToken: 0 });
      await flush();
    }
    expect(held.length).toBeGreaterThanOrEqual(20);
    // Back at the top, one edit, then every delayed read lands.
    const before = bootstrapCalls();
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 0 });
    await flush();
    view.rerender({ focusDate: "2026-10-30", staleKey: 1, refreshToken: 1 });
    await flush();
    holding = false;
    while (held.length) await act(async () => { held.shift()!(); await vi.advanceTimersByTimeAsync(0); });
    await flush();
    // The top window (2 loaded weeks) at once and when visited: never one more read per outstanding flight (20 before).
    expect(bootstrapCalls() - before).toBeLessThanOrEqual(4);
  });

  it("finds a block added elsewhere to a cached-empty week once the List has scrolled past it (TimeReviewViews)", { timeout: 30_000 }, async () => {
    // Sparse history: blocks on 28 Oct (this week) and 16 Sep (6 weeks back); the 5 weeks between are empty.
    const remote = new Map<string, TimeEntryRow[]>();
    for (let back = 1; back <= 5; back += 1) remote.set(weekStart(back), []);
    remote.set(weekStart(6), [entry("sep-16", local(9, 16, 9))]);
    clientFetch.mockImplementation(async (url: string) => {
      const path = url.split("?")[0];
      const date = new URLSearchParams(url.split("?")[1] ?? "").get("date") ?? "";
      if (path === "/api/bootstrap") return { ok: true, json: async () => ({ workspace: { id: "workspace" }, user: { id: "user" }, weekEntries: remote.get(date) ?? [] }) };
      return respond(url);
    });
    const { TimeReviewViews } = await import("./TimeReviewViews");
    const page = (data: BootstrapData) => <TimeReviewViews initialData={data} initialPreference={null} initialTodayKey="2026-10-30" renderedAt={local(10, 30, 12).toISOString()} />;
    const view = render(page(bootstrap()));
    await flush();
    for (let week = 1; week <= 6; week += 1) {
      act(() => listed.continuous!.onLoad("earlier"));
      await flush();
      await flush();
    }
    expect(listed.entries.map((row) => row.id)).toContain("sep-16");
    // A bootstrap refresh (every loaded week stale), and the block added to 7 Oct elsewhere (outside the bootstrap's 100).
    view.rerender(page(bootstrap()));
    await flush();
    remote.set(weekStart(3), [entry("oct-7", local(10, 7, 9))]);
    // The List's top day can only be 28 Oct or 16 Sep: the user scrolls between them.
    let passes = 0;
    while (!listed.entries.some((row) => row.id === "oct-7") && passes < 4) {
      passes += 1;
      const before = bootstrapCalls();
      act(() => listed.continuous!.onVisibleDay!(local(9, 16).getTime()));
      await flush();
      await flush();
      act(() => listed.continuous!.onVisibleDay!(local(10, 28).getTime()));
      await flush();
      await flush();
      // Each pass down and up: at most the destination windows' weeks and 2 passed-over empty weeks each way.
      expect(bootstrapCalls() - before).toBeLessThanOrEqual(2 * (3 + 2));
    }
    expect(listed.entries.map((row) => row.id)).toContain("oct-7");
    expect(passes).toBeLessThanOrEqual(2);
  });

  it("shows a week whose refresh failed as out of date, keeps its old copy, and Try again reads it (TimeReviewViews)", { timeout: 30_000 }, async () => {
    const failing = new Set<string>();
    const remote = new Map<string, TimeEntryRow[]>();
    clientFetch.mockImplementation(async (url: string) => {
      const path = url.split("?")[0];
      const date = new URLSearchParams(url.split("?")[1] ?? "").get("date") ?? "";
      if (path === "/api/bootstrap" && failing.has(date)) return { ok: false, status: 500, json: async () => ({}) };
      if (path === "/api/bootstrap" && remote.has(date)) return { ok: true, json: async () => ({ workspace: { id: "workspace" }, user: { id: "user" }, weekEntries: remote.get(date) }) };
      return respond(url);
    });
    const { TimeReviewViews } = await import("./TimeReviewViews");
    const page = (data: BootstrapData) => <TimeReviewViews initialData={data} initialPreference={null} initialTodayKey="2026-10-30" renderedAt={local(10, 30, 12).toISOString()} />;
    const view = render(page(bootstrap()));
    await flush();
    for (let week = 1; week <= 4; week += 1) {
      act(() => listed.continuous!.onLoad("earlier"));
      await flush();
      await flush();
    }
    const far = weekStart(3);
    view.rerender(page(bootstrap()));
    await flush();
    remote.set(far, []);
    failing.add(far);
    act(() => listed.continuous!.onVisibleDay!(local(10, 7).getTime()));
    await flush();
    await flush();
    // The old copy stays, and the List is told the week couldn't be refreshed.
    expect(listed.entries.map((row) => row.id)).toContain(`week-${far}`);
    expect(listed.continuous!.staleWeeks?.map((week) => week.key)).toEqual([far]);
    // Try again: read now, fresh, the line goes.
    failing.delete(far);
    act(() => listed.continuous!.onRetryWeek!(far));
    await flush();
    await flush();
    expect(listed.entries.map((row) => row.id)).not.toContain(`week-${far}`);
    expect(listed.continuous!.staleWeeks ?? []).toEqual([]);
  });

  it("exposes a place day whose refresh failed, keeps its copy, and reads it again on retry", async () => {
    const failing = new Set<string>();
    const markers = new Map<string, string>();
    clientFetch.mockImplementation(async (url: string) => {
      const date = decodeURIComponent(String(url).split("date=")[1]);
      if (failing.has(date)) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ date, timeZone: markers.get(date) ?? "before", dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], items: [], openTrip: null }) };
    });
    const { useLocationTimelinesWithStatus } = await import("./location/LocationListRows");
    const dates = ["2026-10-30", "2026-10-29", "2026-10-28"];
    const view = renderHook(({ staleKey }) => useLocationTimelinesWithStatus(dates, ["2026-10-30"], 0, staleKey, "w:u", true, "2026-10-30"),
      { initialProps: { staleKey: 0 } });
    for (let pass = 0; pass < 4; pass += 1) await flush();
    markers.set("2026-10-29", "after");
    failing.add("2026-10-29");
    view.rerender({ staleKey: 1 });
    for (let pass = 0; pass < 4; pass += 1) await flush();
    expect(view.result.current.days.get("2026-10-29")?.timeZone).toBe("before");
    expect(view.result.current.failedDays).toEqual(["2026-10-29"]);
    failing.delete("2026-10-29");
    act(() => view.result.current.retry(["2026-10-29"]));
    for (let pass = 0; pass < 4; pass += 1) await flush();
    expect(view.result.current.days.get("2026-10-29")?.timeZone).toBe("after");
    expect(view.result.current.failedDays).toEqual([]);
  });
});
