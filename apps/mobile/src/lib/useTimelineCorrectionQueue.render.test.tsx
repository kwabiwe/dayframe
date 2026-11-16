import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { LocationTimeline } from "@dayframe/shared";

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
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({ status: "authenticated", snapshot: { generation: 1, owner, token: "t" } }))
}));

const account = await import("./mobileAccount");
const outbox = await import("./timelineCorrectionOutbox");
const { usePlaceLogReceipts, useTimelineCorrectionQueue } = await import("./useTimelineCorrectionQueue");

// Location v4 step 12: synthetic ids only.
const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
let seen: ReturnType<typeof useTimelineCorrectionQueue> | null = null;
function Probe({ owner, timeline = null, requestedAt = null, canonicalEntryIds }: {
  owner: typeof OWNER | null;
  timeline?: LocationTimeline | null;
  requestedAt?: number | null;
  canonicalEntryIds?: ReadonlySet<string>;
}) {
  const queue = useTimelineCorrectionQueue(owner);
  const acknowledged = usePlaceLogReceipts(owner, queue.acknowledged, canonicalEntryIds, timeline, requestedAt);
  seen = { ...queue, acknowledged };
  return null;
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const visitTimeline = (id: string, blockIds: string[]): LocationTimeline => ({
  date: "2026-11-03", timeZone: "UTC", dayStart: "2026-11-03T00:00:00Z", dayEnd: "2026-11-04T00:00:00Z",
  items: [{ kind: "place", id, status: "closed", startedAt: "2026-11-03T08:00:00Z", stoppedAt: "2026-11-03T08:45:00Z",
    placeId: null, learnedPlaceId: null, name: null, role: null, matchKind: "unknown", confidence: "sure", blockIds }],
  openTrip: null, gaps: []
});

describe("the List's queued corrections (location v4 step 12)", () => {
  beforeEach(async () => {
    storage.clear();
    account.__resetMobileAccountForTests();
    await account.activateMobileAccount(OWNER);
    seen = null;
    outbox.__resetTimelineCorrectionOutboxForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows each correction as it is queued, and counts a delivery so the timeline is read again", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Probe, { owner: OWNER })); });
    await flush();
    expect(seen).toEqual({ pending: [], acknowledged: [], delivered: 0 });
    const queued = await outbox.enqueueTimelineCorrection(OWNER, { kind: "delete", subject: "trip", itemId: "trip-1" });
    await flush();
    expect(seen!.pending.map((item) => item.clientCorrectionId)).toEqual([queued.clientCorrectionId]);
    // A refusal shows from the queue, but the timeline is read again only for an acknowledgement (Codex r2 on #598).
    // Saved, refused, saved in one pass: one read of the timeline (Codex r3 on #598).
    const savedFirst = await outbox.enqueueTimelineCorrection(OWNER, { kind: "delete", subject: "trip", itemId: "trip-0" });
    const refusedThenSaved = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "in a block" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", refusedThenSaved);
    const second = await outbox.enqueueTimelineCorrection(OWNER, { kind: "delete", subject: "trip", itemId: "trip-2" });
    await outbox.synchroniseTimelineCorrections({ owner: OWNER });
    await flush();
    expect(seen!.delivered).toBe(1);
    // In order: the first queued is saved, the next refused, the last saved.
    expect(seen!.acknowledged.map((item) => item.clientCorrectionId)).toEqual([queued.clientCorrectionId, second.clientCorrectionId]);
    expect(seen!.pending).toEqual([expect.objectContaining({ clientCorrectionId: savedFirst.clientCorrectionId, failureKind: "permanent" })]);
    // Signed out: nothing of the last account's.
    await act(async () => { tree.update(createElement(Probe, { owner: null })); });
    expect(seen).toEqual({ pending: [], acknowledged: [], delivered: 0 });
  });

  it("shows a Logs as acknowledged while a later correction's reply is still held (Codex r1 on #617)", async () => {
    await act(async () => { create(createElement(Probe, { owner: OWNER })); });
    await flush();
    const log = await outbox.enqueueTimelineCorrection(OWNER, { kind: "log_place", subject: "place", itemId: "seg-stay",
      categoryId: "6f000000-0000-4000-8000-0000000000c1" });
    const later = await outbox.enqueueTimelineCorrection(OWNER, { kind: "delete", subject: "trip", itemId: "trip-9" });
    let release!: () => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, logged: { entryIds: ["e-stay", "e-trip"],
        resolvedReviewItemIds: ["review-trip", "review-stay"] } }), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      })));
    const pass = outbox.synchroniseTimelineCorrections({ owner: OWNER });
    await flush();
    await flush();
    // The later request is still out: the Logs as and the "?" it resolved are already shown.
    expect(seen!.acknowledged).toEqual([expect.objectContaining({ clientCorrectionId: log.clientCorrectionId,
      resolvedReviewItemIds: ["review-trip", "review-stay"] })]);
    expect(seen!.pending.map((item) => item.clientCorrectionId)).toEqual([later.clientCorrectionId]);
    await act(async () => { release(); await pass; });
    await flush();
    expect(seen!.acknowledged.map((item) => item.clientCorrectionId)).toEqual([log.clientCorrectionId, later.clientCorrectionId]);
    expect(seen!.delivered).toBe(1);
  });

  it("retires a logged place deleted before the phone displays it only after a fresh read of that visit", async () => {
    await outbox.enqueueTimelineCorrection(OWNER, { kind: "log_place", subject: "place", itemId: "seg-stay", description: "Cafe" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ logged: { placeEntryIds: ["e-stay"] } }))));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER });
    const [log] = outbox.readAcknowledgedTimelineCorrections(OWNER);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Probe, { owner: OWNER })); });
    await flush();
    expect(seen!.acknowledged).toHaveLength(1);
    const show = (timeline: LocationTimeline, requestedAt: number) => act(async () => {
      tree.update(createElement(Probe, { owner: OWNER, timeline, requestedAt }));
    });
    await show(visitTimeline("seg-stay", []), log.acknowledgedAt - 1);
    expect(seen!.acknowledged).toHaveLength(1);
    await show(visitTimeline("other-stay", []), log.acknowledgedAt + 1);
    expect(seen!.acknowledged).toHaveLength(1);
    await show(visitTimeline("seg-stay", ["e-stay"]), log.acknowledgedAt + 2);
    expect(seen!.acknowledged).toHaveLength(1);
    await show(visitTimeline("seg-stay", ["unrelated-entry"]), log.acknowledgedAt + 3);
    await flush();
    expect(seen!.acknowledged).toEqual([]);
    await act(async () => { tree.unmount(); });
    outbox.__resetTimelineCorrectionOutboxForTests();
    await outbox.readPendingTimelineCorrections(OWNER);
    expect(outbox.readAcknowledgedTimelineCorrections(OWNER)).toEqual([]);
  });

  it("retires an older API receipt when the timeline links its own place block", async () => {
    await outbox.enqueueTimelineCorrection(OWNER, { kind: "log_place", subject: "place", itemId: "seg-stay", description: "Cafe" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ logged: { entryIds: ["e-stay", "e-trip"] } }))));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER });
    const [log] = outbox.readAcknowledgedTimelineCorrections(OWNER);
    const props = { owner: OWNER, timeline: visitTimeline("seg-stay", ["e-stay"]), requestedAt: log.acknowledgedAt + 1 };
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(createElement(Probe, { ...props, canonicalEntryIds: new Set(["e-trip"]) })); });
    await flush();
    expect(seen!.acknowledged).toHaveLength(1);
    await act(async () => { tree.update(createElement(Probe, { ...props, canonicalEntryIds: new Set(["e-stay"]) })); });
    await flush();
    expect(seen!.acknowledged).toEqual([]);
    await act(async () => { tree.unmount(); });
  });
});
