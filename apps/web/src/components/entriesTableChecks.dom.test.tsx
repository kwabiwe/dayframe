// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

const search = vi.hoisted(() => ({ params: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.params)
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ clearTimerError: vi.fn(), isTimerBusy: false, startEntryAgain: vi.fn(), updateActiveEntryFromCalendar: vi.fn() })
}));
const clientFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));

// The trip editor stands in for the location editor: its Close, and a save the test finishes when it chooses.
const editors = vi.hoisted(() => ({ resolve: new Map<string, () => void>() }));
vi.mock("@/components/location/LocationReviewPanel", () => ({
  LocationReviewPanel: ({ reviewItemId, onClose, onResolved }: { reviewItemId: string; onClose: () => void; onResolved?: () => void }) => {
    // As the real editor does: a save resolves, then closes.
    editors.resolve.set(reviewItemId, () => {
      onResolved?.();
      onClose();
    });
    return (
      <div data-editor-for={reviewItemId}>
        <input aria-label={`Name for ${reviewItemId}`} />
        <button aria-label="Close location evidence" onClick={onClose} type="button">×</button>
      </div>
    );
  }
}));

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

// A reply that passes the acknowledgement check for what was sent (Codex r2 on #568).
function acknowledge(url: string, init: RequestInit) {
  const envelope = JSON.parse(init.body as string);
  const reviewItemId = url.split("/").pop() as string;
  const action = envelope.mutation.action as string;
  const base = { ok: true, action, clientMutationId: envelope.clientMutationId, reviewItemId };
  if (action === "confirm_outing" || action === "ignore_outing") {
    const ids = [reviewItemId, ...envelope.mutation.memberReviewItemIds];
    return { ...base, reviewItemIds: ids, status: action === "ignore_outing" ? "ignored" : "accepted",
      ...(action === "confirm_outing" ? { entryIds: ids.map((id) => `entry-${id}`) } : {}) };
  }
  return action.startsWith("ignore") ? { ...base, status: "ignored" } : { ...base, status: "accepted", entryId: `entry-${reviewItemId}` };
}

function renderList() {
  return render(
    <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={timeline} reviewItems={reviewItems}
      entries={[entry("planning", "Planning", at(11), at(11, 45))]} onChanged={vi.fn(async () => undefined)}
      onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
  );
}

const baseProps = () => ({ capturedNow: new Date(at(12)), categories: [], groupByDay: true, locationTimeline: timeline, entries: [],
  onChanged: vi.fn(async () => undefined), onDeleteEntries: vi.fn(), onScroll: vi.fn(), scrollContainerRef: vi.fn(), tags: [] });

describe("things to check in Calendar › List (location v4 step 14)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
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
    // Saved, not rolled back: the "?" stays away and no error shows.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("button", { name: "Check Office" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("asks a trip by its title with Yes, Edit and Not now; Edit opens its editor under the question (card A)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // The editor's evidence stays loading here: it only has to open and close.
    clientFetch.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST" || init?.body
      ? new Response(JSON.stringify(acknowledge(url, init as RequestInit)), { status: 200 }) : new Promise(() => undefined));
    const trip = { ...reviewItems[1], title: "Getting around" };
    render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[0], trip, reviewItems[2]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Getting around" }));
    expect(screen.getByRole("group", { name: /^Getting around, \d\d:00–\d\d:30\?$/ })).toBeTruthy();
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(edit);
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(`[data-editor-for="${TRIP}"]`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close location evidence" }));
    expect(screen.queryByRole("button", { name: "Close location evidence" })).toBeNull();
    // Focus goes back to Edit (Codex r1 on #590).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
    // Closing the question closes its editor: reopening it shows the question alone (Codex r1 on #590).
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Getting around" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Getting around" }));
    expect(screen.queryByRole("button", { name: "Close location evidence" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-expanded")).toBe("false");
    // Yes logs it as the deck's Log it does.
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    const posted = clientFetch.mock.calls.find(([url, init]) => url === `/api/review/${TRIP}` && init?.body);
    expect(JSON.parse(posted![1].body).mutation).toEqual({ action: "confirm" });
  });

  it("lets a save that finishes late leave another trip's open editor alone (Codex r2 on #590)", () => {
    editors.resolve.clear();
    const other = { ...reviewItems[1], id: "00000000-0000-4000-8000-0000000000a4", title: "Getting around",
      suggestedStartedAt: at(11), suggestedStoppedAt: at(11, 30), rawPayload: { clientSegmentId: "seg-other" } };
    const trip = { ...reviewItems[1], title: "Getting around" };
    render(<EntriesTable {...baseProps()} reviewItems={[trip, other]} />);
    const checks = () => screen.getAllByRole("button", { name: "Check Getting around" });
    expect(checks()).toHaveLength(2);
    fireEvent.click(checks()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const opened = [...editors.resolve.keys()];
    const firstId = opened[0];
    const secondId = firstId === TRIP ? other.id : TRIP;
    const finishFirst = editors.resolve.get(firstId)!;
    // The person moves on to the other trip and starts editing it.
    fireEvent.click(checks()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(`Name for ${secondId}`), { target: { value: "Shop run" } });
    act(() => finishFirst());
    expect((screen.getByLabelText(`Name for ${secondId}`) as HTMLInputElement).value).toBe("Shop run");
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("asks a round trip from a place as a trip too, with Yes and Edit (Codex r1 on #590)", () => {
    const round = { ...reviewItems[1], title: "Getting around", rawPayload: { clientSegmentId: "seg-trip", qualificationReason: "same_place_outing" } };
    render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[0], round, reviewItems[2]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Getting around" }));
    expect(screen.getByRole("group", { name: /^Getting around, \d\d:00–\d\d:30\?$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
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
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("button", { name: "Check Unknown place" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("keeps a revived card away once it is answered again and saved (Codex r2 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Sleep" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    const withoutSleep = reviewItems.filter((item) => item.id !== SLEEP);
    rerender(<EntriesTable {...baseProps()} reviewItems={withoutSleep} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Check Sleep" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    rerender(<EntriesTable {...baseProps()} reviewItems={[...withoutSleep]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("button", { name: "Check Sleep" })).toBeNull();
  });

  it("brings back only the outing's cards the server says are still open (Codex r2 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const stay = suggestion("00000000-0000-4000-8000-0000000000b1", { title: "Unknown place", suggestedStartedAt: at(10, 30), suggestedStoppedAt: at(11),
      rawPayload: { clientSegmentId: "seg-cafe", outingKey: "o1", outingRole: "stay" } });
    const walk = suggestion("00000000-0000-4000-8000-0000000000b2", { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10),
      suggestedStoppedAt: at(10, 30), rawPayload: { clientSegmentId: "seg-trip", outingKey: "o1", outingRole: "in" } });
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "open", [walk.id]: "accepted" } }), { status: 409 }));
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    // The refresh after the answer no longer lists either card.
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // The stay comes back on its own: the accepted trip is not folded into the next answer.
    expect(screen.getByRole("button", { name: "Check Unknown place" })).toBeTruthy();
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    expect(screen.queryByText(/With its trips/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(JSON.parse(clientFetch.mock.calls.at(-1)?.[1].body).mutation.action).not.toBe("ignore_outing");
  });

  it("moves focus to the List when the last question is answered (Codex r2 on #568)", async () => {
    const { container } = render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[2]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Sleep" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(".timeline-list-scroll")));
  });

  it("brings a refused answer back through the List's transition (Codex r2 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const startViewTransition = vi.fn((update: () => void) => { update(); });
    Object.assign(document, { startViewTransition });
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
    try {
      clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: "Nope" }), { status: 500 }));
      render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
      fireEvent.click(screen.getByRole("button", { name: "Check Sleep" }));
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      const before = startViewTransition.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole("button", { name: "Check Sleep" })).toBeTruthy();
      expect(startViewTransition.mock.calls.length).toBeGreaterThan(before);
    } finally {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  const outingPair = () => [
    suggestion("00000000-0000-4000-8000-0000000000b1", { title: "Unknown place", suggestedStartedAt: at(10, 30), suggestedStoppedAt: at(11),
      rawPayload: { clientSegmentId: "seg-cafe", outingKey: "o1", outingRole: "stay" } }),
    suggestion("00000000-0000-4000-8000-0000000000b2", { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10),
      suggestedStoppedAt: at(10, 30), rawPayload: { clientSegmentId: "seg-trip", outingKey: "o1", outingRole: "in" } })
  ];

  it("keeps a revived outing's trip away once the outing is answered again and saved (Codex r3 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("button", { name: "Check Walk" })).toBeNull();
    expect(screen.queryByRole("button", { name: /to check$/ })).toBeNull();
  });

  it("drops server-decided cards from stale data before grouping the outing (Codex r3 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "open", [walk.id]: "accepted" } }), { status: 409 }));
    // No replacement data arrives: the stale bootstrap still lists both.
    render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    const last = JSON.parse(clientFetch.mock.calls.at(-1)?.[1].body).mutation;
    expect(last.action).not.toBe("ignore_outing");
  });

  it("shows an open trip on its own when the server says its stay is decided (Codex r3 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "accepted", [walk.id]: "open" } }), { status: 409 }));
    render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Unknown place" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("button", { name: "Check Unknown place" })).toBeNull();
    expect(screen.getByRole("button", { name: "1 to check" })).toBeTruthy();
  });

  it("opens the first question from Today's link, focuses it, and keeps it open when the day's places arrive (Codex r1 on #572)", async () => {
    search.params = "check=first";
    try {
      const office = reviewItems[0];
      const props = { ...baseProps(), checksDay: { start: new Date(at(0)), end: new Date(at(24)) } };
      // The location read has not arrived: the suggestion sits on a row of its own.
      const { rerender } = render(<EntriesTable {...props} locationTimeline={null} reviewItems={[office]} />);
      await waitFor(() => expect(screen.getByRole("group", { name: /^Where were you/ })).toBeTruthy());
      await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.checkKey).toBeTruthy());
      // The places arrive: the question moves onto the place's row and stays open.
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={[office]} />);
      expect(screen.getByRole("group", { name: /^Where were you/ })).toBeTruthy();
      // Focus moves with it to the place row's "?" (Codex r2 on #572).
      await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Check Office"));
      // Closing it is final for this visit: it does not open again.
      fireEvent.click(screen.getByRole("button", { name: "Check Office" }));
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={[office]} />);
      expect(screen.queryByRole("group", { name: /^Where were you/ })).toBeNull();
    } finally {
      search.params = "";
    }
  });
});

