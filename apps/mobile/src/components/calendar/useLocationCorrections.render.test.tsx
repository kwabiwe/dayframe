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
  synchronise: vi.fn(async () => undefined)
}));
vi.mock("../../lib/api", () => ({ createPlace: mocks.createPlace, fetchTimelineItemEvidence: mocks.fetchEvidence }));
vi.mock("../../lib/timelineCorrectionOutbox", () => ({
  enqueueTimelineCorrections: mocks.enqueue,
  removeTimelineCorrections: mocks.remove,
  synchroniseTimelineCorrections: mocks.synchronise
}));
vi.mock("./LocationCorrectionSheet", () => ({ LocationCorrectionSheet: "LocationCorrectionSheet" }));

const { useLocationCorrections } = await import("./useLocationCorrections");

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
  onLogged?: () => void }) {
  api = useLocationCorrections({ clockFormat: "24h", data: props.data, onLogged: props.onLogged, pending: props.pending ?? [], reduceMotion: false,
    showNotice: props.showNotice ?? vi.fn(), theme: {} as never, timeline: props.timeline === undefined ? timeline : props.timeline });
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
    const onSavePlace = sheetOf(tree)!.props.onSavePlace as (name: string) => Promise<void>;
    await act(async () => { await onSavePlace("Exampleton Bakery"); });
    expect(mocks.createPlace).toHaveBeenCalledWith({ name: "Exampleton Bakery", latitude: 10, longitude: 20, radiusMeters: 75 });
    expect(mocks.enqueue).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" }, [{
      request: { kind: "place", subject: "place", itemId: "seg-a", placeId: "6f000000-0000-4000-8000-0000000000aa", learnedPlaceId: null },
      preview: { name: "Exampleton Bakery", role: null }
    }]);
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
      act(() => { logAs.onLog("cat-errands"); });
      expect(api!.heldLog?.title).toBe("Unknown place as Errands");
      // Undo within the hold: nothing is sent.
      act(() => { api!.undoLog(); });
      await act(async () => { vi.advanceTimersByTime(5_000); });
      expect(mocks.enqueue).not.toHaveBeenCalled();
      act(() => { logAs.onLog("cat-errands"); });
      await act(async () => { vi.advanceTimersByTime(4_800); });
      expect(mocks.enqueue).toHaveBeenCalledWith({ userId: "a", workspaceId: "w" },
        [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "cat-errands" } }]);
      const queued = { clientCorrectionId: "log-0", failureKind: undefined } as never;
      await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} pending={[queued]} />); });
      expect(onLogged).not.toHaveBeenCalled();
      await act(async () => { tree.update(<Probe data={account("a")} onLogged={onLogged} pending={[]} />); });
      expect(onLogged).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

