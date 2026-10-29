// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@/lib/location/location-timeline-service";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ clearTimerError: vi.fn(), isTimerBusy: false, startEntryAgain: vi.fn(), updateActiveEntryFromCalendar: vi.fn() })
}));
const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));
// The viewer's today is 20 Oct (the List's focus day), so the 14th's "?" still ask: a "?" asks for today and the
// 6 days before (owner, 28 Oct 2026).
vi.mock("@/components/useCalendarClock", () => ({ useLocalDayStartMs: () => new Date(2026, 9, 20).getTime(), useMediaQuery: () => false }));

const { useCalendarListWeeks, LIST_EMPTY_WEEKS_BEFORE_END } = await import("./useCalendarListWeeks");
const { useLocationTimelines, LOCATION_TIMELINE_CONCURRENCY } = await import("./location/LocationListRows");
const { EntriesTable } = await import("./EntriesTable");
const { SegmentedControl } = await import("./ui/Primitives");
const { DatePickerPopover } = await import("./DatePickerPopover");

// Calendar › List's continuous days (owner, 24 Oct 2026). Synthetic Exampleton data only.
const entry = (id: string, start: Date, minutes = 30): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "1", reviewStatus: "accepted", description: `Block ${id}`,
  startedAt: start.toISOString(), stoppedAt: new Date(start.getTime() + minutes * 60_000).toISOString(), updatedAt: start.toISOString(),
  durationSeconds: minutes * 60, tagNames: [], tags: []
});
const monday = (year: number, month: number, day: number) => new Date(year, month - 1, day);
const weekPayload = (workspace: string, entries: TimeEntryRow[]) => ({
  ok: true,
  json: async () => ({ workspace: { id: workspace, name: "Exampleton" }, user: { id: "u1" }, weekEntries: entries })
});

describe("useCalendarListWeeks (continuous days)", () => {
  beforeEach(() => {
    clientFetch.mockReset();
  });
  afterEach(cleanup);

  it("loads the week before the selected one through the bootstrap read, widening the List's span", async () => {
    clientFetch.mockResolvedValueOnce(weekPayload("w1", [entry("old", new Date(2026, 9, 14, 9))]));
    const anchor = monday(2026, 10, 19);
    const { result } = renderHook(() => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner: "w1:u1", refreshToken: 0 }));
    expect(result.current.reachedLatest).toBe(true);
    act(() => result.current.load("earlier"));
    expect(clientFetch).toHaveBeenCalledWith("/api/bootstrap?date=2026-10-12", { cache: "no-store" });
    await waitFor(() => expect(result.current.entries.map((row) => row.id)).toEqual(["old"]));
    expect(result.current.rangeStart).toEqual(monday(2026, 10, 12));
    expect(result.current.rangeEnd).toEqual(monday(2026, 10, 26));
  });

  it("never shows another workspace's weeks: a switch drops them, and a late answer from the one left is discarded", async () => {
    let answer: (value: unknown) => void = () => undefined;
    clientFetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const anchor = monday(2026, 10, 19);
    const { result, rerender } = renderHook(({ owner }) => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner, refreshToken: 0 }),
      { initialProps: { owner: "w1:u1" } });
    act(() => result.current.load("earlier"));
    rerender({ owner: "w2:u1" });
    await act(async () => answer(weekPayload("w1", [entry("other-workspace", new Date(2026, 9, 14, 9))])));
    expect(result.current.entries).toEqual([]);
    expect(result.current.rangeStart).toEqual(anchor);
  });

  it("loads later weeks only up to the current one, and ends the way back after empty weeks", async () => {
    const anchor = monday(2026, 10, 5);
    clientFetch.mockResolvedValue(weekPayload("w1", []));
    const { result } = renderHook(() => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: monday(2026, 10, 12), enabled: true, owner: "w1:u1", refreshToken: 0 }));
    expect(result.current.reachedLatest).toBe(false);
    act(() => result.current.load("later"));
    await waitFor(() => expect(result.current.reachedLatest).toBe(true));
    for (let week = 0; week < LIST_EMPTY_WEEKS_BEFORE_END; week += 1) {
      act(() => result.current.load("earlier"));
      await waitFor(() => expect(result.current.loading).toBeNull());
    }
    expect(result.current.reachedEarliest).toBe(true);
    const calls = clientFetch.mock.calls.length;
    act(() => result.current.load("earlier"));
    expect(clientFetch.mock.calls.length).toBe(calls);
  });

  it("reads every loaded week again after an edit, keeping the shown copy until it arrives", async () => {
    const anchor = monday(2026, 10, 19);
    clientFetch.mockResolvedValueOnce(weekPayload("w1", [entry("before", new Date(2026, 9, 14, 9))]));
    const { result, rerender } = renderHook(({ token }) => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner: "w1:u1", refreshToken: token }),
      { initialProps: { token: 0 } });
    act(() => result.current.load("earlier"));
    await waitFor(() => expect(result.current.entries.map((row) => row.id)).toEqual(["before"]));
    clientFetch.mockResolvedValueOnce(weekPayload("w1", [entry("after", new Date(2026, 9, 14, 9))]));
    rerender({ token: 1 });
    expect(result.current.entries.map((row) => row.id)).toEqual(["before"]);
    await waitFor(() => expect(result.current.entries.map((row) => row.id)).toEqual(["after"]));
  });

  it("never brings an old scope back: A → B → A starts empty, and a read from the first A never lands (Codex r1 on #584)", async () => {
    const answers: Array<(value: unknown) => void> = [];
    clientFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const anchor = monday(2026, 10, 19);
    const { result, rerender } = renderHook(({ owner }) => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner, refreshToken: 0 }),
      { initialProps: { owner: "w1:u1" } });
    act(() => result.current.load("earlier"));
    await act(async () => answers.shift()!(weekPayload("w1", [entry("first-a", new Date(2026, 9, 14, 9))])));
    expect(result.current.entries.map((row) => row.id)).toEqual(["first-a"]);
    act(() => result.current.load("earlier"));
    rerender({ owner: "w2:u1" });
    rerender({ owner: "w1:u1" });
    expect(result.current.entries).toEqual([]);
    await act(async () => answers.shift()!(weekPayload("w1", [entry("late-a", new Date(2026, 9, 7, 9))])));
    expect(result.current.entries).toEqual([]);
  });

  it("keeps a week's newest read: an older refresh answering last never restores old entries, and a week loading during an edit is read again (Codex r1 on #584)", async () => {
    const answers: Array<(value: unknown) => void> = [];
    clientFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const anchor = monday(2026, 10, 19);
    const { result, rerender } = renderHook(({ token }) => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner: "w1:u1", refreshToken: token }),
      { initialProps: { token: 0 } });
    act(() => result.current.load("earlier"));
    // An edit while the week is still loading: its answer lands, then it is read again.
    rerender({ token: 1 });
    await act(async () => answers.shift()!(weekPayload("w1", [entry("pre-edit", new Date(2026, 9, 14, 9))])));
    expect(clientFetch).toHaveBeenCalledTimes(2);
    await act(async () => answers.shift()!(weekPayload("w1", [entry("post-edit", new Date(2026, 9, 14, 9))])));
    expect(result.current.entries.map((row) => row.id)).toEqual(["post-edit"]);
    // Two refreshes: the newer answers first, the older last; the newer stays.
    rerender({ token: 2 });
    rerender({ token: 3 });
    const [older, newer] = [answers.shift()!, answers.shift()!];
    await act(async () => newer(weekPayload("w1", [entry("newest", new Date(2026, 9, 14, 9))])));
    await act(async () => older(weekPayload("w1", [entry("stale", new Date(2026, 9, 14, 9))])));
    expect(result.current.entries.map((row) => row.id)).toEqual(["newest"]);
  });

  it("counts the empty weeks again when a refresh fills one, so the way back opens again (Codex r2 on #584)", async () => {
    const anchor = monday(2026, 10, 19);
    clientFetch.mockResolvedValue(weekPayload("w1", []));
    const { result, rerender } = renderHook(({ token }) => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner: "w1:u1", refreshToken: token }),
      { initialProps: { token: 0 } });
    for (let week = 0; week < LIST_EMPTY_WEEKS_BEFORE_END; week += 1) {
      act(() => result.current.load("earlier"));
      await waitFor(() => expect(result.current.loading).toBeNull());
    }
    expect(result.current.reachedEarliest).toBe(true);
    // A block moved into the oldest loaded week: its re-read is no longer empty.
    clientFetch.mockImplementation((url: string) => Promise.resolve(weekPayload("w1",
      url.endsWith("2026-08-24") ? [entry("moved", new Date(2026, 7, 25, 9))] : [])));
    rerender({ token: 1 });
    await waitFor(() => expect(result.current.entries.map((row) => row.id)).toEqual(["moved"]));
    expect(result.current.reachedEarliest).toBe(false);
  });

  it("shows a failed week as an error to try again", async () => {
    clientFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const anchor = monday(2026, 10, 19);
    const { result } = renderHook(() => useCalendarListWeeks({ anchorWeekStart: anchor, currentWeekStart: anchor, enabled: true, owner: "w1:u1", refreshToken: 0 }));
    act(() => result.current.load("earlier"));
    await waitFor(() => expect(result.current.error).toBe("earlier"));
  });
});

describe("useLocationTimelines (each shown day's places)", () => {
  beforeEach(() => {
    clientFetch.mockReset();
  });
  afterEach(cleanup);

  const day = (date: string): LocationTimeline => ({ date, timeZone: "UTC", dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], items: [], openTrip: null });

  it(`reads at most ${LOCATION_TIMELINE_CONCURRENCY} days at a time, and never returns another owner's`, async () => {
    const pending: Array<() => void> = [];
    clientFetch.mockImplementation((url: string) => new Promise((resolve) => {
      const date = decodeURIComponent(url.split("date=")[1]);
      pending.push(() => resolve({ ok: true, json: async () => day(date) }));
    }));
    const dates = ["2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15"];
    const { result, rerender } = renderHook(({ owner }) => useLocationTimelines(dates, [], "data", 0, owner), { initialProps: { owner: "w1:u1" } });
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY);
    await act(async () => pending.shift()!());
    await waitFor(() => expect(result.current.has("2026-10-19")).toBe(true));
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY + 1);
    rerender({ owner: "w2:u1" });
    expect(result.current.size).toBe(0);
    // The first owner's answers still in flight never reach the second.
    await act(async () => { while (pending.length) pending.shift()!(); });
    expect([...result.current.keys()].every((date) => clientFetch.mock.calls.filter(([url]) => String(url).includes(date)).length >= 2)).toBe(true);
  });
});

describe("useLocationTimelines refreshes and teardown (Codex r1 on #584)", () => {
  beforeEach(() => {
    clientFetch.mockReset();
  });
  afterEach(cleanup);
  const day = (date: string, marker = ""): LocationTimeline => ({ date, timeZone: marker, dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], items: [], openTrip: null });

  it("reads a day again when an edit lands while its read is out", async () => {
    const answers: Array<(value: unknown) => void> = [];
    clientFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result, rerender } = renderHook(({ stale }) => useLocationTimelines(["2026-10-19"], [], "data", stale, "w1:u1"), { initialProps: { stale: 0 } });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    rerender({ stale: 1 });
    await act(async () => answers.shift()!({ ok: true, json: async () => day("2026-10-19", "old") }));
    expect(clientFetch).toHaveBeenCalledTimes(2);
    await act(async () => answers.shift()!({ ok: true, json: async () => day("2026-10-19", "new") }));
    expect(result.current.get("2026-10-19")?.timeZone).toBe("new");
  });

  it("keeps its days in read order, a day read again moving last (Codex r5 on #584)", async () => {
    clientFetch.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => day(decodeURIComponent(url.split("date=")[1])) }));
    // Read first: the 21st, then the 22nd.
    const { result, rerender } = renderHook(({ stale }) => useLocationTimelines(["2026-10-21", "2026-10-22"], [], "data", stale, "w1:u1"),
      { initialProps: { stale: 0 } });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect([...result.current.keys()]).toEqual(["2026-10-21", "2026-10-22"]);
    clientFetch.mockImplementation((url: string) => {
      const date = decodeURIComponent(url.split("date=")[1]);
      // The 21st answers at once; the 22nd later.
      return date === "2026-10-21" ? Promise.resolve({ ok: true, json: async () => day(date, "fresh") }) : new Promise(() => undefined);
    });
    rerender({ stale: 1 });
    await waitFor(() => expect(result.current.get("2026-10-21")?.timeZone).toBe("fresh"));
    expect([...result.current.keys()]).toEqual(["2026-10-22", "2026-10-21"]);
  });

  it("aborts its reads and starts no more after unmounting", async () => {
    const answers: Array<(value: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    clientFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise((resolve) => answers.push(resolve));
    });
    const { unmount } = renderHook(() => useLocationTimelines(["2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16"], [], "data", 0, "w1:u1"));
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY);
    unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => answers.shift()!({ ok: true, json: async () => day("2026-10-19") }));
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY);
  });

  it("stops reading while the List isn't shown (Codex r9 on #584)", async () => {
    const answers: Array<(value: unknown) => void> = [];
    clientFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const dates = ["2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16"];
    const { rerender } = renderHook(({ enabled }) => useLocationTimelines(enabled ? dates : [], [], "data", 0, "w1:u1", enabled), { initialProps: { enabled: true } });
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY);
    rerender({ enabled: false });
    await act(async () => answers.shift()!({ ok: true, json: async () => day("2026-10-19") }));
    expect(clientFetch).toHaveBeenCalledTimes(LOCATION_TIMELINE_CONCURRENCY);
  });

  it("never brings an owner's days back after A → B → A", async () => {
    clientFetch.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => day(decodeURIComponent(url.split("date=")[1])) }));
    const { result, rerender } = renderHook(({ owner, dates }) => useLocationTimelines(dates, [], "data", 0, owner),
      { initialProps: { owner: "w1:u1", dates: ["2026-10-19"] } });
    await waitFor(() => expect(result.current.has("2026-10-19")).toBe(true));
    rerender({ owner: "w2:u1", dates: [] });
    rerender({ owner: "w1:u1", dates: [] });
    expect(result.current.size).toBe(0);
  });
});

describe("Calendar › List days (Codex r1 on #584)", () => {
  afterEach(cleanup);
  const localDay = (year: number, month: number, date: number) => new Date(year, month - 1, date);
  const dayTimeline = (start: Date, items: LocationTimeline["items"] = []): LocationTimeline => ({
    date: "", timeZone: "", dayStart: start.toISOString(), dayEnd: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).toISOString(),
    gaps: [], items, openTrip: null
  });

  it("puts a day with only places under its own heading, not the day after's", async () => {
    const thursday = localDay(2026, 10, 22);
    const unknownPlace = { kind: "place" as const, id: "thursday-place", status: "finalised" as const, startedAt: new Date(2026, 9, 22, 10).toISOString(),
      stoppedAt: new Date(2026, 9, 22, 12).toISOString(), placeId: null, learnedPlaceId: null, name: null, role: null, matchKind: "unknown" as const,
      confidence: "medium" as const, blockIds: [] };
    render(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay
        entries={[entry("friday", new Date(2026, 9, 23, 9)), entry("wednesday", new Date(2026, 9, 21, 9))]}
        locationTimelines={[dayTimeline(thursday, [unknownPlace])]}
        checksDays={[localDay(2026, 10, 23), thursday, localDay(2026, 10, 21)].map((start) => ({ start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) }))}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    const rows = await screen.findAllByRole("row");
    const text = rows.map((row) => row.textContent ?? "");
    const at = (needle: string) => text.findIndex((value) => value.includes(needle));
    const headings = [...document.querySelectorAll("tr[data-day-start-ms]")].map((row) => Number((row as HTMLElement).dataset.dayStartMs));
    expect(headings).toEqual([localDay(2026, 10, 23).getTime(), thursday.getTime(), localDay(2026, 10, 21).getTime()]);
    const thursdayHeading = rows.findIndex((row) => (row as HTMLElement).dataset.dayStartMs === String(thursday.getTime()));
    expect(thursdayHeading).toBeGreaterThan(at("Block friday"));
    const unknown = text.findIndex((value) => value.startsWith("Unknown place"));
    expect(unknown).toBeGreaterThan(thursdayHeading);
    expect(unknown).toBeLessThan(at("Block wednesday"));
  });
});

describe("Calendar › List trips across midnight (Codex r2 on #584)", () => {
  afterEach(cleanup);

  it("shows the freshest copy of a trip read on two days, also when it is the earlier day's (Codex r5 on #584)", async () => {
    const trip = (mode: "walking" | "train") => ({
      kind: "trip" as const, id: "night-trip", status: "finalised" as const, startedAt: new Date(2026, 9, 21, 23, 30).toISOString(),
      stoppedAt: new Date(2026, 9, 22, 0, 30).toISOString(), fromId: "a", toId: "b", mode: "automotive" as const, stopIds: [], distanceMeters: 9_000,
      confidence: "medium" as const, reason: null, blockIds: ["night"],
      legs: [{ startedAt: new Date(2026, 9, 21, 23, 30).toISOString(), stoppedAt: new Date(2026, 9, 22, 0, 30).toISOString(), mode, confidence: "sure" as const, distanceMeters: 9_000 }]
    });
    const timeline = (day: number, mode: "walking" | "train"): LocationTimeline => ({
      date: "", timeZone: "", dayStart: new Date(2026, 9, day).toISOString(), dayEnd: new Date(2026, 9, day + 1).toISOString(), gaps: [], items: [trip(mode)], openTrip: null
    });
    render(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay
        entries={[entry("night", new Date(2026, 9, 21, 23, 30), 60)]}
        // Read order: the 22nd's cached copy first, then the selected 21st refreshed.
        locationTimelines={[timeline(22, "walking"), timeline(21, "train")]}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect((await screen.findByLabelText(/Legs: Train/)).textContent).toBeTruthy();
    expect(screen.queryByLabelText(/Legs: Walk/)).toBeNull();
  });
});

describe("Calendar › List selected day (Codex r3 on #584)", () => {
  // jsdom has no layout: each List row is 100 px tall, the List 500 px, the "N to check" chip above the
  // table 52 px, and the browser clamps scrollTop to what lies below, as a real browser does.
  const ROW = 100;
  const VIEW = 500;
  const scrollTops = new WeakMap<Element, number>();
  const listOf = (element: Element) => element.closest(".timeline-list-scroll");
  const rowsOf = (root: Element) => [...root.querySelectorAll("tbody > tr")];
  const CHIP = 52;
  const above = (root: Element) => (root.querySelector(".timeline-checks-bar") ? CHIP : 0);
  let restore: () => void = () => undefined;
  beforeEach(() => {
    const rowRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
    const top = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    const height = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    const rect = (y: number, h: number) => ({ top: y, bottom: y + h, left: 0, right: 800, width: 800, height: h, x: 0, y, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", { configurable: true, value(this: HTMLElement) {
      if (this.classList.contains("timeline-list-scroll")) return rect(0, VIEW);
      const root = listOf(this);
      if (root && this.tagName === "TR" && this.parentElement?.tagName === "TBODY") return rect(above(root) + rowsOf(root).indexOf(this) * ROW - (scrollTops.get(root) ?? 0), ROW);
      return rect(0, 0);
    } });
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) {
      return this.classList.contains("timeline-list-scroll") ? above(this) + rowsOf(this).length * ROW : 0;
    } });
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) {
      return this.classList.contains("timeline-list-scroll") ? VIEW : 0;
    } });
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true,
      get(this: Element) { return scrollTops.get(this) ?? 0; },
      set(this: Element, value: number) { scrollTops.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))); } });
    restore = () => {
      for (const [target, name, descriptor] of [[HTMLElement.prototype, "getBoundingClientRect", rowRect], [Element.prototype, "scrollTop", top],
        [Element.prototype, "scrollHeight", height], [Element.prototype, "clientHeight", client]] as const) {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete (target as unknown as Record<string, unknown>)[name];
      }
    };
  });
  afterEach(() => {
    restore();
    cleanup();
  });

  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => entry(`d${to - index}`, new Date(2026, 9, to - index, 9)));
  const list = (entries: TimeEntryRow[], extra: Partial<Parameters<typeof EntriesTable>[0]["continuous"] & object> = {}) => (
    <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay entries={entries}
      continuous={{ error: null, focusDayStartMs: new Date(2026, 9, 14).getTime(), focusRequest: "2026-10-14", loading: null, onLoad: vi.fn(),
        reachedEarliest: false, reachedLatest: true, ...extra }}
      onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
  );
  const headingTop = (day: number) => {
    const heading = document.querySelector<HTMLElement>(`tr[data-day-start-ms="${new Date(2026, 9, day).getTime()}"]`)!;
    return heading.getBoundingClientRect().top;
  };

  it("keeps bringing the selected day to the top as earlier weeks give it room", () => {
    // 20 → 14 newest first, two rows a day: the 14th's heading is the last but one row, so the browser clamps.
    const { rerender } = render(list(days(14, 20)));
    expect(headingTop(14)).toBeGreaterThan(0);
    rerender(list(days(7, 20)));
    expect(headingTop(14)).toBe(0);
  });

  it("waits for the nearest earlier day when every shown day is later than the selected one (Codex r4 on #584)", () => {
    // Selected the 14th; only the 15th–18th are shown at first.
    const { rerender } = render(list(days(15, 18)));
    rerender(list([...days(15, 18), ...days(5, 11)]));
    expect(headingTop(11)).toBe(0);
  });

  it("keeps what is in view in place when a block moves between two shown days above it (Codex r6 on #584)", () => {
    // 20 → 10, one block a day, and a second on the 14th; selected the 20th (the top).
    const second = entry("x14", new Date(2026, 9, 14, 15));
    const view = (moved: boolean) => list([...days(15, 20), ...(moved ? [entry("x14", new Date(2026, 9, 15, 15))] : []),
      ...(moved ? [] : [second]), ...days(10, 14)].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    { focusDayStartMs: new Date(2026, 9, 20).getTime(), focusRequest: "2026-10-20" });
    const { rerender } = render(view(false));
    const root = document.querySelector(".timeline-list-scroll")!;
    // The person scrolls the 14th's heading to the top; the List notes it on its next render.
    root.scrollTop += headingTop(14);
    rerender(view(false));
    expect(headingTop(14)).toBe(0);
    // The second block moves to the 15th: a row more above, a row fewer below, the same height.
    rerender(view(true));
    expect(headingTop(14)).toBe(0);
  });

  it("keeps the right day's copy of a place spanning midnight in place when its row remounts (Codex r7 on #584)", () => {
    const place = { kind: "place" as const, id: "overnight-place", status: "finalised" as const, startedAt: new Date(2026, 9, 13, 22).toISOString(),
      stoppedAt: new Date(2026, 9, 14, 2).toISOString(), placeId: null, learnedPlaceId: null, name: null, role: null, matchKind: "unknown" as const,
      confidence: "medium" as const, blockIds: [] };
    const dayOf = (date: number): LocationTimeline => ({ date: `2026-10-${date}`, timeZone: "", dayStart: new Date(2026, 9, date).toISOString(),
      dayEnd: new Date(2026, 9, date + 1).toISOString(), gaps: [], items: [place], openTrip: null });
    const view = (renamed: boolean) => (
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay
        continuous={{ error: null, focusDayStartMs: new Date(2026, 9, 20).getTime(), focusRequest: "2026-10-20", loading: null, onLoad: vi.fn(),
          reachedEarliest: false, reachedLatest: true }}
        entries={days(10, 20).map((row) => row.id === "d13" && renamed ? { ...row, description: "Renamed in place" } : row)}
        locationTimelines={[dayOf(13), dayOf(14)]}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    const { rerender } = render(view(false));
    const root = document.querySelector(".timeline-list-scroll")!;
    const older = () => document.querySelector<HTMLElement>(`tr[data-row-key="place-overnight-place@${new Date(2026, 9, 13).getTime()}"]`)!;
    expect(document.querySelectorAll('tr[data-location-row="overnight-place"]')).toHaveLength(2);
    root.scrollTop += older().getBoundingClientRect().top;
    rerender(view(false));
    expect(older().getBoundingClientRect().top).toBe(0);
    // The 13th's block is renamed: its group remounts, and with it the place row drawn in that group.
    rerender(view(true));
    expect(older().getBoundingClientRect().top).toBe(0);
  });

  it("keeps a \"?\" in place when its day's places replace its own row (Codex r8 on #584)", () => {
    const iso = (hour: number) => new Date(2026, 9, 14, hour).toISOString();
    const cafe = { kind: "place" as const, id: "seg-cafe", status: "finalised" as const, startedAt: iso(10), stoppedAt: iso(11), placeId: null,
      learnedPlaceId: null, name: null, role: null, matchKind: "unknown" as const, confidence: "medium" as const, blockIds: [] };
    const library = { ...cafe, id: "seg-library", startedAt: iso(13), stoppedAt: iso(14) };
    const question: ReviewItemRow = {
      id: "q-cafe", type: "suggestion", title: "Exampleton cafe", eventSource: "location_learning", eventType: "unknown_stay", projectName: null,
      categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null,
      suggestedStartedAt: iso(10), suggestedStoppedAt: iso(11), confidence: "medium", status: "open", notes: null,
      rawPayload: { clientSegmentId: "seg-cafe" }, createdAt: iso(12)
    };
    const fourteenth = { start: new Date(2026, 9, 14), end: new Date(2026, 9, 15) };
    const view = (timelines: LocationTimeline[]) => (
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay checksDays={[fourteenth]} locationTimelines={timelines}
        continuous={{ error: null, focusDayStartMs: new Date(2026, 9, 20).getTime(), focusRequest: "2026-10-20", loading: null, onLoad: vi.fn(),
          reachedEarliest: false, reachedLatest: true }}
        entries={days(10, 20)} reviewItems={[question]} onChanged={vi.fn(async () => undefined)}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    // Before the 14th's places arrive, the suggestion is a "?" row of its own.
    const { rerender } = render(view([]));
    expect(screen.getByRole("button", { name: /^Exampleton cafe, .+\. Needs a look$/ })).toBeTruthy();
    const open = () => document.querySelector<HTMLElement>('tr[data-suggestion-id="q-cafe"]')!;
    expect(open().dataset.locationRow).toBe("check-q-cafe");
    const root = document.querySelector(".timeline-list-scroll")!;
    root.scrollTop += open().getBoundingClientRect().top;
    rerender(view([]));
    expect(open().getBoundingClientRect().top).toBe(0);
    // The places arrive: the "?" moves onto the cafe's place row, and another place shows above it.
    rerender(view([{ date: "2026-10-14", timeZone: "", dayStart: fourteenth.start.toISOString(), dayEnd: fourteenth.end.toISOString(), gaps: [],
      items: [cafe, library], openTrip: null }]));
    expect(open().dataset.locationRow).toBe("seg-cafe");
    expect(open().getBoundingClientRect().top).toBe(0);
  });

  it("brings the first heading to the top too when the \"N to check\" chip sits above the table (Codex r9 on #584)", () => {
    const iso = (hour: number) => new Date(2026, 9, 14, hour).toISOString();
    const check: ReviewItemRow = {
      id: "q-sleep", type: "suggestion", title: "Sleep", eventSource: "health_sleep", eventType: "health_sleep_import_suggestion", projectName: null,
      categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null,
      suggestedStartedAt: iso(1), suggestedStoppedAt: iso(6), confidence: "medium", status: "open", notes: null, rawPayload: null, createdAt: iso(12)
    };
    render(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} groupByDay checksDays={[{ start: new Date(2026, 9, 14), end: new Date(2026, 9, 15) }]}
        continuous={{ error: null, focusDayStartMs: new Date(2026, 9, 20).getTime(), focusRequest: "2026-10-20", loading: null, onLoad: vi.fn(),
          reachedEarliest: false, reachedLatest: true }}
        entries={days(10, 20)} reviewItems={[check]} onChanged={vi.fn(async () => undefined)}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(document.querySelector(".timeline-checks-bar")).not.toBeNull();
    expect(headingTop(20)).toBe(0);
  });

  // Owner bug (29 Oct 2026): the header read "Fri, 23 Oct" while the List's top was Thu 29 Oct. The List reports the
  // day at its top and the header shows that day, so the two agree however the List got there.
  it("reports the day at its top: the selected day once it lands, the clamped top when it can't, and as it scrolls", async () => {
    const landed = vi.fn();
    render(list(days(7, 20), { onVisibleDay: landed }));
    expect(headingTop(14)).toBe(0);
    expect(landed).toHaveBeenLastCalledWith(new Date(2026, 9, 14).getTime());
    cleanup();

    // Too little below the selected day to bring it up, and no earlier week can come: the top day is reported.
    const clamped = vi.fn();
    render(list(days(14, 20), { onVisibleDay: clamped, reachedEarliest: true }));
    const root = document.querySelector(".timeline-list-scroll")!;
    const topDay = [20, 19, 18, 17, 16, 15, 14].filter((day) => headingTop(day) <= 48).at(-1)!;
    expect(clamped).toHaveBeenLastCalledWith(new Date(2026, 9, topDay).getTime());
    expect(topDay).not.toBe(14);

    // The person scrolls back to the top: the List says the 20th, newest first.
    fireEvent.wheel(root);
    root.scrollTop = 0;
    fireEvent.scroll(root);
    await waitFor(() => expect(clamped).toHaveBeenLastCalledWith(new Date(2026, 9, 20).getTime()));
  });

  it("names the selected day while the top is where it would be: today with nothing listed yet, not the day before", async () => {
    // Today is the 21st with no block; the List's newest heading is the 20th.
    const today = vi.fn();
    render(list(days(7, 20), { focusDayStartMs: new Date(2026, 9, 21).getTime(), focusRequest: "2026-10-21", onVisibleDay: today }));
    expect(today).toHaveBeenLastCalledWith(new Date(2026, 9, 21).getTime());
    // Scrolled down to an earlier day's heading: that day.
    const root = document.querySelector(".timeline-list-scroll")!;
    fireEvent.wheel(root);
    root.scrollTop = 600;
    fireEvent.scroll(root);
    const topDay = [20, 19, 18, 17, 16, 15, 14, 13].filter((day) => headingTop(day) <= 48).at(-1)!;
    expect(topDay).toBeLessThan(20);
    await waitFor(() => expect(today).toHaveBeenLastCalledWith(new Date(2026, 9, topDay).getTime()));
  });

  it("re-reads the top day after a layout change with no scroll: the shown day's last row removed (Codex r1 on #625)", async () => {
    const report = vi.fn();
    const { rerender } = render(list(days(7, 20), { onVisibleDay: report }));
    expect(report).toHaveBeenLastCalledWith(new Date(2026, 9, 14).getTime());
    // The person scrolls on to the 12th (a heading and a block a day, 100 px each, newest first).
    const root = document.querySelector(".timeline-list-scroll")!;
    fireEvent.wheel(root);
    root.scrollTop = (20 - 12) * 2 * ROW;
    fireEvent.scroll(root);
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(new Date(2026, 9, 12).getTime()));
    const scrolled = root.scrollTop;
    // The 12th's only block is deleted elsewhere (a refresh): the 11th now sits at the top, nothing scrolled.
    rerender(list(days(7, 20).filter((row) => row.id !== "d12"), { onVisibleDay: report }));
    expect(root.scrollTop).toBe(scrolled);
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(new Date(2026, 9, 11).getTime()));
  });

  it("finds the top day on a scroll without measuring every day heading (Codex r1 on #625)", async () => {
    const report = vi.fn();
    // 30 days loaded, newest first.
    render(list(days(1, 30), { focusDayStartMs: new Date(2026, 9, 30).getTime(), focusRequest: "2026-10-30", onVisibleDay: report }));
    const root = document.querySelector(".timeline-list-scroll")!;
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const headingsMeasured = () => measure.mock.contexts.filter((element) => (element as HTMLElement).dataset?.dayStartMs).length;
    fireEvent.wheel(root);
    root.scrollTop = 1_000;
    fireEvent.scroll(root);
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(new Date(2026, 9, 25).getTime()));
    // The scroll anchor's binary search may touch a few rows; the day lookup itself uses the cached offsets.
    expect(headingsMeasured()).toBeLessThanOrEqual(Math.ceil(Math.log2(60)) + 1);
    expect(headingsMeasured()).toBeLessThan(30);
    measure.mockRestore();
  });

  it("stops at the person's own scrolling, and when no earlier week can come", () => {
    const first = render(list(days(14, 20)));
    fireEvent.wheel(document.querySelector(".timeline-list-scroll")!);
    first.rerender(list(days(7, 20)));
    expect(headingTop(14)).toBeGreaterThan(0);
    first.unmount();

    const { rerender } = render(list(days(14, 20), { reachedEarliest: true }));
    const clamped = headingTop(14);
    rerender(list(days(13, 20), { reachedEarliest: true }));
    // Done when it couldn't grow: the anchor now holds what was in view.
    expect(headingTop(14)).toBe(clamped);
  });
});

describe("Calendar › List continuous edges", () => {
  afterEach(cleanup);

  it("loads the next week as either end nears the view, and says when it loads, fails or reaches the start", () => {
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe(element: Element) { observed.push(element); }
      disconnect() { observed.length = 0; }
      unobserve() {}
      takeRecords() { return []; }
    });
    const onLoad = vi.fn();
    const base = { error: null, focusDayStartMs: new Date(2026, 9, 21).getTime(), focusRequest: "2026-10-21", loading: null, onLoad, reachedEarliest: false, reachedLatest: false };
    const { rerender } = render(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} continuous={base} groupByDay
        entries={[entry("a", new Date(2026, 9, 21, 9)), entry("b", new Date(2026, 9, 20, 9))]}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(observed).toHaveLength(2);
    const later = observed.find((element) => element.closest("[data-list-edge='later']"))!;
    act(() => callback([{ isIntersecting: true, target: later } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(onLoad).toHaveBeenCalledWith("later");
    // Each day's heading carries its start, for scrolling to the selected day.
    expect(document.querySelectorAll("tr[data-day-start-ms]").length).toBe(2);

    rerender(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} continuous={{ ...base, loading: "earlier" }} groupByDay
        entries={[entry("a", new Date(2026, 9, 21, 9))]} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(screen.getByText("Loading earlier days…")).toBeTruthy();
    rerender(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} continuous={{ ...base, error: "earlier" }} groupByDay
        entries={[entry("a", new Date(2026, 9, 21, 9))]} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoad).toHaveBeenLastCalledWith("earlier");
    rerender(
      <EntriesTable capturedNow={new Date(2026, 9, 24, 12)} categories={[]} continuous={{ ...base, reachedEarliest: true, reachedLatest: true }} groupByDay
        entries={[entry("a", new Date(2026, 9, 21, 9))]} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(screen.getByText("No earlier blocks.")).toBeTruthy();
    expect(observed).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe("DatePickerPopover unavailable (Codex r2 on #584)", () => {
  afterEach(cleanup);

  it("closes a panel already open and takes no date once it doesn't apply", async () => {
    const onChange = vi.fn();
    const props = { label: "Thu, 1 Oct 2026", onChange, onOpenChange: vi.fn(), open: true, today: "2026-10-24", value: "2026-10-01" };
    const { rerender } = render(<DatePickerPopover {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    rerender(<DatePickerPopover {...props} unavailable="Not used in List" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    const trigger = screen.getByRole("button", { name: "Thu, 1 Oct 2026, not used in list" });
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SegmentedControl unavailable options", () => {
  afterEach(cleanup);

  it("keeps an option that doesn't apply visible and focusable, but inert, with its reason in its name", () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Calendar scope" onChange={onChange} value="day"
      options={[{ value: "day", label: "Day", unavailable: "Not used in List" }, { value: "week", label: "Week", unavailable: "Not used in List" }]} />);
    const week = screen.getByRole("button", { name: "Week, not used in list" });
    expect(week.getAttribute("aria-disabled")).toBe("true");
    expect((week as HTMLButtonElement).disabled).toBe(false);
    expect(week.getAttribute("data-tip")).toBe("Not used in List");
    fireEvent.click(week);
    expect(onChange).not.toHaveBeenCalled();
  });
});
