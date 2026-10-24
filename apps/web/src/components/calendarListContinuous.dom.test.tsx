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
