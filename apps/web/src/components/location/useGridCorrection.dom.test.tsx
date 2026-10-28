// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline, TimelinePlace } from "@dayframe/shared";
import type { ReviewItemRow } from "@/lib/queries";

const clientFetch = vi.hoisted(() => vi.fn());
const evidenceFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-auth-fetch", () => ({
  clientFetch: (url: string, init?: RequestInit) => url.includes("/evidence?") ? evidenceFetch(url, init) : clientFetch(url, init)
}));

const { useGridCorrection } = await import("./useGridCorrection");

// The Grid's place and trip dialogs (owner item A; Codex r1 on #609). Synthetic ids, made-up names.
const at = (hour: number, minute = 0) => new Date(2026, 9, 27, hour, minute).toISOString();
const TODAY = new Date(2026, 9, 28).getTime();
const cafe: TimelinePlace = { kind: "place", id: "seg-cafe", status: "finalised", startedAt: at(10, 30), stoppedAt: at(11), placeId: null,
  learnedPlaceId: null, name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] };
const timeline = (items: LocationTimeline["items"] = [cafe]): LocationTimeline => ({
  date: "2026-10-27", timeZone: "", dayStart: new Date(2026, 9, 27).toISOString(), dayEnd: new Date(2026, 9, 28).toISOString(), gaps: [],
  openTrip: null, items
});
const suggestion = (id: string, patch: Partial<ReviewItemRow>): ReviewItemRow => ({
  id, type: "suggestion", title: "Boots", eventSource: "location_learning", eventType: "unknown_stay", projectName: null, categoryName: null,
  categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null, suggestedStartedAt: at(10, 30),
  suggestedStoppedAt: at(11), confidence: "medium", status: "open", notes: null, rawPayload: { clientSegmentId: "seg-cafe" }, createdAt: at(12), ...patch
});
const STAY = "00000000-0000-4000-8000-0000000000b1";
const WALK = "00000000-0000-4000-8000-0000000000b2";
const outing = () => [
  suggestion(STAY, { title: "Unknown place", rawPayload: { clientSegmentId: "seg-cafe", outingKey: "o1", outingRole: "stay" } }),
  suggestion(WALK, { title: "Walk", eventType: "commute_detected", suggestedStartedAt: at(10), suggestedStoppedAt: at(10, 30),
    rawPayload: { clientSegmentId: "seg-trip", outingKey: "o1", outingRole: "in" } })
];

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

type Props = { owner?: string; items?: ReviewItemRow[]; timelines?: LocationTimeline[]; refresh?: () => Promise<unknown> };
function Grid({ owner = "w1:u1", items = [suggestion("q1", {})], timelines = [timeline()], refresh = async () => undefined }: Props) {
  const grid = useGridCorrection({ activities: [{ id: "cat-errands", name: "Errands" }], clock: "24h", owner, places: [], refresh,
    reviewItems: items, timelines: new Map(timelines.map((each) => [each.date, each])), todayStartMs: TODAY });
  return (
    <>
      <button onClick={() => grid.open(cafe, timelines[0] ?? timeline(), grid.askingBySegment?.get("seg-cafe") ?? null)} type="button">Open the cafe</button>
      {grid.dialog}
    </>
  );
}

const posted = () => clientFetch.mock.calls.map(([url, init]) => ({ url, mutation: JSON.parse((init as RequestInit).body as string).mutation }));

describe("the Grid's place dialogs (Codex r1 on #609)", () => {
  beforeEach(() => {
    clientFetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    evidenceFetch.mockReset().mockResolvedValue(new Response("{}", { status: 404 }));
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  });
  afterEach(cleanup);

  it("closes when the workspace changes or a refresh no longer lists the place", () => {
    const view = render(<Grid />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<Grid owner="w2:u1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Back to the first workspace, it stays closed: it belonged to that visit.
    view.rerender(<Grid />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<Grid timelines={[timeline([])]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("answers an outing's \"?\" for the outing: Not now and Yes decide its trips with it", async () => {
    const view = render(<Grid items={outing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Where were you?" })).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted()).toEqual([{ url: `/api/review/${STAY}`, mutation: { action: "ignore_outing", memberReviewItemIds: [WALK] } }]);
    view.rerender(<Grid items={[{ ...outing()[0], title: "Boots" }, outing()[1]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Visited Boots?" })).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted()[1]).toEqual({ url: `/api/review/${STAY}`, mutation: { action: "confirm_outing", memberReviewItemIds: [WALK] } });
  });

  it("keeps the question and says why when the answer isn't saved", async () => {
    clientFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Couldn't log that visit." }), { status: 500 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, action: "something_else" }), { status: 200 }));
    const refresh = vi.fn(async () => undefined);
    render(<Grid refresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    const yes = () => within(screen.getByRole("group", { name: "Visited Boots?" })).getByRole("button", { name: "Yes" });
    fireEvent.click(yes());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't log that visit.");
    fireEvent.click(yes());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Check your connection"));
    fireEvent.click(yes());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't confirm"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // The next try saves, and the dialog closes.
    fireEvent.click(yes());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("logs a place that asks through log_place, which closes its \"?\" on the server (Codex r2 on #609)", async () => {
    const refresh = vi.fn(async () => undefined);
    clientFetch.mockImplementation(async (url: string, init: RequestInit) => url === "/api/timeline/corrections"
      ? new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e1"], resolvedReviewItemIds: ["q1"] } }), { status: 200 })
      : new Response(JSON.stringify(acknowledge(url, init)), { status: 200 }));
    render(<Grid refresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    fireEvent.click(screen.getByRole("radio", { name: "Errands" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done" })); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual(["/api/timeline/corrections"]);
    expect(JSON.parse(clientFetch.mock.calls[0][1].body)).toEqual({ kind: "log_place", subject: "place", itemId: "seg-cafe", categoryId: "cat-errands" });
    expect(refresh).toHaveBeenCalled();
  });

  it("asks nothing for a \"?\" more than 7 days old", () => {
    render(<Grid items={[suggestion("q-old", { suggestedStartedAt: new Date(2026, 9, 20, 9).toISOString(), suggestedStoppedAt: new Date(2026, 9, 20, 10).toISOString() })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Visited Boots?" })).toBeNull();
  });
  it("keeps an outing's question when the server says part of it was decided elsewhere, and says so (Codex r2 on #609)", async () => {
    clientFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [STAY]: "open", [WALK]: "accepted" } }), { status: 409 }));
    const refresh = vi.fn(async () => undefined);
    render(<Grid items={outing()} refresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Where were you?" })).getByRole("button", { name: "Not now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("decided elsewhere");
    expect(screen.getByRole("group", { name: "Where were you?" })).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    // A stay decided elsewhere has nothing left to ask: the dialog closes.
    clientFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "resolution_conflict",
      canonicalReviewStatuses: { [STAY]: "ignored", [WALK]: "accepted" } }), { status: 409 }));
    fireEvent.click(within(screen.getByRole("group", { name: "Where were you?" })).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("follows the refreshed copy of its place: new times, a new map read (Codex r2 on #609)", () => {
    const view = render(<Grid />);
    fireEvent.click(screen.getByRole("button", { name: "Open the cafe" }));
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:30");
    view.rerender(<Grid timelines={[timeline([{ ...cafe, startedAt: at(10, 40) }])]} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:40");
    expect(evidenceFetch.mock.calls.at(-1)?.[0]).toBe(`/api/timeline/items/seg-cafe/evidence?kind=place&startedAt=${encodeURIComponent(at(10, 40))}`);
  });

  it("moves focus to the next question, else the Grid, when an answer removes the opener (Codex r2 on #609)", async () => {
    function Lane({ initial }: { initial: ReviewItemRow[] }) {
      const [items, setItems] = useState(initial);
      const grid = useGridCorrection({ activities: [], clock: "24h", owner: "w1:u1", places: [], reviewItems: items,
        refresh: async () => setItems((current) => current.filter((item) => !posted().some((call) => call.url.endsWith(item.id)))),
        timelines: new Map([["2026-10-27", timeline()]]), todayStartMs: TODAY });
      return (
        <div className="calendar-grid-scroller" data-testid="scroller" tabIndex={0}>
          {items.map((item) => (
            <button className="calendar-places-item is-asking" key={item.id} onClick={() => grid.open(cafe, timeline(), item.id)} type="button">{item.id}</button>
          ))}
          {grid.dialog}
        </div>
      );
    }
    render(<Lane initial={[suggestion("q1", {}), suggestion("q2", { suggestedStartedAt: at(14), suggestedStoppedAt: at(15) })]} />);
    const first = screen.getByRole("button", { name: "q1" });
    first.focus();
    fireEvent.click(first);
    fireEvent.click(within(screen.getByRole("group", { name: "Visited Boots?" })).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "q2" })));
    screen.getByRole("button", { name: "q2" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "q2" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Visited Boots?" })).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("scroller")));
  });
});
