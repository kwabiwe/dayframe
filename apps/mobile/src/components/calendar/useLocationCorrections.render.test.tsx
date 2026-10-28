import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline, TimelinePlace } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  fetchEvidence: vi.fn(async () => ({ segment: { kind: "stay" } })),
  enqueue: vi.fn(async () => []),
  remove: vi.fn(async () => undefined),
  synchronise: vi.fn(async () => undefined)
}));
vi.mock("../../lib/api", () => ({ fetchTimelineItemEvidence: mocks.fetchEvidence }));
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
const account = (userId: string) => ({ places: [], user: { id: userId }, workspace: { id: "w" } }) as never;
let api: ReturnType<typeof useLocationCorrections> | null = null;
function Probe(props: { data: ReturnType<typeof account> | null; pending?: never[]; showNotice?: (message: string) => void; timeline?: LocationTimeline | null }) {
  api = useLocationCorrections({ clockFormat: "24h", data: props.data, pending: props.pending ?? [], reduceMotion: false,
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
    expect(sheetOf(tree)?.props.evidence).toEqual({ segment: { kind: "stay" } });
    await act(async () => { tree.update(<Probe data={null} />); });
    expect(sheetOf(tree)).toBeNull();
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    expect(sheetOf(tree)).toBeNull();
  });

  it("keeps a sheet's corrections only for the account it opened for", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Probe data={account("a")} />); });
    act(() => { api!.openPlace(place, "Unknown place"); });
    const onQueue = sheetOf(tree)!.props.onQueue as (corrections: unknown[]) => Promise<void>;
    await act(async () => { tree.update(<Probe data={account("b")} />); });
    await expect(onQueue([{ request: { kind: "times" } }])).rejects.toThrow();
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
});
