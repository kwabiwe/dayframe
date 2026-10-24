// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@/lib/location/location-timeline-service";
import type { TimeEntryRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ clearTimerError: vi.fn(), isTimerBusy: false, startEntryAgain: vi.fn(), updateActiveEntryFromCalendar: vi.fn() })
}));
const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));

const { useCalendarListWeeks, LIST_EMPTY_WEEKS_BEFORE_END } = await import("./useCalendarListWeeks");
const { useLocationTimelines, LOCATION_TIMELINE_CONCURRENCY } = await import("./location/LocationListRows");
const { EntriesTable } = await import("./EntriesTable");
const { SegmentedControl } = await import("./ui/Primitives");

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
    expect(at("not in a block")).toBeGreaterThan(thursdayHeading);
    expect(at("not in a block")).toBeLessThan(at("Block wednesday"));
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
