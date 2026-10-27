import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const { createElement } = await import("react");

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); })
  }
}));

vi.mock("./secure-session", () => ({
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async () => ({ status: "signed_out" }))
}));

const outbox = await import("./timelineCorrectionOutbox");
const { useTimelineCorrectionQueue } = await import("./useTimelineCorrectionQueue");

// Location v4 step 12: synthetic ids only.
const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
let seen: ReturnType<typeof useTimelineCorrectionQueue> | null = null;
function Probe({ owner }: { owner: typeof OWNER | null }) {
  seen = useTimelineCorrectionQueue(owner);
  return null;
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("the List's queued corrections (location v4 step 12)", () => {
  beforeEach(() => {
    storage.clear();
    seen = null;
    outbox.__resetTimelineCorrectionOutboxForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows each correction as it is queued, and counts a delivery so the timeline is read again", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Probe, { owner: OWNER })); });
    await flush();
    expect(seen).toEqual({ pending: [], delivered: 0 });
    const queued = await outbox.enqueueTimelineCorrection(OWNER, { kind: "delete", subject: "trip", itemId: "trip-1" });
    await flush();
    expect(seen!.pending.map((item) => item.clientCorrectionId)).toEqual([queued.clientCorrectionId]);
    await outbox.removeTimelineCorrections([queued.clientCorrectionId]);
    await flush();
    expect(seen).toEqual({ pending: [], delivered: 1 });
    // Signed out: nothing of the last account's.
    await act(async () => { tree.update(createElement(Probe, { owner: null })); });
    expect(seen).toEqual({ pending: [], delivered: 0 });
  });
});
