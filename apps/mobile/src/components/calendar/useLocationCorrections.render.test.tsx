import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline, TimelinePlace } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  fetchEvidence: vi.fn(async () => ({ segment: { kind: "stay" }, map: { centre: { type: "Point", coordinates: [20, 10] }, stayRadiusMeters: 40 } })),
  createPlace: vi.fn(async () => ({ ok: true, place: { id: "6f000000-0000-4000-8000-0000000000aa" } })),
  enqueue: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  remove: vi.fn(async () => undefined),
  synchronise: vi.fn(async (..._args: unknown[]) => undefined),
  appListeners: new Set<(state: string) => void>(),
  queued: [] as Array<{ clientCorrectionId: string; request: { kind: string; itemId: string } }>,
  acknowledgedNow: [] as Array<{ clientCorrectionId: string }>,
  appState: "active"
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return mocks.appState; },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mocks.appListeners.add(listener);
      return { remove: () => mocks.appListeners.delete(listener) };
    }
  }
}));
vi.mock("../../lib/api", () => ({ createPlace: mocks.createPlace, fetchTimelineItemEvidence: mocks.fetchEvidence }));
vi.mock("../../lib/timelineCorrectionOutbox", () => ({
  createTimelineCorrectionId: (() => { let next = 0; return () => `cid-${++next}`; })(),
  readPendingTimelineCorrections: async () => mocks.queued,
  readAcknowledgedTimelineCorrections: () => mocks.acknowledgedNow,
  enqueueTimelineCorrections: mocks.enqueue,
  removeTimelineCorrections: mocks.remove,
  synchroniseTimelineCorrections: mocks.synchronise
}));
vi.mock("./LocationCorrectionSheet", () => ({ LocationCorrectionSheet: "LocationCorrectionSheet" }));
const waiting = vi.hoisted(() => ({
  holdAnswerAfterCorrections: vi.fn(async (..._args: unknown[]) => undefined),
  commitAnswerAfterCorrections: vi.fn(async (_id: string) => undefined),
  cancelAnswerAfterCorrections: vi.fn(async (_id: string) => undefined),
  noteTimelineCorrectionAcknowledged: vi.fn(async (..._args: unknown[]) => undefined),
  // The store's shared settle and withdraw, as the raw writes go.
  settleOutcome: "committed" as "committed" | "committing" | "abandoned",
  settleAnswerAfterCorrections: vi.fn(async (_owner: unknown, id: string, _options: { inFront: boolean }) => {
    await waiting.commitAnswerAfterCorrections(id);
    return waiting.settleOutcome;
  }),
  // The store's one completion path, over the mocked settle and withdraw.
    finishWaitingStart: (owner: unknown, id: string, checks: { sameAccount: () => boolean; present: () => boolean; start: () => boolean; valid?: () => boolean }) => {
      if (!checks.sameAccount() || (checks.valid && !checks.valid())) { void waiting.withdrawAnswerAfterCorrections(owner, id); return "withdrawn"; }
      if (!checks.present()) { void waiting.settleAnswerAfterCorrections(owner, id, { inFront: false }); return "settled"; }
      if (checks.start()) return "started";
      void waiting.withdrawAnswerAfterCorrections(owner, id);
      return "withdrawn";
    },
    withdrawAnswerAfterCorrections: vi.fn(async (_owner: unknown, id: string) => { await waiting.cancelAnswerAfterCorrections(id); })
}));
vi.mock("../../lib/reviewAnswersAfterCorrections", () => waiting);
// The shared registration (afterCorrections.ts), as the queue in `mocks.queued` would answer it.
const register = vi.hoisted(() => ({
  waitForItemCorrections: vi.fn(async (_owner: unknown, input: { id: string; itemId: string; newIds: readonly string[] }) => {
    const earlier = mocks.queued.filter((item) => item.request.itemId === input.itemId && item.request.kind !== "log_place").map((item) => item.clientCorrectionId);
    const waitsFor = [...new Set([...input.newIds, ...earlier])];
    return waitsFor.length ? { id: input.id, waitsFor } : null;
  })
}));
vi.mock("../../lib/afterCorrections", () => register);

const { useLocationCorrections } = await import("./useLocationCorrections");
// The tap's account lifetime, as the sheet carries it (Codex r17 on #610).
const { currentMobileAccountEpoch } = await import("../../lib/mobileAccount");

// Location v4 step 12: synthetic ids and times only.
const iso = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
const place: TimelinePlace = {
  kind: "place", id: "seg-a", status: "finalised", startedAt: iso(0), stoppedAt: iso(60), placeId: null, learnedPlaceId: null, name: null,
  role: null, matchKind: "unknown", confidence: "low", blockIds: []
};
const timeline = { items: [place] } as unknown as LocationTimeline;
const account = (userId: string) => ({ categories: [{ id: "cat-errands", name: "Errands", color: "teal", isPinned: true }], places: [],
  user: { id: userId }, workspace: { id: "w" } }) as never;
let api: ReturnType<typeof useLocationCorrections> | null = null;
function Probe(props: { data: ReturnType<typeof account> | null; pending?: never[]; showNotice?: (message: string) => void; timeline?: LocationTimeline | null;
  onLogged?: () => void; acknowledged?: never[] }) {
  api = useLocationCorrections({ acknowledged: props.acknowledged, clockFormat: "24h", data: props.data, onLogged: props.onLogged,
    pending: props.pending ?? [], reduceMotion: false,
    showNotice: props.showNotice ?? (() => undefined), theme: {} as never, timeline: props.timeline === undefined ? timeline : props.timeline });
  return api.sheet;
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const sheetOf = (tree: ReturnType<typeof create>) => tree.root.findAll((node) => (node.type as unknown) === "LocationCorrectionSheet")[0] ?? null;

describe("the List's correction sheets (location v4 step 12, Codex r1 on #602)", () => {
  afterEach(() => vi.clearAllMocks());

  it("closes the sheet, its map and its draft when another account signs in", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    await settle();
    expect(sheetOf(tree)?.props.evidence).toMatchObject({ segment: { kind: "stay" } });
    await act(async () => { tree.update(<Probe data={null} />); });
    expect(sheetOf(tree)).toBeNull();
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    expect(sheetOf(tree)).toBeNull();
  });

  it("keeps a sheet's corrections only for the account it opened for", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    const onQueue = sheetOf(tree)!.props.onQueue as (corrections: unknown[], options: { closing: boolean }) => Promise<void>;
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    await expect(onQueue([{ request: { kind: "times" } }], { closing: true })).rejects.toThrow();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("keeps an answer that waits before its corrections are queued, with their ids, then starts it; a failed keep removes it (Codex r2 on #610)", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    type Queue = (corrections: unknown[], options: { closing: boolean; beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void; cancel: () => Promise<void> }> }) => Promise<void>;
    const onQueue = sheetOf(tree)!.props.onQueue as Queue;
    const order: string[] = [];
    mocks.enqueue.mockImplementationOnce(async (...args: unknown[]) => {
      const items = args[1] as Array<{ request: { clientCorrectionId?: string } }>;
      order.push(`enqueue ${items.map((item) => item.request.clientCorrectionId).join(",")}`);
      return items;
    });
    const start = vi.fn(() => { order.push("start"); });
    const cancel = vi.fn(async () => { order.push("cancel"); });
    await act(async () => {
      await onQueue([{ request: { kind: "times", subject: "place", itemId: "seg-a" } }], { closing: true, beforeEnqueue: async (ids) => {
        order.push(`hold ${ids.join(",")}`);
        return { start, cancel };
      } });
    });
    expect(order).toHaveLength(3);
    const [hold, enqueue, started] = order;
    expect(hold.replace("hold ", "enqueue ")).toBe(enqueue);
    expect(started).toBe("start");
    expect(cancel).not.toHaveBeenCalled();
    // Couldn't be kept: the waiting answer goes and never starts.
    order.length = 0;
    mocks.enqueue.mockRejectedValueOnce(new Error("storage full"));
    await act(async () => {
      await expect(onQueue([{ request: { kind: "times", subject: "place", itemId: "seg-a" } }], { closing: true,
        beforeEnqueue: async () => ({ start, cancel }) })).rejects.toThrow();
    });
    expect(order).toEqual(["cancel"]);
  });

  it("queues nothing and starts no answer when the account changes while the waiting answer is kept (Codex r3 on #610)", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    type Queue = (corrections: unknown[], options: { closing: boolean; beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void; cancel: () => Promise<void> }> }) => Promise<void>;
    const onQueue = sheetOf(tree)!.props.onQueue as Queue;
    mocks.enqueue.mockClear();
    const start = vi.fn();
    const cancel = vi.fn(async () => undefined);
    let kept!: () => void;
    let queued!: Promise<void>;
    await act(async () => {
      queued = onQueue([{ request: { kind: "times", subject: "place", itemId: "seg-a" } }], { closing: true,
        beforeEnqueue: () => new Promise((resolve) => { kept = () => resolve({ start, cancel }); }) });
    });
    // Account B signs in while A's waiting answer is being kept, then the keep finishes.
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    await act(async () => {
      kept();
      await expect(queued).rejects.toThrow("The account changed.");
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows a sheet whose item left the List as it was, with nothing to change, until it closes", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    await act(async () => { tree.update(<Probe data={account("a")} timeline={{ items: [] } as unknown as LocationTimeline} />); });
    expect(sheetOf(tree)?.props).toMatchObject({ stale: true, target: { kind: "place", place: { id: "seg-a" } } });
  });

  it("says each refusal once, the second too, and keeps removing them", async () => {
    const showNotice = vi.fn();
    const refusal = (id: string, lastError: string) => ({ clientCorrectionId: id, failureKind: "permanent", lastError }) as never;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} pending={[refusal("r1", "First")]} showNotice={showNotice} />); });
    await act(async () => { tree.update(<Probe data={account("a")} pending={[refusal("r1", "First"), refusal("r2", "Second")]} showNotice={showNotice} />); });
    expect(showNotice.mock.calls.map(([message]) => message)).toEqual(["First", "Second"]);
    expect(mocks.remove).toHaveBeenLastCalledWith(["r1", "r2"]);
  });

  // Codex r2 on #602.
  it("says two refusals that arrive together in one notice", async () => {
    const showNotice = vi.fn();
    const refusal = (id: string, lastError: string) => ({ clientCorrectionId: id, failureKind: "permanent", lastError }) as never;
    await act(async () => { create(<Probe data={account("a")} pending={[refusal("r1", "First."), refusal("r2", "Second.")]} showNotice={showNotice} />); });
    expect(showNotice.mock.calls.map(([message]) => message)).toEqual(["2 changes weren't saved. First."]);
  });

  it("tries a failed removal again on its own, without a second notice", async () => {
    vi.useFakeTimers();
    try {
      const showNotice = vi.fn();
      mocks.remove.mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
      const refusal = { clientCorrectionId: "r1", failureKind: "permanent", lastError: "First." } as never;
      await act(async () => { create(<Probe data={account("a")} pending={[refusal]} showNotice={showNotice} />); });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(mocks.remove).toHaveBeenCalledTimes(2);
      expect(showNotice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still guards a sheet whose trip leaves the List after a leg's Done kept it open", async () => {
    const trip = { kind: "trip", id: "trip-1", startedAt: iso(60), stoppedAt: iso(90), fromId: "seg-a", toId: "seg-b", legs: [], blockIds: [] };
    const withTrip = { items: [place, trip] } as unknown as LocationTimeline;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} timeline={withTrip} />); });
    act(() => { api!.openTripLeg(trip as never, null); });
    const onQueue = sheetOf(tree)!.props.onQueue as (corrections: unknown[], options: { closing: boolean }) => Promise<void>;
    await act(async () => { await onQueue([{ request: { kind: "leg_mode" } }], { closing: false }); });
    await act(async () => { tree.update(<Probe data={account("a")} timeline={{ items: [place] } as unknown as LocationTimeline} />); });
    expect(sheetOf(tree)?.props.stale).toBe(true);
  });

  it("saves an unknown place at the visit's centre, then sets the visit to it (step 12 part 4)", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    await settle();
    const onSavePlace = sheetOf(tree)!.props.onSavePlace as (name: string, rest: unknown[]) => Promise<void>;
    // The visit's change isn't kept the first time; trying again never saves the place twice (Codex r1 on #606).
    mocks.enqueue.mockRejectedValueOnce(new Error("storage full"));
    await act(async () => { await expect(onSavePlace("Exampleton Bakery", [])).rejects.toThrow(); });
    const times = { request: { kind: "times", subject: "place", itemId: "seg-a", startedAt: iso(5), stoppedAt: iso(55) } };
    await act(async () => { await onSavePlace("Exampleton Bakery", [times]); });
    expect(mocks.createPlace).toHaveBeenCalledTimes(1);
    expect(mocks.createPlace).toHaveBeenCalledWith({ name: "Exampleton Bakery", latitude: 10, longitude: 20, radiusMeters: 75 },
      undefined, { userId: "a", workspaceId: "w" });
    expect(mocks.enqueue).toHaveBeenLastCalledWith({ userId: "a", workspaceId: "w" }, [{
      request: { kind: "place", subject: "place", itemId: "seg-a", placeId: "6f000000-0000-4000-8000-0000000000aa", learnedPlaceId: null },
      preview: { name: "Exampleton Bakery", role: null }
    }, times]);
    // The saved place is a choice at once, before the account's places are read again.
    expect(sheetOf(tree)!.props.places).toContainEqual({ id: "6f000000-0000-4000-8000-0000000000aa", name: "Exampleton Bakery", role: null });
  });

  it("saves a place, then keeps a waiting Logs as with the visit's corrections' ids before queueing them (Codex r4 on #610)", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    await settle();
    type Save = (name: string, rest: unknown[], beforeEnqueue?: (ids: readonly string[]) => Promise<{ start: () => void; cancel: () => Promise<void> }>) => Promise<void>;
    const onSavePlace = sheetOf(tree)!.props.onSavePlace as Save;
    const order: string[] = [];
    mocks.createPlace.mockImplementationOnce(async () => { order.push("place"); return { ok: true, place: { id: "6f000000-0000-4000-8000-0000000000bb" } }; });
    mocks.enqueue.mockImplementationOnce(async (...args: unknown[]) => {
      const items = args[1] as Array<{ request: { kind: string; clientCorrectionId?: string } }>;
      order.push(`enqueue ${items.map((item) => `${item.request.kind}:${item.request.clientCorrectionId}`).join(",")}`);
      return items;
    });
    const start = vi.fn(() => { order.push("start"); });
    const cancel = vi.fn(async () => { order.push("cancel"); });
    await act(async () => {
      await onSavePlace("Exampleton Bakery", [], async (ids) => { order.push(`hold ${ids.join(",")}`); return { start, cancel }; });
    });
    expect(order).toHaveLength(4);
    expect(order[0]).toBe("place");
    expect(order[1]).toMatch(/^hold .+$/);
    // The place's correction carries the id the waiting log waits for; log_place itself is never queued here.
    expect(order[2]).toBe(`enqueue place:${order[1].slice(5)}`);
    expect(order[3]).toBe("start");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("holds Logs as for Undo, sends it after the hold, and reads the day again once the server has it (step 12 part 4c)", async () => {
    vi.useFakeTimers();
    try {
      mocks.enqueue.mockImplementation(async (...args: unknown[]) => (args[1] as unknown[]).map((_item, index) => ({ clientCorrectionId: `log-${index}` })));
      const onLogged = vi.fn();
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} onLogged={onLogged} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { activities: Array<{ id: string }>; onLog: (id: string) => void };
      expect(logAs.activities.map((activity) => activity.id)).toEqual(["cat-errands"]);
      await act(async () => { logAs.onLog("cat-errands"); });
      expect(api!.heldLog?.title).toBe("Unknown place as Errands");
      // Undo within the hold: nothing is sent.
      act(() => { api!.undoLog(); });
      await act(async () => { vi.advanceTimersByTime(5_000); });
      expect(mocks.enqueue).not.toHaveBeenCalled();
      await act(async () => { logAs.onLog("cat-errands"); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      expect(mocks.enqueue).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" },
        [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands" } }]);
      // Only the server's acknowledgement reads the day again; leaving the queue (a refusal) does not (Codex r1 on #606).
      await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} pending={[]} />); });
      expect(onLogged).not.toHaveBeenCalled();
      await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} acknowledged={[{ clientCorrectionId: "log-0" }] as never} />); });
      expect(onLogged).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the day once for an outing's acknowledged Logs as, its trips' blocks with it, however often it is listed (#612)", async () => {
    const onLogged = vi.fn();
    const log = (clientCorrectionId: string, resolvedReviewItemIds: string[]) => ({ clientCorrectionId, acknowledgedAt: 1,
      request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands", clientCorrectionId }, resolvedReviewItemIds });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} onLogged={onLogged} />); });
    // Held for Undo or queued, nothing reads the day: no block, the place's or a trip's, comes before the server has it.
    await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} pending={[log("cid-outing", [])] as never} />); });
    expect(onLogged).not.toHaveBeenCalled();
    // Acknowledged with the trips' "?" resolved too: one read brings the place's and the trips' blocks.
    const outing = log("cid-outing", ["review-stay", "review-trip-in", "review-trip-out"]);
    await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} pending={[]} acknowledged={[outing] as never} />); });
    expect(onLogged).toHaveBeenCalledTimes(1);
    // A retry with the same id (its first reply lost) is listed again, or with another acknowledgement: never a second read for it.
    await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} acknowledged={[{ ...outing, acknowledgedAt: 2 }] as never} />); });
    expect(onLogged).toHaveBeenCalledTimes(1);
    // Another Logs as, with no trips: its own one read, as before.
    await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged}
      acknowledged={[{ ...outing, acknowledgedAt: 2 }, log("cid-plain", ["review-place"])] as never} />); });
    expect(onLogged).toHaveBeenCalledTimes(2);
  });

  it("keeps a Logs as after the sheet's corrections waiting for them, held for Undo, never queued here (Codex r4 on #610)", async () => {
    vi.useFakeTimers();
    try {
      mocks.enqueue.mockClear();
      register.waitForItemCorrections.mockClear();
      waiting.commitAnswerAfterCorrections.mockClear();
      waiting.cancelAnswerAfterCorrections.mockClear();
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<{ start: () => void; cancel: () => Promise<void> }> };
      let handle!: { start: () => void; cancel: () => Promise<void> };
      await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-1"], currentMobileAccountEpoch()); });
      expect(register.waitForItemCorrections).toHaveBeenLastCalledWith({ userId: "a", workspaceId: "w" },
        expect.objectContaining({ itemId: "seg-a", newIds: ["cid-1"], action: { kind: "log", categoryId: "cat-errands" } }));
      const recordId = (register.waitForItemCorrections.mock.calls.at(-1)![1] as { id: string }).id;
      act(() => { handle.start(); });
      expect(api!.heldLog?.title).toBe("Unknown place as Errands");
      await act(async () => { vi.advanceTimersByTime(4_800); });
      // Its Undo ended: the record may go once the corrections are acknowledged; log_place isn't queued from here.
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith(recordId);
      expect(mocks.enqueue).not.toHaveBeenCalled();
      // Undo takes back the Logs as only.
      await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-2"], currentMobileAccountEpoch()); });
      act(() => { handle.start(); });
      act(() => { api!.undoLog(); });
      await act(async () => { vi.advanceTimersByTime(5_000); });
      expect(waiting.cancelAnswerAfterCorrections).toHaveBeenCalledOnce();
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes a plain Logs as wait for the place's corrections still queued from an earlier Done (Codex r5 on #610)", async () => {
    vi.useFakeTimers();
    try {
      mocks.enqueue.mockClear();
      waiting.holdAnswerAfterCorrections.mockClear();
      waiting.commitAnswerAfterCorrections.mockClear();
      waiting.noteTimelineCorrectionAcknowledged.mockClear();
      // Saved offline earlier (still queued), for this place and for another.
      mocks.queued = [{ clientCorrectionId: "earlier-1", request: { kind: "place", itemId: "seg-a" } },
        { clientCorrectionId: "other", request: { kind: "times", itemId: "seg-b" } }];
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
      await act(async () => { logAs.onLog("cat-errands"); });
      expect(await register.waitForItemCorrections.mock.results.at(-1)!.value).toMatchObject({ waitsFor: ["earlier-1"] });
      expect(register.waitForItemCorrections).toHaveBeenLastCalledWith({ userId: "a", workspaceId: "w" },
        expect.objectContaining({ itemId: "seg-a", newIds: [], action: { kind: "log", categoryId: "cat-errands" } }));
      const recordId = (register.waitForItemCorrections.mock.calls.at(-1)![1] as { id: string }).id;
      expect(api!.heldLog?.afterCorrections).toBe(recordId);
      await act(async () => { vi.advanceTimersByTime(4_800); });
      // Never queued from here: only once the earlier correction is acknowledged (a refusal logs nothing).
      expect(waiting.commitAnswerAfterCorrections).toHaveBeenCalledWith(recordId);
      expect(mocks.enqueue).not.toHaveBeenCalled();
      // Nothing waiting for the place: held and queued at once, as before.
      mocks.queued = [];
      await act(async () => { logAs.onLog("cat-errands"); });
      expect(await register.waitForItemCorrections.mock.results.at(-1)!.value).toBeNull();
      await act(async () => { vi.advanceTimersByTime(4_800); });
      expect(mocks.enqueue).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" },
        [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands" } }]);
    } finally {
      mocks.queued = [];
      vi.useRealTimers();
    }
  });

  it("registers every Logs as through the one shared helper, with the sheet's new corrections and its place (Codex r6 on #610)", async () => {
    register.waitForItemCorrections.mockClear();
    mocks.queued = [{ clientCorrectionId: "earlier-1", request: { kind: "times", itemId: "seg-a" } }];
    try {
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<unknown> };
      await act(async () => { await logAs.onLogAfter("cat-errands", ["new-1"], currentMobileAccountEpoch()); });
      expect(register.waitForItemCorrections).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" },
        expect.objectContaining({ itemId: "seg-a", newIds: ["new-1"], action: { kind: "log", categoryId: "cat-errands" } }));
      expect(await register.waitForItemCorrections.mock.results.at(-1)!.value).toMatchObject({ waitsFor: ["new-1", "earlier-1"] });
    } finally {
      mocks.queued = [];
    }
  });

  it("settles a waiting Logs as through the store's shared path, saying it wasn't logged only while still in front (Codex r12 on #610)", async () => {
    vi.useFakeTimers();
    try {
      const showNotice = vi.fn();
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={showNotice} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<{ start: () => void }> };
      // Given up in front: said.
      waiting.settleOutcome = "abandoned";
      waiting.settleAnswerAfterCorrections.mockClear();
      let handle!: { start: () => void };
      await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-1"], currentMobileAccountEpoch()); });
      act(() => { handle.start(); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledWith(expect.anything(), expect.any(String), { inFront: true });
      expect(showNotice).toHaveBeenCalledWith("That place wasn't logged. Try again.");
      // Its write is slow and Dayframe leaves meanwhile: given up, but nothing said.
      showNotice.mockClear();
      let finish!: () => void;
      waiting.settleAnswerAfterCorrections.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve("abandoned"); }));
      await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-2"], currentMobileAccountEpoch()); });
      act(() => { handle.start(); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      mocks.appState = "background";
      await act(async () => { finish(); await Promise.resolve(); });
      expect(showNotice).not.toHaveBeenCalled();
    } finally {
      mocks.appState = "active";
      waiting.settleOutcome = "committed";
      vi.useRealTimers();
    }
  });

  it("keeps a Logs as at once, quietly, when the Dashboard goes away during its Undo (Codex r13 on #610)", async () => {
    vi.useFakeTimers();
    try {
      const showNotice = vi.fn();
      // A waiting one: let go to wait for its corrections, nothing said.
      waiting.settleAnswerAfterCorrections.mockClear();
      waiting.settleOutcome = "abandoned";
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={showNotice} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void; onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<{ start: () => void }> };
      let handle!: { start: () => void };
      await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-1"], currentMobileAccountEpoch()); });
      act(() => { handle.start(); });
      await act(async () => { tree.unmount(); });
      expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledWith(expect.anything(), expect.any(String), { inFront: false });
      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledTimes(1);
      expect(showNotice).not.toHaveBeenCalled();
      // A plain one: kept on the phone at once, never sent from here.
      mocks.enqueue.mockClear();
      mocks.synchronise.mockClear();
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={showNotice} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const plain = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
      await act(async () => { plain.onLog("cat-errands"); });
      await act(async () => { tree.unmount(); });
      expect(mocks.enqueue).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" },
        [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands" } }]);
      expect(mocks.synchronise).not.toHaveBeenCalled();
    } finally {
      waiting.settleOutcome = "committed";
      vi.useRealTimers();
    }
  });

  it("ends every late Logs as start in one way: gone → settled quietly, another account → withdrawn, never held (Codex r14 on #610)", async () => {
    waiting.settleAnswerAfterCorrections.mockClear();
    waiting.withdrawAnswerAfterCorrections.mockClear();
    // The place sheets go away between its registration and its start (after the corrections are queued).
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    let logAs = sheetOf(tree)!.props.logAs as { onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<{ start: () => void }> };
    let handle!: { start: () => void };
    await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-1"], currentMobileAccountEpoch()); });
    await act(async () => { tree.unmount(); });
    act(() => { handle.start(); });
    expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledWith(expect.anything(), expect.any(String), { inFront: false });
    expect(api!.heldLog).toBeNull();
    // Another account signs in between its registration and its start.
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    logAs = sheetOf(tree)!.props.logAs as typeof logAs;
    await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-2"], currentMobileAccountEpoch()); });
    const recordId = (register.waitForItemCorrections.mock.calls.at(-1)![1] as { id: string }).id;
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    act(() => { handle.start(); });
    expect(waiting.withdrawAnswerAfterCorrections).toHaveBeenCalledWith(expect.anything(), recordId);
    expect(api!.heldLog).toBeNull();
  });

  it("finds a Logs as hold started in the same batch as its unmount, and settles it (Codex r15 on #610)", async () => {
    waiting.settleAnswerAfterCorrections.mockClear();
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    const logAs = sheetOf(tree)!.props.logAs as { onLogAfter: (id: string, ids: readonly string[], generation: number) => Promise<{ start: () => void }> };
    let handle!: { start: () => void };
    await act(async () => { handle = await logAs.onLogAfter("cat-errands", ["cid-1"], currentMobileAccountEpoch()); });
    // The hold starts and the place sheets go away before any re-render.
    act(() => {
      handle.start();
      tree.unmount();
    });
    expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledOnce();
    expect(waiting.settleAnswerAfterCorrections).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" }, expect.any(String), { inFront: false });
  });

  it("says nothing of a late plain Logs as failure after teardown, backgrounding or an account switch (Codex r15 on #610)", async () => {
    vi.useFakeTimers();
    try {
      const showNotice = vi.fn();
      const failLater = () => {
        let fail!: () => void;
        mocks.enqueue.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = () => reject(new Error("disk full")); }));
        return () => act(async () => { fail(); await Promise.resolve(); await Promise.resolve(); });
      };
      const holdAndEnd = async (tree: ReturnType<typeof create>) => {
        act(() => { api!.openPlace(place, "Unknown place"); });
        const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
        await act(async () => { logAs.onLog("cat-errands"); });
        await act(async () => { vi.advanceTimersByTime(4_800); });
      };
      // Teardown.
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={showNotice} />); });
      let fail = failLater();
      await holdAndEnd(tree);
      await act(async () => { tree.unmount(); });
      await fail();
      // Backgrounding.
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={showNotice} />); });
      fail = failLater();
      await holdAndEnd(tree);
      mocks.appState = "background";
      await fail();
      mocks.appState = "active";
      // An account switch.
      fail = failLater();
      await holdAndEnd(tree);
      await act(async () => { tree.update(<Probe data={account("b")} showNotice={showNotice} />); });
      await fail();
      expect(showNotice).not.toHaveBeenCalled();
      // In front, same account, here: said.
      await act(async () => { tree.update(<Probe data={account("a")} showNotice={showNotice} />); });
      fail = failLater();
      await holdAndEnd(tree);
      await fail();
      expect(showNotice).toHaveBeenCalledWith("That place wasn't logged. Try again.");
    } finally {
      mocks.appState = "active";
      vi.useRealTimers();
    }
  });

  it("keeps the Logs as hold through Dashboard renders, and keeps it on the phone when the app leaves (Codex r1 on #606)", async () => {
    vi.useFakeTimers();
    try {
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} showNotice={() => undefined} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
      await act(async () => { logAs.onLog("cat-errands"); });
      await act(async () => { vi.advanceTimersByTime(4_000); });
      // A Dashboard render with a new notice callback doesn't restart the 4.8 s.
      await act(async () => { tree.update(<Probe data={account("a")} showNotice={() => undefined} />); });
      await act(async () => { vi.advanceTimersByTime(900); });
      expect(mocks.enqueue).toHaveBeenCalledTimes(1);
      expect(mocks.synchronise).toHaveBeenCalledTimes(1);

      await act(async () => { logAs.onLog("cat-errands"); });
      await act(async () => { for (const listener of mocks.appListeners) listener("background"); });
      expect(mocks.enqueue).toHaveBeenCalledTimes(2);
      // Kept, not sent from the background.
      expect(mocks.synchronise).toHaveBeenCalledTimes(1);
      expect(api!.heldLog).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex r2 on #606.
  it("queues a hold once, never sends from the background, and never lets another account's late Done replace a hold", async () => {
    vi.useFakeTimers();
    try {
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<Probe data={account("a")} />); });
      act(() => { api!.openPlace(place, "Unknown place"); });
      const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
      // Two endings before React commits: queued once.
      await act(async () => { logAs.onLog("cat-errands"); });
      await act(async () => {
        for (const listener of mocks.appListeners) listener("inactive");
        for (const listener of mocks.appListeners) listener("background");
      });
      expect(mocks.enqueue).toHaveBeenCalledTimes(1);

      // The hold ends while storage is slow and the app leaves: kept, not sent.
      let kept!: (value: unknown[]) => void;
      mocks.enqueue.mockImplementationOnce(() => new Promise((resolve) => { kept = resolve as never; }));
      await act(async () => { logAs.onLog("cat-errands"); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      mocks.appState = "background";
      await act(async () => { kept([{ clientCorrectionId: "late" }]); });
      expect(mocks.synchronise).not.toHaveBeenCalled();
      mocks.appState = "active";

      // A's sheet finishing after B signed in never touches B's hold.
      await act(async () => { tree.update(<Probe data={account("b")} />); });
      await act(async () => { logAs.onLog("cat-errands"); });
      expect(api!.heldLog).toBeNull();
    } finally {
      mocks.appState = "active";
      vi.useRealTimers();
    }
  });

  // Codex r3 on #606.
  it("sends the sheet's corrections only in front, and keeps a hold made in the background at once without sending it", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    const onQueue = sheetOf(tree)!.props.onQueue as (corrections: unknown[], options: { closing: boolean }) => Promise<void>;
    await act(async () => { await onQueue([{ request: { kind: "times" } }], { closing: true }); });
    const drain = mocks.synchronise.mock.calls.at(-1)?.[0] as { isForeground?: () => boolean };
    expect(drain.isForeground?.()).toBe(true);
    mocks.appState = "background";
    expect(drain.isForeground?.()).toBe(false);

    act(() => { api!.openPlace(place, "Unknown place"); });
    const logAs = sheetOf(tree)!.props.logAs as { onLog: (id: string) => void };
    const sends = mocks.synchronise.mock.calls.length;
    await act(async () => { logAs.onLog("cat-errands"); });
    expect(mocks.enqueue).toHaveBeenLastCalledWith({ userId: "a", workspaceId: "w" },
      [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands" } }]);
    expect(mocks.synchronise.mock.calls.length).toBe(sends);
    expect(api!.heldLog).toBeNull();
    mocks.appState = "active";
  });
});

