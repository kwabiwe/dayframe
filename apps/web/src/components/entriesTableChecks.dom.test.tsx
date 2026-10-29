// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

const search = vi.hoisted(() => ({ params: "" }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.params)
}));
vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => ({ clearTimerError: vi.fn(), isTimerBusy: false, startEntryAgain: vi.fn(), updateActiveEntryFromCalendar: vi.fn() })
}));
const clientFetch = vi.hoisted(() => vi.fn());
// A place's or trip's dialog reads its map from the evidence route as it opens: those reads have their own
// mock (the map stays unavailable here), so `clientFetch` sees only the answers the List sends.
const evidenceFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (url: string, init?: RequestInit) => url.includes("/evidence?") ? evidenceFetch(url, init) : clientFetch(url, init)
}));
// The viewer's local midnight, which anchors the 7 days a "?" asks (owner, 28 Oct 2026); set per test.
const clock = vi.hoisted(() => ({ todayStartMs: 0 }));
vi.mock("@/components/useCalendarClock", () => ({ useLocalDayStartMs: () => clock.todayStartMs, useMediaQuery: () => false }));

const { EntriesTable } = await import("./EntriesTable");
const { CheckDecisionsProvider, useListChecks, useProjectedReviewItems } = await import("./location/ListChecks");
const { askingChecks } = await import("@/lib/calendar-checks");
const { useGridCorrection } = await import("./location/useGridCorrection");

/** What AppShell's badge and Today's chip count: the decisions owner's items, as the List shows them. */
function Badge() {
  const items = useProjectedReviewItems([]);
  return <output data-testid="badge">{askingChecks(items, clock.todayStartMs).length}</output>;
}
/** The AppShell's decisions owner for one workspace and user, with the badge beside whatever it shows. */
function Shell({ children, items, owner = "w1:u1", refresh = async () => undefined }: {
  children: React.ReactNode; items: readonly ReviewItemRow[]; owner?: string; refresh?: () => Promise<unknown>;
}) {
  return (
    <CheckDecisionsProvider categories={[]} owner={owner} refresh={refresh} reviewItems={items}>
      <Badge />
      {children}
    </CheckDecisionsProvider>
  );
}
const badge = () => Number(screen.getByTestId("badge").textContent);
/** Saves wait until the test answers them, with an acknowledgement unless told otherwise. */
function holdSaves(reply?: Response) {
  const held: Array<() => void> = [];
  clientFetch.mockImplementation((url: string, init: RequestInit) => new Promise<Response>((resolve) => {
    held.push(() => resolve(reply ?? new Response(JSON.stringify(acknowledge(url, init)), { status: 200 })));
  }));
  return { answer: () => held.splice(0).forEach((resolve) => resolve()) };
}

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

const outingPair = () => [
  suggestion("00000000-0000-4000-8000-0000000000b1", { title: "Unknown place", suggestedStartedAt: at(10, 30), suggestedStoppedAt: at(11),
    rawPayload: { clientSegmentId: "seg-cafe", outingKey: "o1", outingRole: "stay" } }),
  suggestion("00000000-0000-4000-8000-0000000000b2", { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10),
    suggestedStoppedAt: at(10, 30), rawPayload: { clientSegmentId: "seg-trip", outingKey: "o1", outingRole: "in" } })
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

function renderList(items: readonly ReviewItemRow[] = reviewItems) {
  return render(
    <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={timeline} reviewItems={items}
      entries={[entry("planning", "Planning", at(11), at(11, 45))]} onChanged={vi.fn(async () => undefined)}
      onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
  );
}

const baseProps = () => ({ capturedNow: new Date(at(12)), categories: [], groupByDay: true, locationTimeline: timeline, entries: [],
  onChanged: vi.fn(async () => undefined), onDeleteEntries: vi.fn(), onScroll: vi.fn(), scrollContainerRef: vi.fn(), tags: [] });

/** The local midnight of the day `iso` falls on. */
function localDayStart(iso: string) {
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// The rows: each is one button, named by what it is and its times, "Needs a look" while it asks (owner item A).
const officeRow = () => screen.queryByRole("button", { name: /^Office, .+\. Needs a look$/ });
const sleepRow = () => screen.queryByRole("button", { name: /^Sleep, .+\. Needs a look$/ });
const askingRow = (title: string) => screen.queryByRole("button", { name: new RegExp(`^${title}, .+\\. Needs a look$`) });
const chip = (count: number) => screen.getByRole("button", { name: `${count} to check, oldest first` });
const dialog = () => screen.queryByRole("dialog");

describe("things to check in Calendar › List (location v4 step 14)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    evidenceFetch.mockReset().mockResolvedValue(new Response("{}", { status: 404 }));
    router.push.mockReset();
    clock.todayStartMs = localDayStart(at(12));
    Element.prototype.scrollIntoView ??= () => undefined;
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("puts each open suggestion on the day's row it is about, and counts them", async () => {
    renderList();
    expect((await screen.findByRole("button", { name: "3 to check, oldest first" })).textContent).toBe("3 to check");
    // The saved place shows because it has a suggestion; the trip and Apple Health have rows of their own.
    // Each mark is the row's own icon with the amber dot; there is no separate "Check …" toggle (owner concern 1).
    for (const row of [officeRow(), askingRow("Walk"), sleepRow()]) {
      expect(row?.querySelector(".timeline-location-mark .timeline-location-dot")).toBeTruthy();
    }
    expect(screen.getByLabelText("Office → Unknown place. Legs: Walk")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Check / })).toBeNull();
    // The place nobody asks about has no dot.
    expect(screen.getByRole("button", { name: /^Unknown place, / }).querySelector(".timeline-location-dot")).toBeNull();
    // Times are stacked, start over end (owner item D).
    expect(officeRow()?.querySelectorAll(".timeline-location-span.is-stacked > span")).toHaveLength(2);
  });

  it("answers a place's question with the deck's own decision, held for Undo, then saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    renderList();
    // Owner item A: the row opens the place's dialog with its "?" asked at the top, Yes and Not now.
    fireEvent.click(officeRow()!);
    const opened = dialog()!;
    const asked = within(opened).getByRole("group", { name: "Visited Office?" });
    expect(asked.parentElement?.firstElementChild).toBe(asked);
    // The dialog says its times; the question doesn't repeat them or "not in a block".
    expect(opened.textContent).toMatch(/\d\d:00–\d\d:00/);
    expect(asked.textContent).not.toContain("not in a block");
    // A row that opens a dialog never shows the inline question card too (owner final change 1).
    expect(document.querySelector(".timeline-check-question")).toBeNull();
    fireEvent.click(within(asked).getByRole("button", { name: "Yes" }));
    expect(dialog()).toBeNull();
    expect(screen.getByText("Logged Office")).toBeTruthy();
    expect(clientFetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(clientFetch.mock.calls[0][0]).toBe(`/api/review/${PLACE}`);
    expect(JSON.parse(clientFetch.mock.calls[0][1].body).mutation).toEqual({ action: "confirm" });
    // Saved, not rolled back: the "?" stays away and no error shows.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(officeRow()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("answers a confident guess with the row's own Yes pill, held for Undo (owner item B)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    renderList();
    const yes = officeRow()!.closest("tr")!.querySelector<HTMLButtonElement>(".timeline-row-yes")!;
    expect(yes.textContent).toBe("Yes");
    // The trip asks confidently too; Apple Health has no pill (its question has its own answers).
    expect(askingRow("Walk")!.closest("tr")!.querySelector(".timeline-row-yes")).toBeTruthy();
    expect(sleepRow()!.closest("tr")!.querySelector(".timeline-row-yes")).toBeNull();
    fireEvent.click(yes);
    expect(dialog()).toBeNull();
    expect(screen.getByText("Logged Office")).toBeTruthy();
    expect(officeRow()).toBeNull();
    // Undo brings it back and nothing is sent.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(officeRow()).toBeTruthy();
    fireEvent.click(officeRow()!.closest("tr")!.querySelector<HTMLButtonElement>(".timeline-row-yes")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(clientFetch.mock.calls[0][0]).toBe(`/api/review/${PLACE}`);
    expect(JSON.parse(clientFetch.mock.calls[0][1].body).mutation).toEqual({ action: "confirm" });
  });

  it("asks Apple Health under its row with compact pills, and never puts a card under a place row", () => {
    renderList();
    const row = sleepRow()!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(dialog()).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const asked = screen.getByRole("group", { name: /^Sleep, .+\?$/ });
    expect(asked.closest("tr")?.previousElementSibling).toBe(row.closest("tr"));
    for (const answer of within(asked).getAllByRole("button")) expect(answer.className).toContain("is-compact");
    // The question cards under rows are Apple Health's alone: the place row opens its dialog instead.
    expect(document.querySelectorAll(".timeline-check-question")).toHaveLength(1);
    fireEvent.click(officeRow()!);
    expect(dialog()).toBeTruthy();
    expect(document.querySelector(`[data-question-for="${PLACE}"]`)).toBeNull();
  });

  it("brings a skipped suggestion back with Undo and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    renderList();
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(sleepRow()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).not.toHaveBeenCalled();
    expect(sleepRow()).toBeTruthy();
  });

  it("asks a trip by its title at the top of its own dialog, with Yes and Not now above its legs and fixes (card A)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const trip = { ...reviewItems[1], title: "Getting around" };
    render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[0], trip, reviewItems[2]]} />);
    fireEvent.click(askingRow("Getting around")!);
    const opened = screen.getByRole("dialog", { name: "Office → Unknown place" });
    const asked = within(opened).getByRole("group", { name: /^Getting around, \d\d:00–\d\d:30\?$/ });
    expect(within(asked).getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(within(asked).getByRole("button", { name: "Not now" })).toBeTruthy();
    // The trip's own dialog: its legs and its fixes (the editor it had under the question is gone).
    expect(within(opened).getByRole("group", { name: "Legs" })).toBeTruthy();
    expect(within(opened).getByRole("button", { name: "I didn't leave" })).toBeTruthy();
    expect(within(opened).getByRole("button", { name: "This wasn't a trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(evidenceFetch.mock.calls[0][0]).toMatch(/^\/api\/timeline\/items\/seg-trip\/evidence\?kind=trip&startedAt=/);
    // Yes logs it as the deck's Log it does.
    fireEvent.click(within(asked).getByRole("button", { name: "Yes" }));
    expect(dialog()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    const posted = clientFetch.mock.calls.find(([url, init]) => url === `/api/review/${TRIP}` && init?.body);
    expect(JSON.parse(posted![1].body).mutation).toEqual({ action: "confirm" });
  });

  it("asks each trip in its own dialog, so answering one leaves the other trip alone (Codex r2 on #590)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const other = { ...reviewItems[1], id: "00000000-0000-4000-8000-0000000000a4", title: "Getting around",
      suggestedStartedAt: at(11), suggestedStoppedAt: at(11, 30), rawPayload: { clientSegmentId: "seg-other" } };
    const trip = { ...reviewItems[1], title: "Getting around" };
    render(<EntriesTable {...baseProps()} reviewItems={[trip, other]} />);
    const rows = () => screen.getAllByRole("button", { name: /^Getting around, .+\. Needs a look$/ });
    expect(rows()).toHaveLength(2);
    // The one at 11:00 has no trip on the day: it asks under its row, as anything without a dialog does.
    const [later, earlier] = rows();
    fireEvent.click(earlier);
    expect(within(dialog()!).getByRole("group", { name: /^Getting around, \d\d:00–\d\d:30\?$/ })).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" }));
    expect(dialog()).toBeNull();
    fireEvent.click(later);
    const asked = screen.getByRole("group", { name: /^Getting around, 1\d:00–1\d:30\?$/ });
    expect(asked.closest("tr")?.dataset.questionFor).toBe(other.id);
    fireEvent.click(within(asked).getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual([`/api/review/${other.id}`]);
    expect(rows()).toHaveLength(1);
  });

  it("asks a round trip from a place as a trip too, with Yes (Codex r1 on #590)", () => {
    const round = { ...reviewItems[1], title: "Getting around", rawPayload: { clientSegmentId: "seg-trip", qualificationReason: "same_place_outing" } };
    render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[0], round, reviewItems[2]]} />);
    const row = askingRow("Getting around")!;
    expect(row.closest("tr")!.querySelector(".timeline-row-yes")).toBeTruthy();
    fireEvent.click(row);
    const asked = within(dialog()!).getByRole("group", { name: /^Getting around, \d\d:00–\d\d:30\?$/ });
    expect(within(asked).getByRole("button", { name: "Yes" })).toBeTruthy();
  });

  it("keeps Log for an unnamed place from before Location V2, which has no editor (Codex r1 on #594)", () => {
    const legacy = suggestion("00000000-0000-4000-8000-0000000000a9", { title: "Unknown place", eventSource: "geofence_specific",
      suggestedStartedAt: at(10), suggestedStoppedAt: at(11) });
    render(<EntriesTable {...baseProps()} entries={[entry("planning", "Planning", at(11), at(11, 45))]} reviewItems={[legacy]} />);
    const row = askingRow("Unknown place")!;
    // No guess, so no Yes pill on the row.
    expect(row.closest("tr")!.querySelector(".timeline-row-yes")).toBeNull();
    fireEvent.click(row);
    expect(dialog()).toBeNull();
    expect(screen.getByRole("group", { name: "Where were you?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log Unknown place" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("steps through the checks oldest first with the chip, each opening as it asks (owner concern 4)", async () => {
    renderList();
    // Sleep (01:00) first: Apple Health asks under its row.
    fireEvent.click(await screen.findByRole("button", { name: "3 to check, oldest first" }));
    expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy();
    expect(dialog()).toBeNull();
    // Then the Office (09:00): its dialog, with the question at the top.
    fireEvent.click(chip(3));
    expect(screen.queryByRole("group", { name: /^Sleep, / })).toBeNull();
    expect(within(dialog()!).getByRole("group", { name: "Visited Office?" })).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    // Then the trip (10:00), in its own dialog.
    fireEvent.click(chip(3));
    expect(within(dialog()!).getByRole("group", { name: /^Walk, / })).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" }));
    // And round again to the oldest.
    fireEvent.click(chip(3));
    expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("steps across days: a \"?\" on a day the List hasn't loaded opens that day at it (owner concern 4)", async () => {
    const earlier = suggestion("00000000-0000-4000-8000-0000000000c1", { title: "Sleep", eventSource: "health_sleep",
      eventType: "health_sleep_import_suggestion", suggestedStartedAt: new Date(Date.UTC(2026, 7, 9, 12)).toISOString(),
      suggestedStoppedAt: new Date(Date.UTC(2026, 7, 9, 13)).toISOString() });
    renderList([earlier, ...reviewItems]);
    // Counted with today's, oldest first: it is the first one.
    fireEvent.click(await screen.findByRole("button", { name: "4 to check, oldest first" }));
    expect(router.push).toHaveBeenCalledWith(`/timeline?view=list&scope=day&date=2026-08-09&check=${earlier.id}`);
    // The next press goes on from it to the oldest of this day.
    fireEvent.click(chip(4));
    expect(screen.getByRole("group", { name: /^Sleep, / }).closest("tr")?.dataset.questionFor).toBe(SLEEP);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("asks only for 7 days: an older \"?\" has no dot and isn't counted (owner concern 4)", async () => {
    // Today is 18 Aug: 11 Aug is 7 days before, so its "?" no longer ask; 12 Aug's still do.
    clock.todayStartMs = localDayStart(new Date(Date.UTC(2026, 7, 18, 12)).toISOString());
    const recent = suggestion("00000000-0000-4000-8000-0000000000c2", { title: "Sleep", eventSource: "health_sleep",
      eventType: "health_sleep_import_suggestion", suggestedStartedAt: new Date(Date.UTC(2026, 7, 12, 12)).toISOString(),
      suggestedStoppedAt: new Date(Date.UTC(2026, 7, 12, 13)).toISOString() });
    renderList([recent, ...reviewItems]);
    expect(await screen.findByRole("button", { name: "1 to check, oldest first" })).toBeTruthy();
    // The old trip and Apple Health don't ask at all; the saved place, asking nothing, is a quiet place again.
    expect(officeRow()).toBeNull();
    expect(askingRow("Walk")).toBeNull();
    expect(sleepRow()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Office, / })).toBeNull();
    // With All places it is an ordinary row you can still correct, with no dot.
    fireEvent.click(screen.getByRole("button", { name: "All places" }));
    const office = screen.getByRole("button", { name: /^Office, / });
    expect(office.getAttribute("aria-label")).not.toContain("Needs a look");
    expect(office.querySelector(".timeline-location-dot")).toBeNull();
    fireEvent.click(office);
    expect(within(dialog()!).queryByRole("group", { name: "Visited Office?" })).toBeNull();
    expect(within(dialog()!).getByRole("radiogroup", { name: "Where were you?" })).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    fireEvent.click(chip(1));
    expect(router.push).toHaveBeenCalledWith(`/timeline?view=list&scope=day&date=2026-08-12&check=${recent.id}`);
  });

  it("folds an outing onto its stay, says what the answer covers, and decides them together (Codex r1 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const outing = outingPair();
    render(
      <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={timeline} reviewItems={outing}
        entries={[]} onChanged={vi.fn(async () => undefined)} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(chip(1)).toBeTruthy();
    expect(askingRow("Walk")).toBeNull();
    fireEvent.click(askingRow("Unknown place")!);
    // Card B: the outing's trips are decided with it, silently.
    expect(within(dialog()!).getByRole("group", { name: "Where were you?" })).toBeTruthy();
    expect(screen.queryByText(/With its trips/)).toBeNull();
    // With no guess there is nothing to say Yes to: the dialog's choices name it.
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(within(dialog()!).getByRole("radiogroup", { name: "Where were you?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(JSON.parse(clientFetch.mock.calls[0][1].body).mutation).toEqual({ action: "ignore_outing", memberReviewItemIds: [outing[1].id] });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(askingRow("Unknown place")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("brings an answered card back with Undo even after a refresh dropped it, and moves focus on (Codex r1 on #568)", async () => {
    const props = baseProps();
    const { rerender } = render(<EntriesTable {...props} reviewItems={reviewItems} />);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    // Sleep is the List's last "?": focus moves on to the chip.
    await waitFor(() => expect(document.activeElement).toBe(chip(2)));
    // A refresh no longer lists it (capped, or decided elsewhere meanwhile); Undo still brings it back.
    rerender(<EntriesTable {...props} reviewItems={reviewItems.filter((item) => item.id !== SLEEP)} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sleepRow()).toBeTruthy();
  });

  it("keeps Apple Health's check when the location read failed (Codex r1 on #568)", async () => {
    render(
      <EntriesTable capturedNow={new Date(at(12))} categories={[]} groupByDay locationTimeline={null} reviewItems={reviewItems}
        checksDay={{ start: new Date(at(0)), end: new Date(at(24)) }}
        entries={[entry("planning", "Planning", at(11), at(11, 45))]} onChanged={vi.fn(async () => undefined)} onDeleteEntries={vi.fn()} onScroll={vi.fn()} scrollContainerRef={vi.fn()} tags={[]} />
    );
    expect(await screen.findByRole("button", { name: /^Sleep, .+\. Needs a look$/ })).toBeTruthy();
    expect(chip(3)).toBeTruthy();
  });

  it("keeps a revived card away once it is answered again and saved (Codex r2 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    const withoutSleep = reviewItems.filter((item) => item.id !== SLEEP);
    rerender(<EntriesTable {...baseProps()} reviewItems={withoutSleep} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    rerender(<EntriesTable {...baseProps()} reviewItems={[...withoutSleep]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sleepRow()).toBeNull();
  });

  it("brings back only the outing's cards the server says are still open (Codex r2 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "open", [walk.id]: "accepted" } }), { status: 409 }));
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    // The refresh after the answer no longer lists either card.
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // The stay comes back on its own: the accepted trip is not folded into the next answer.
    expect(askingRow("Unknown place")).toBeTruthy();
    expect(askingRow("Walk")).toBeNull();
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    fireEvent.click(askingRow("Unknown place")!);
    expect(screen.queryByText(/With its trips/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(JSON.parse(clientFetch.mock.calls.at(-1)?.[1].body).mutation.action).not.toBe("ignore_outing");
  });

  it("moves focus to the List when the last question is answered (Codex r2 on #568)", async () => {
    const { container } = render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[2]]} />);
    fireEvent.click(sleepRow()!);
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
      fireEvent.click(sleepRow()!);
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      const before = startViewTransition.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(sleepRow()).toBeTruthy();
      expect(startViewTransition.mock.calls.length).toBeGreaterThan(before);
    } finally {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("keeps a revived outing's trip away once the outing is answered again and saved (Codex r3 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    rerender(<EntriesTable {...baseProps()} reviewItems={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(askingRow("Walk")).toBeNull();
    expect(screen.queryByRole("button", { name: /to check, oldest first$/ })).toBeNull();
  });

  it("drops server-decided cards from stale data before grouping the outing (Codex r3 on #568)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "open", [walk.id]: "accepted" } }), { status: 409 }));
    // No replacement data arrives: the stale bootstrap still lists both.
    render(<EntriesTable {...baseProps()} reviewItems={[stay, walk]} />);
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    fireEvent.click(askingRow("Unknown place")!);
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
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(askingRow("Unknown place")).toBeNull();
    expect(chip(1)).toBeTruthy();
    expect(askingRow("Walk")).toBeTruthy();
  });

  it("opens the first question from Today's link, focuses it, and keeps it open when the day's places arrive (Codex r1 on #572)", async () => {
    search.params = "check=first";
    try {
      const props = { ...baseProps(), checksDay: { start: new Date(at(0)), end: new Date(at(24)) } };
      const sleep = reviewItems[2];
      // The location read has not arrived: Apple Health's "?" asks under its row.
      const { rerender } = render(<EntriesTable {...props} locationTimeline={null} reviewItems={[sleep]} />);
      await waitFor(() => expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy());
      await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.checkKey).toBeTruthy());
      // The places arrive: the question stays open, its row's button keeps focus.
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={[sleep]} />);
      expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(sleepRow()));
      // Closing it is final for this visit: it does not open again.
      fireEvent.click(sleepRow()!);
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={[sleep]} />);
      expect(screen.queryByRole("group", { name: /^Sleep, / })).toBeNull();
    } finally {
      search.params = "";
    }
  });

  it("opens a place's dialog from Today's link once its row is in (Codex r1 on #572)", async () => {
    search.params = "check=first";
    try {
      render(<EntriesTable {...baseProps()} reviewItems={[reviewItems[0]]} />);
      await waitFor(() => expect(within(dialog()!).getByRole("group", { name: "Visited Office?" })).toBeTruthy());
    } finally {
      search.params = "";
    }
  });

  it("opens the \"?\" a link names by its id, once (owner concern 4)", async () => {
    search.params = `view=list&check=${TRIP}`;
    try {
      const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
      await waitFor(() => expect(within(dialog()!).getByRole("group", { name: /^Walk, / })).toBeTruthy());
      fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" }));
      rerender(<EntriesTable {...baseProps()} reviewItems={[...reviewItems]} />);
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(dialog()).toBeNull();
    } finally {
      search.params = "";
    }
  });
  it("logs a place that asks with Logs as through log_place, and the refresh hides its \"?\" (Codex r2 on #609)", async () => {
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => url === "/api/timeline/corrections"
      ? new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e1"], resolvedReviewItemIds: [PLACE] } }), { status: 200 })
      : new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    const errands = { id: "cat-errands", name: "Errands", color: "mint", isPinned: false };
    const onChanged = vi.fn(async () => undefined);
    const { rerender } = render(<EntriesTable {...baseProps()} categories={[errands]} onChanged={onChanged} reviewItems={reviewItems} />);
    fireEvent.click(officeRow()!);
    fireEvent.click(within(dialog()!).getByRole("radio", { name: "Errands" }));
    await act(async () => { fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" })); });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections"]);
    expect(JSON.parse(clientFetch.mock.calls[0][1].body)).toEqual({ kind: "log_place", subject: "place", itemId: "seg-office", categoryId: "cat-errands",
      clientCorrectionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(onChanged).toHaveBeenCalled();
    // The refresh no longer lists the closed "?": its row and count go.
    rerender(<EntriesTable {...baseProps()} categories={[errands]} onChanged={onChanged} reviewItems={reviewItems.filter((item) => item.id !== PLACE)} />);
    expect(officeRow()).toBeNull();
    expect(chip(2)).toBeTruthy();
  });

  it("moves focus to the next \"?\" when a dialog's question is answered (Codex r1 on #609)", async () => {
    renderList();
    const office = officeRow()!;
    office.focus();
    fireEvent.click(office);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Not now" }));
    expect(dialog()).toBeNull();
    // The row that opened it is gone; Sleep is the next "?" down the List.
    await waitFor(() => expect(document.activeElement).toBe(sleepRow()));
  });

  it("opens a linked place's dialog once its day's places arrive, if its question is still open (Codex r1 on #609)", async () => {
    search.params = `view=list&check=${PLACE}`;
    try {
      const props = { ...baseProps(), checksDay: { start: new Date(at(0)), end: new Date(at(24)) } };
      // The location read hasn't arrived: the "?" opens under its own row.
      const { rerender } = render(<EntriesTable {...props} locationTimeline={null} reviewItems={reviewItems} />);
      await waitFor(() => expect(screen.getByRole("group", { name: /^Visited Office\?/ })).toBeTruthy());
      expect(dialog()).toBeNull();
      // The places arrive: the question moves into the place's dialog.
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={reviewItems} />);
      await waitFor(() => expect(within(dialog()!).getByRole("group", { name: "Visited Office?" })).toBeTruthy());
      expect(document.querySelector(".timeline-check-question")).toBeNull();
      // Once: closed, it stays closed.
      fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
      rerender(<EntriesTable {...props} locationTimeline={timeline} reviewItems={[...reviewItems]} />);
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(dialog()).toBeNull();
    } finally {
      search.params = "";
    }
  });

  it("asks a covered place's \"?\" on a row of its own, counted once (Codex r1 on #609)", () => {
    // A meeting covers the Office visit: the place is no row, even with All places, but its "?" still asks.
    render(<EntriesTable {...baseProps()} entries={[entry("meeting", "Meeting", at(9), at(10))]} reviewItems={[reviewItems[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: "All places" }));
    expect(chip(1)).toBeTruthy();
    expect(document.querySelectorAll('tr[data-location-row="seg-office"]')).toHaveLength(0);
    expect(document.querySelectorAll(`tr[data-suggestion-id="${PLACE}"]`)).toHaveLength(1);
    // It keeps its place: the row opens the place's dialog with its map and choices, never the inline question.
    fireEvent.click(officeRow()!);
    expect(within(dialog()!).getByRole("group", { name: "Visited Office?" })).toBeTruthy();
    expect(within(dialog()!).getByRole("radiogroup", { name: "Where were you?" })).toBeTruthy();
    expect(document.querySelector(".timeline-check-question")).toBeNull();
  });
  it("stops asking in an open dialog once its \"?\" expires at midnight (Codex r2 on #609)", () => {
    const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
    fireEvent.click(officeRow()!);
    expect(within(dialog()!).getByRole("group", { name: "Visited Office?" })).toBeTruthy();
    // Midnight on 18 Aug: the 11th's "?" no longer ask. The dialog stays, as the place's correction, asking nothing.
    clock.todayStartMs = localDayStart(new Date(Date.UTC(2026, 7, 18, 12)).toISOString());
    rerender(<EntriesTable {...baseProps()} reviewItems={[...reviewItems]} />);
    expect(dialog()).toBeTruthy();
    expect(within(dialog()!).queryByRole("group", { name: "Visited Office?" })).toBeNull();
    expect(within(dialog()!).queryByRole("button", { name: "Not now" })).toBeNull();
  });

  it("opens a linked \"?\" again when the link comes back after leaving the URL (Codex r2 on #609)", async () => {
    search.params = `view=list&check=${TRIP}`;
    try {
      const { rerender } = render(<EntriesTable {...baseProps()} reviewItems={reviewItems} />);
      await waitFor(() => expect(within(dialog()!).getByRole("group", { name: /^Walk, / })).toBeTruthy());
      fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" }));
      search.params = "view=list";
      rerender(<EntriesTable {...baseProps()} reviewItems={[...reviewItems]} />);
      search.params = `view=list&check=${TRIP}`;
      rerender(<EntriesTable {...baseProps()} reviewItems={[...reviewItems]} />);
      await waitFor(() => expect(within(dialog()!).getByRole("group", { name: /^Walk, / })).toBeTruthy());
    } finally {
      search.params = "";
    }
  });

  it("shares its held answers with the badge and Today, so their counts agree through answer, Undo and failure (Codex r2 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: "Nope" }), { status: 500 }));
    render(<Shell items={reviewItems}><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
    expect(badge()).toBe(3);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(chip(2)).toBeTruthy();
    expect(badge()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(chip(3)).toBeTruthy();
    expect(badge()).toBe(3);
    // A refused save brings it back in both.
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(badge()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(sleepRow()).toBeTruthy();
    expect(chip(3)).toBeTruthy();
    expect(badge()).toBe(3);
  });

  it("counts an outing's open trip in the badge too when the server says its stay is decided (Codex r3 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const [stay, walk] = outingPair();
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [stay.id]: "accepted", [walk.id]: "open" } }), { status: 409 }));
    render(<Shell items={[stay, walk]}><EntriesTable {...baseProps()} reviewItems={[stay, walk]} /></Shell>);
    fireEvent.click(askingRow("Unknown place")!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(chip(1)).toBeTruthy();
    expect(badge()).toBe(1);
  });

  it("keeps an answer still saving away when the List is left and opened again, and its Undo works there (Codex r4 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const save = holdSaves();
    const list = () => <EntriesTable {...baseProps()} reviewItems={reviewItems} />;
    const view = render(<Shell items={reviewItems}>{list()}</Shell>);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    // Left while held for Undo, and opened again: still away, and its Undo is there.
    view.rerender(<Shell items={reviewItems}>{null}</Shell>);
    expect(badge()).toBe(2);
    view.rerender(<Shell items={reviewItems}>{list()}</Shell>);
    expect(sleepRow()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sleepRow()).toBeTruthy();
    expect(badge()).toBe(3);
    // Answered again, sent, and the List left and opened again while it is saving: never answerable twice.
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    view.rerender(<Shell items={reviewItems}>{null}</Shell>);
    view.rerender(<Shell items={reviewItems}>{list()}</Shell>);
    expect(sleepRow()).toBeNull();
    expect(chip(2)).toBeTruthy();
    expect(badge()).toBe(2);
    await act(async () => { save.answer(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(sleepRow()).toBeNull();
    expect(badge()).toBe(2);
  });

  it("keeps a saved answer away when the refresh after it fails, until the data no longer lists it (Codex r4 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const refresh = vi.fn(async () => { throw new Error("offline"); });
    const view = render(<Shell items={reviewItems} refresh={refresh}>{null}</Shell>);
    view.rerender(<Shell items={reviewItems} refresh={refresh}><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    view.rerender(<Shell items={reviewItems} refresh={refresh}>{null}</Shell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    // Saved, the refresh failed, the data still lists it open: it stays away.
    expect(badge()).toBe(2);
    view.rerender(<Shell items={reviewItems} refresh={refresh}><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
    expect(sleepRow()).toBeNull();
    // Data that no longer lists it: nothing left to hide, and the count is the data's.
    const withoutSleep = reviewItems.filter((item) => item.id !== SLEEP);
    view.rerender(<Shell items={withoutSleep} refresh={refresh}><EntriesTable {...baseProps()} reviewItems={withoutSleep} /></Shell>);
    expect(badge()).toBe(2);
  });

  it("drops a previous workspace's late refusal: nothing comes back in the new one (Codex r4 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const save = holdSaves(new Response(JSON.stringify({ ok: false, error: "Nope" }), { status: 500 }));
    const view = render(<Shell items={reviewItems}><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
    fireEvent.click(sleepRow()!);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(clientFetch).toHaveBeenCalledTimes(1);
    // The workspace changes while it is saving: the new one has nothing to check.
    view.rerender(<Shell items={[]} owner="w2:u1"><EntriesTable {...baseProps()} reviewItems={[]} /></Shell>);
    expect(badge()).toBe(0);
    // The old save is refused late: it would restore the old workspace's "?", and must not.
    await act(async () => { save.answer(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(badge()).toBe(0);
    expect(sleepRow()).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("moves focus to the next \"?\" when a saved Logs as removes the row that opened it (Codex r4 on #609)", async () => {
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e1"], resolvedReviewItemIds: [PLACE] } }),
      { status: 200 }));
    const errands = { id: "cat-errands", name: "Errands", color: "mint", isPinned: false };
    let items = reviewItems;
    let view: ReturnType<typeof render> | null = null;
    const list = () => <EntriesTable {...baseProps()} categories={[errands]} onChanged={async () => {
      items = items.filter((item) => item.id !== PLACE);
      view!.rerender(list());
    }} reviewItems={items} />;
    view = render(list());
    const office = officeRow()!;
    office.focus();
    fireEvent.click(office);
    fireEvent.click(within(dialog()!).getByRole("radio", { name: "Errands" }));
    await act(async () => { fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" })); });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(officeRow()).toBeNull();
    // Sleep is the next "?" down the List from the Office row.
    await waitFor(() => expect(document.activeElement).toBe(sleepRow()));
  });
  it("keeps a question held in the List out of the Grid, and Undo in the List still brings it back (Codex r5 on #609)", async () => {
    // The Grid's Places lane and dialogs read the same decisions owner.
    function GridProbe() {
      const items = useProjectedReviewItems([]);
      const grid = useGridCorrection({ activities: [], clock: "24h", owner: "w1:u1", places: [], refresh: async () => undefined, reviewItems: items,
        timelines: new Map([[timeline.date, timeline]]), todayStartMs: clock.todayStartMs });
      const office = timeline.items[0] as Extract<LocationTimeline["items"][number], { kind: "place" }>;
      return (
        <>
          <output data-testid="grid-asks">{grid.askingBySegment?.has("seg-office") ? "asks" : "quiet"}</output>
          <button onClick={() => grid.open(office, timeline, grid.askingBySegment?.get("seg-office") ?? null)} type="button">Open the office</button>
          {grid.dialog}
        </>
      );
    }
    const list = <EntriesTable {...baseProps()} reviewItems={reviewItems} />;
    const view = render(<Shell items={reviewItems}>{list}</Shell>);
    fireEvent.click(officeRow()!);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Not now" }));
    expect(badge()).toBe(2);
    // To the Grid while it is held for Undo: the office asks nothing there, and its dialog has no Yes.
    view.rerender(<Shell items={reviewItems}><GridProbe /></Shell>);
    expect(screen.getByTestId("grid-asks").textContent).toBe("quiet");
    fireEvent.click(screen.getByRole("button", { name: "Open the office" }));
    expect(within(dialog()!).queryByRole("group", { name: "Visited Office?" })).toBeNull();
    expect(within(dialog()!).queryByRole("button", { name: "Yes" })).toBeNull();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Cancel" }));
    // Back in the List, Undo brings it back, in the List, the badge and the Grid; nothing was sent.
    view.rerender(<Shell items={reviewItems}>{list}</Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(officeRow()).toBeTruthy();
    expect(badge()).toBe(3);
    view.rerender(<Shell items={reviewItems}><GridProbe /></Shell>);
    expect(screen.getByTestId("grid-asks").textContent).toBe("asks");
    expect(clientFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/review/"))).toEqual([]);
  });
  it("never lets a revival queued in one lifetime of a workspace land after A → B → A (Codex r6 on #609)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    clientFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: false, error: "Nope" }), { status: 500 }));
    const queued: Array<() => void> = [];
    // A List whose transition runs later, when the test releases it.
    function Probe() {
      const checks = useListChecks({ applyTransition: (update) => { queued.push(update); }, categories: [], refresh: async () => undefined, reviewItems: [] });
      return (
        <>
          <output data-testid="checks">{checks.checks.map((check) => check.id).join(",")}</output>
          <button onClick={() => checks.answer(SLEEP, "skip")} type="button">Answer Sleep</button>
        </>
      );
    }
    const sleep = reviewItems[2];
    const view = render(<Shell items={[sleep]}><Probe /></Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Answer Sleep" }));
    // A refresh no longer lists it; then its save is refused: its restore is queued.
    view.rerender(<Shell items={[]}><Probe /></Shell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // The restore and the revival of the copy the data no longer has are both queued in the List's transition.
    expect(queued.length).toBeGreaterThan(0);
    // Workspace B, then back to A: a new lifetime of A, whose data doesn't list it.
    view.rerender(<Shell items={[]} owner="w2:u1"><Probe /></Shell>);
    view.rerender(<Shell items={[]}><Probe /></Shell>);
    act(() => { queued.splice(0).forEach((update) => update()); });
    expect(screen.getByTestId("checks").textContent).toBe("");
    expect(badge()).toBe(0);
  });

  it("settles a question the Grid's Logs as resolved: the List's Undo can't bring it back (Codex r6 on #609)", async () => {
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => url === "/api/timeline/corrections"
      ? new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e1"], resolvedReviewItemIds: [PLACE] } }), { status: 200 })
      : new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    const errands = { id: "cat-errands", name: "Errands", color: "mint", isPinned: false };
    function GridProbe() {
      const items = useProjectedReviewItems([]);
      const grid = useGridCorrection({ activities: [errands], clock: "24h", owner: "w1:u1", places: [], refresh: async () => undefined, reviewItems: items,
        timelines: new Map([[timeline.date, timeline]]), todayStartMs: clock.todayStartMs });
      const office = timeline.items[0] as Extract<LocationTimeline["items"][number], { kind: "place" }>;
      return (
        <>
          <button onClick={() => grid.open(office, timeline, grid.askingBySegment?.get("seg-office") ?? null)} type="button">Open the office</button>
          {grid.dialog}
        </>
      );
    }
    const list = <EntriesTable {...baseProps()} reviewItems={reviewItems} />;
    const view = render(<Shell items={reviewItems}>{list}</Shell>);
    fireEvent.click(officeRow()!);
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Not now" }));
    expect(badge()).toBe(2);
    // On the Grid, while the List holds its Not now, the office is logged as Errands.
    view.rerender(<Shell items={reviewItems}><GridProbe /></Shell>);
    fireEvent.click(screen.getByRole("button", { name: "Open the office" }));
    fireEvent.click(within(dialog()!).getByRole("radio", { name: "Errands" }));
    await act(async () => { fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" })); });
    await waitFor(() => expect(dialog()).toBeNull());
    // Back in the List: Undo brings nothing back, the badge stays, and the held Not now was never sent.
    view.rerender(<Shell items={reviewItems}>{list}</Shell>);
    const undo = screen.queryByRole("button", { name: "Undo" });
    if (undo) fireEvent.click(undo);
    expect(officeRow()).toBeNull();
    expect(badge()).toBe(2);
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections"]);
  });

  it("moves focus to the next \"?\" when a focused row Yes pill answers (Codex r6 on #609)", async () => {
    renderList();
    const yes = officeRow()!.closest("tr")!.querySelector<HTMLButtonElement>(".timeline-row-yes")!;
    yes.focus();
    fireEvent.click(yes);
    expect(officeRow()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(sleepRow()));
  });
  describe("a Logs as receipt that lands lifetimes later (Codex r7 on #609)", () => {
    const errands = { id: "cat-errands", name: "Errands", color: "mint", isPinned: false };
    function GridProbe() {
      const items = useProjectedReviewItems([]);
      const grid = useGridCorrection({ activities: [errands], clock: "24h", owner: "w1:u1", places: [], refresh: async () => undefined, reviewItems: items,
        timelines: new Map([[timeline.date, timeline]]), todayStartMs: clock.todayStartMs });
      const office = timeline.items[0] as Extract<LocationTimeline["items"][number], { kind: "place" }>;
      return (
        <>
          <button onClick={() => grid.open(office, timeline, grid.askingBySegment?.get("seg-office") ?? null)} type="button">Open the office</button>
          {grid.dialog}
        </>
      );
    }
    /** Starts Logs as for the office on the Grid in workspace w1; its receipt waits for `land`. */
    async function startLogsAs() {
      let land: () => void = () => undefined;
      clientFetch.mockImplementation((url: string, init: RequestInit) => url === "/api/timeline/corrections"
        ? new Promise<Response>((resolve) => {
          land = () => resolve(new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e1"], resolvedReviewItemIds: [PLACE] } }), { status: 200 }));
        })
        : Promise.resolve(new Response(JSON.stringify(acknowledge(url, init)), { status: 200 })));
      const view = render(<Shell items={reviewItems}><GridProbe /></Shell>);
      fireEvent.click(screen.getByRole("button", { name: "Open the office" }));
      fireEvent.click(within(dialog()!).getByRole("radio", { name: "Errands" }));
      await act(async () => { fireEvent.click(within(dialog()!).getByRole("button", { name: "Done" })); });
      return { view, land: () => land() };
    }

    it("settles the current answer when it lands after A → B → A", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const { view, land } = await startLogsAs();
      view.rerender(<Shell items={[]} owner="w2:u1">{null}</Shell>);
      view.rerender(<Shell items={reviewItems}><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
      // Back in w1, the office's "?" is answered in the List and held for Undo.
      fireEvent.click(officeRow()!);
      fireEvent.click(within(dialog()!).getByRole("button", { name: "Not now" }));
      expect(badge()).toBe(2);
      await act(async () => { land(); });
      // The receipt settled it in the current lifetime's controller: the held Not now is never sent, and Undo brings
      // nothing back.
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      expect(clientFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/review/"))).toEqual([]);
      const undo = screen.queryByRole("button", { name: "Undo" });
      if (undo) fireEvent.click(undo);
      expect(officeRow()).toBeNull();
      expect(badge()).toBe(2);
    });

    it("drops it when it lands in another workspace", async () => {
      const { view, land } = await startLogsAs();
      // Another workspace that happens to show a "?" with the same id: the receipt isn't its.
      view.rerender(<Shell items={reviewItems} owner="w2:u1"><EntriesTable {...baseProps()} reviewItems={reviewItems} /></Shell>);
      fireEvent.click(officeRow()!);
      fireEvent.click(within(dialog()!).getByRole("button", { name: "Not now" }));
      await act(async () => { land(); });
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(officeRow()).toBeTruthy();
      expect(badge()).toBe(3);
    });
  });
  it("never lets a slow navigation from an earlier chip step reopen its \"?\" after a newer step (Codex r8 on #609)", async () => {
    const nap = suggestion("00000000-0000-4000-8000-0000000000c3", { title: "Nap", eventSource: "health_sleep",
      eventType: "health_sleep_import_suggestion", suggestedStartedAt: new Date(Date.UTC(2026, 7, 9, 12)).toISOString(),
      suggestedStoppedAt: new Date(Date.UTC(2026, 7, 9, 13)).toISOString() });
    const items = [nap, ...reviewItems];
    const today = { start: new Date(at(0)), end: new Date(at(24)) };
    const ninth = { start: new Date(Date.UTC(2026, 7, 9)), end: new Date(Date.UTC(2026, 7, 10)) };
    try {
      const { rerender } = render(<EntriesTable {...baseProps()} checksDays={[today]} reviewItems={items} />);
      // The first press goes to the 9th, not loaded yet; before that navigation lands, the next press opens Sleep.
      fireEvent.click(await screen.findByRole("button", { name: "4 to check, oldest first" }));
      expect(router.push).toHaveBeenCalledWith(`/timeline?view=list&scope=day&date=2026-08-09&check=${nap.id}`);
      fireEvent.click(chip(4));
      expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy();
      const sleep = sleepRow()!;
      sleep.focus();
      // The earlier navigation arrives late, with the 9th's rows.
      search.params = `view=list&scope=day&date=2026-08-09&check=${nap.id}`;
      rerender(<EntriesTable {...baseProps()} checksDays={[ninth, today]} reviewItems={items} />);
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
      expect(askingRow("Nap")).toBeTruthy();
      expect(screen.queryByRole("group", { name: /^Nap, / })).toBeNull();
      expect(screen.getByRole("group", { name: /^Sleep, / })).toBeTruthy();
      expect(document.activeElement).toBe(sleep);
      // Later, a deliberate visit to the same "?" (the link left the URL, then came back): it opens and takes focus.
      search.params = "view=list&scope=day";
      rerender(<EntriesTable {...baseProps()} checksDays={[ninth, today]} reviewItems={items} />);
      search.params = `view=list&scope=day&date=2026-08-09&check=${nap.id}`;
      rerender(<EntriesTable {...baseProps()} checksDays={[ninth, today]} reviewItems={[...items]} />);
      await waitFor(() => expect(screen.getByRole("group", { name: /^Nap, / })).toBeTruthy());
      await waitFor(() => expect(document.activeElement).toBe(askingRow("Nap")));
    } finally {
      search.params = "";
    }
  });
});
