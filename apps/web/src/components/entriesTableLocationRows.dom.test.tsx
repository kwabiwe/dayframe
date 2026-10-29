// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const { EntriesTable } = await import("./EntriesTable");
const { useLocationTimeline } = await import("./location/LocationListRows");
const { formatTime } = await import("@/lib/format");

// Location v4 step 10: synthetic day, made-up names.
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 7, 11, hour, minute)).toISOString();
const entry = (id: string, description: string, start: string, stop: string): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: id === "trip-block" ? "location_learning" : "manual_web", confidence: "1",
  reviewStatus: "accepted", description, startedAt: start, stoppedAt: stop, updatedAt: stop, durationSeconds: 1_800, tagNames: [], tags: []
});
const timeline: LocationTimeline = {
  date: "2026-08-11", timeZone: "UTC", dayStart: at(0), dayEnd: at(24), gaps: [],
  items: [
    { kind: "place", id: "home", status: "finalised", startedAt: at(0), stoppedAt: at(8), placeId: "p-home", learnedPlaceId: null,
      name: "Home", role: "home", matchKind: "saved", confidence: "high", blockIds: [] },
    { kind: "trip", id: "trip", status: "finalised", startedAt: at(8), stoppedAt: at(8, 40), fromId: "home", toId: "cafe", mode: "automotive",
      stopIds: [], distanceMeters: 12_000, confidence: "medium", reason: null, blockIds: ["trip-block"], legs: [
        { startedAt: at(8), stoppedAt: at(8, 10), mode: "walking", confidence: "sure", distanceMeters: 700 },
        { startedAt: at(8, 12), stoppedAt: at(8, 40), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: 11_000 }] },
    { kind: "place", id: "cafe", status: "finalised", startedAt: at(8, 40), stoppedAt: at(10), placeId: null, learnedPlaceId: null,
      name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] }
  ],
  openTrip: { kind: "open_trip", fromId: "cafe", startedAt: at(10), lastObservedAt: at(11, 50), mode: "walking", legs: [] }
};

function renderList(locationTimeline: LocationTimeline | null) {
  return render(
    <EntriesTable capturedNow={new Date(at(11, 55))} categories={[]} groupByDay locationTimeline={locationTimeline}
      // Newest first, as bootstrap sends them.
      entries={[entry("planning", "Planning", at(11), at(11, 30)), entry("trip-block", "Getting around", at(8), at(8, 40))]}
      onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
  );
}

describe("Calendar › List location rows (location v4 step 10)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("adds the journey in progress and an unlogged unknown place in time order, newest first, beside the blocks", async () => {
    renderList(timeline);
    const rows = await screen.findAllByRole("row");
    const text = rows.map((row) => row.textContent ?? "");
    const index = (needle: string) => text.findIndex((value) => value.includes(needle));
    const unknown = text.findIndex((value) => value.startsWith("Unknown place"));
    expect(index("Planning")).toBeLessThan(index("Travelling since"));
    expect(index("Travelling since")).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(index("Getting around"));
    // Card B: the row names the place and its times; no "not in a block" line.
    expect(text.some((value) => value.includes("not in a block"))).toBe(false);
    expect(text[index("Travelling since")]).toContain("Logs when you arrive");
    expect(screen.queryByText(/Home ·/)).toBeNull();
  });

  it("shows a trip block's route and legs, opening into leg rows", async () => {
    renderList(timeline);
    expect((await screen.findByLabelText(/Home → Unknown place\. Legs: Walk, Underground or train\?/)).textContent).toContain("Underground?");
    fireEvent.click(screen.getByRole("button", { name: "Show the legs of Getting around" }));
    expect(screen.getByRole("list", { name: "Legs" }).textContent).toContain("Underground or train? · 28m");
    expect(screen.getByRole("list", { name: "Legs" }).textContent).toContain("no GPS underground, guessed from the gap");
  });

  it("shows Home and other quiet places only with All places, a quiet filter at the top, remembered on this device (owner item H)", async () => {
    const first = renderList(timeline);
    const toggle = await screen.findByRole("button", { name: "All places" });
    expect(toggle.closest(".timeline-places-filter")).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Home, / })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: `Home, ${formatTime(at(0), "24h")}–${formatTime(at(8), "24h")}` })).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toBe("Fewer places");
    expect(window.localStorage.getItem("dayframe.calendar.showAllPlaces")).toBe("1");
    // Opened again on this device, the List keeps every place.
    first.unmount();
    renderList(timeline);
    expect((await screen.findByRole("button", { name: "Fewer places" })).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Home, / })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fewer places" }));
    expect(window.localStorage.getItem("dayframe.calendar.showAllPlaces")).toBe("0");
    expect(screen.queryByRole("button", { name: /^Home, / })).toBeNull();
  });

  it("is the List as before without a timeline", async () => {
    renderList(null);
    await screen.findByText("Planning");
    expect(screen.queryByText(/Travelling since/)).toBeNull();
    expect(screen.queryByRole("button", { name: "All places" })).toBeNull();
  });
  it("keeps the legs of grouped trips, and places a row among an expanded group's occurrences in time order (Codex r1 on #565)", async () => {
    const day: LocationTimeline = { ...timeline, openTrip: null, items: [
      { ...timeline.items[1], blockIds: ["trip-a", "trip-b"] } as LocationTimeline["items"][number],
      { kind: "place", id: "shop", status: "finalised", startedAt: at(9), stoppedAt: at(9, 40), placeId: null, learnedPlaceId: null,
        name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] }] };
    render(
      <EntriesTable capturedNow={new Date(at(11, 55))} categories={[]} groupByDay locationTimeline={day}
        entries={[entry("trip-a", "Getting around", at(11), at(11, 30)), entry("trip-b", "Getting around", at(8), at(8, 40))]}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Expand 2 Getting around blocks" }));
    expect(screen.getAllByRole("button", { name: /Show the legs of Getting around/ })).toHaveLength(2);
    const text = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    // The occurrences, newest first: the 11:00 trip (30 minutes), then the 08:00 one (40 minutes).
    const occurrences = text.flatMap((value, index) => value.startsWith("Getting around") && !value.includes("occurrences") ? [index] : []);
    expect(occurrences).toHaveLength(2);
    const [at11, at08] = occurrences;
    expect(text[at11]).toMatch(/30m$/);
    const shop = text.findIndex((value) => value.startsWith("Unknown place"));
    expect(at11).toBeLessThan(shop);
    expect(shop).toBeLessThan(at08);
  });

  it("never shows a place your blocks cover, even with All places, and shows a place clipped to the day from midnight (Codex r1 on #565)", async () => {
    const day: LocationTimeline = { ...timeline, openTrip: null, items: [
      { kind: "place", id: "overnight", status: "finalised", startedAt: new Date(Date.parse(at(0)) - 3_600_000).toISOString(), stoppedAt: at(1),
        placeId: "p-friend", learnedPlaceId: null, name: "Friend's", role: null, matchKind: "saved", confidence: "high", blockIds: [] },
      { kind: "place", id: "office", status: "finalised", startedAt: at(11), stoppedAt: at(11, 30), placeId: "p-office", learnedPlaceId: null,
        name: "Office", role: null, matchKind: "saved", confidence: "high", blockIds: [] }] };
    render(
      <EntriesTable capturedNow={new Date(at(11, 55))} categories={[]} groupByDay locationTimeline={day}
        entries={[entry("planning", "Planning", at(11), at(11, 30))]}
        onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    fireEvent.click(await screen.findByRole("button", { name: "All places" }));
    // Planning covers the Office visit: the block's place line stands for it (owner, 28 Oct 2026, concern 2).
    expect(screen.queryByText("Office")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Office, / })).toBeNull();
    // From the day's start, in the viewer's zone, not from the evening before; start over end.
    const friends = screen.getByRole("button", { name: `Friend's, ${formatTime(at(0), "24h")}–${formatTime(at(1), "24h")}` });
    expect([...friends.querySelectorAll(".timeline-location-span.is-stacked > span")].map((time) => time.textContent))
      .toEqual([formatTime(at(0), "24h"), formatTime(at(1), "24h")]);
  });

  it("keeps the legs row while it closes, then removes it (Codex r1 on #565)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      renderList(timeline);
      const toggle = screen.getByRole("button", { name: "Show the legs of Getting around" });
      fireEvent.click(toggle);
      act(() => { vi.advanceTimersByTime(40); });
      expect(document.querySelector(".timeline-trip-legs-wrap")?.getAttribute("data-open")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Hide the legs of Getting around" }));
      act(() => { vi.advanceTimersByTime(40); });
      expect(document.querySelector(".timeline-trip-legs-wrap")?.getAttribute("data-open")).toBe("false");
      act(() => { vi.advanceTimersByTime(300); });
      expect(document.querySelector(".timeline-trip-legs-wrap")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows one workspace's places in another while it loads or when it fails (Codex r1 on #565)", async () => {
    clientFetch.mockReset();
    clientFetch.mockResolvedValueOnce({ ok: true, json: async () => timeline });
    const { result, rerender } = renderHook(({ owner }) => useLocationTimeline("2026-08-11", "data", owner), { initialProps: { owner: "w1:u1" } });
    await waitFor(() => expect(result.current?.date).toBe("2026-08-11"));
    clientFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    rerender({ owner: "w2:u1" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
    expect(clientFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("opens a correction for a place not in a block and for a leg (location v4 step 13)", async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
    // The dialog reads the place's map when it opens.
    clientFetch.mockReset().mockResolvedValue({ ok: false, json: async () => ({}) });
    renderList(timeline);
    // The whole row is the button that opens it (owner item A); there is no separate Correct button.
    expect(screen.queryByRole("button", { name: /^Correct / })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /^Unknown place, / }));
    expect(screen.getByRole("radiogroup", { name: "Where were you?" })).toBeTruthy();
    expect(clientFetch.mock.calls.some(([url]) => String(url).startsWith("/api/timeline/items/cafe/evidence?kind=place"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Show the legs of Getting around" }));
    fireEvent.click(screen.getByRole("button", { name: /Change how you travelled: Underground or train\?/ }));
    expect(screen.getByRole("group", { name: "How did you travel?" })).toBeTruthy();
  });
});
