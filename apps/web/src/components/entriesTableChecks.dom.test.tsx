// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";
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

const { EntriesTable } = await import("./EntriesTable");

// Location v4 step 14: a synthetic day, made-up names and ids.
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 7, 11, hour, minute)).toISOString();
const PLACE = "00000000-0000-4000-8000-0000000000a1";
const TRIP = "00000000-0000-4000-8000-0000000000a2";
const SLEEP = "00000000-0000-4000-8000-0000000000a3";
const entry = (id: string, description: string, start: string, stop: string): TimeEntryRow => ({
  id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
  placeId: null, placeName: null, source: "manual_web", confidence: "1", reviewStatus: "accepted", description, startedAt: start, stoppedAt: stop,
  updatedAt: stop, durationSeconds: 1_800, tagNames: [], tags: []
});
const suggestion = (id: string, patch: Partial<ReviewItemRow>): ReviewItemRow => ({
  id, type: "suggestion", title: "Suggestion", eventSource: "location_learning", eventType: "unknown_stay", projectName: null, categoryName: null,
  categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: at(9),
  suggestedStoppedAt: at(10), confidence: "medium", status: "open", notes: null, rawPayload: null, createdAt: at(12), ...patch
});
const timeline: LocationTimeline = {
  date: "2026-08-11", timeZone: "UTC", dayStart: at(0), dayEnd: at(24), gaps: [], openTrip: null,
  items: [
    { kind: "place", id: "seg-office", status: "finalised", startedAt: at(9), stoppedAt: at(10), placeId: "p-office", learnedPlaceId: null,
      name: "Office", role: null, matchKind: "saved", confidence: "high", blockIds: [] },
    { kind: "trip", id: "seg-trip", status: "finalised", startedAt: at(10), stoppedAt: at(10, 30), fromId: "seg-office", toId: "seg-cafe",
      mode: "walking", stopIds: [], distanceMeters: 1_800, confidence: "medium", reason: null, blockIds: [], legs: [
        { startedAt: at(10), stoppedAt: at(10, 30), mode: "walking", confidence: "sure", distanceMeters: 1_800 }] },
    { kind: "place", id: "seg-cafe", status: "finalised", startedAt: at(10, 30), stoppedAt: at(11), placeId: null, learnedPlaceId: null,
      name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] }
  ]
};
const reviewItems = [
  suggestion(PLACE, { title: "Office", rawPayload: { clientSegmentId: "seg-office" } }),
  suggestion(TRIP, { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10), suggestedStoppedAt: at(10, 30),
    rawPayload: { clientSegmentId: "seg-trip" } }),
  suggestion(SLEEP, { title: "Sleep", eventSource: "health_sleep", eventType: "health_sleep_import_suggestion", suggestedStartedAt: at(1),
    suggestedStoppedAt: at(6) })
];

function renderList() {
  return render(
    <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={timeline} reviewItems={reviewItems}
      entries={[entry("planning", "Planning", at(11), at(11, 45))]} onChanged={vi.fn(async () => undefined)}
      onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
  );
}

describe("things to check in Calendar › List (location v4 step 14)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
      const envelope = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ ok: true, action: envelope.mutation.action, status: "accepted",
        clientMutationId: envelope.clientMutationId, reviewItemId: url.split("/").pop(), entryIds: ["e1"] }), { status: 200 });
    });
    Element.prototype.scrollIntoView ??= () => undefined;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("puts each open suggestion on the day's row it is about, and counts them", async () => {
    renderList();
    expect(await screen.findByRole("button", { name: "3 to check" })).toBeTruthy();
    // The saved place shows because it has a suggestion; the trip and Apple Health have rows of their own.
    expect(screen.getByRole("button", { name: "Check Office" })).toBeTruthy();
    expect(screen.getByLabelText("Office → Unknown place. Legs: Walk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check Sleep" })).toBeTruthy();
  });

  it("answers a place's question with the deck's own decision, held for Undo, then saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Check Office" }));
    expect(screen.getByRole("group", { name: /^Where were you, \d\d:00–\d\d:00\?$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log Office" }));
    expect(screen.getByText("Logged Office")).toBeTruthy();
    expect(clientFetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(clientFetch.mock.calls[0][0]).toBe(`/api/review/${PLACE}`);
    expect(JSON.parse(clientFetch.mock.calls[0][1].body).mutation).toEqual({ action: "confirm" });
  });

  it("brings a skipped suggestion back with Undo and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Check Sleep" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("button", { name: "Check Sleep" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check Sleep" })).toBeTruthy();
  });

  it("moves from one check to the next with the chip", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "3 to check" }));
    expect(screen.getAllByRole("group").length).toBe(1);
    const first = screen.getAllByRole("group")[0].getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "3 to check" }));
    expect(screen.getAllByRole("group")[0].getAttribute("aria-label")).not.toBe(first);
  });
  it("folds an outing onto its stay, says what the answer covers, and decides them together (Codex r1 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const outing = [
      suggestion("00000000-0000-4000-8000-0000000000b1", { title: "Unknown place", suggestedStartedAt: at(10, 30), suggestedStoppedAt: at(11),
        rawPayload: { clientSegmentId: "seg-cafe", outingKey: "o1", outingRole: "stay" } }),
      suggestion("00000000-0000-4000-8000-0000000000b2", { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10),
        suggestedStoppedAt: at(10, 30), rawPayload: { clientSegmentId: "seg-trip", outingKey: "o1", outingRole: "in" } })
    ];
    render(
      <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={timeline} reviewItems={outing}
        entries={[]} onChanged={vi.fn(async () => undefined)} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(screen.getByRole("button", { name: "1 to check" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    expect(screen.getByText(/With its trips: .*Your answer covers them too\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(JSON.parse(clientFetch.mock.calls[0][1].body).mutation).toEqual({ action: "ignore_outing", memberReviewItemIds: [outing[1].id] });
  });

  it("brings an answered card back with Undo even after a refresh dropped it, and moves focus on (Codex r1 on #568)", async () => {
    const props = { capturedNow: new Date(at(12)), categories: [], groupByDay: true, locationTimeline: timeline, entries: [],
      onChanged: vi.fn(async () => undefined), onDeleteEntries: vi.fn(), onScroll: vi.fn(), scrollContainerRef: vi.fn(), tags: [] };
    const { rerender } = render(<EntriesTable {...props} reviewItems={reviewItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.checkKey).toBeTruthy());
    // A refresh no longer lists it (capped, or decided elsewhere meanwhile); Undo still brings it back.
    rerender(<EntriesTable {...props} reviewItems={reviewItems.filter((item) => item.id !== PLACE)} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Check Office" })).toBeTruthy();
  });

  it("keeps Apple Health's check when the location read failed (Codex r1 on #568)", async () => {
    render(
      <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={null} reviewItems={reviewItems}
        checksDay={{ start: new Date(at(0)), end: new Date(at(24)) }}
        entries={[entry("planning", "Planning", at(11), at(11, 45))]} onChanged={vi.fn(async () => undefined)} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(await screen.findByRole("button", { name: "Check Sleep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3 to check" })).toBeTruthy();
  });
});
