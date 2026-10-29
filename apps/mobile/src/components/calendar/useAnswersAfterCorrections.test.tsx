import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "../../lib/api";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const storage = vi.hoisted(() => Object.assign(new Map<string, string>(), { failWrites: 0, beforeWrite: null as null | (() => void) }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    removeItem: async (key: string) => {
      if (storage.failWrites > 0) {
        storage.failWrites -= 1;
        throw new Error("disk full");
      }
      storage.delete(key);
    },
    setItem: async (key: string, value: string) => {
      storage.beforeWrite?.();
      if (storage.failWrites > 0) {
        storage.failWrites -= 1;
        throw new Error("disk full");
      }
      storage.set(key, value);
    }
  }
}));
const native = vi.hoisted(() => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Alert: { alert: vi.fn() },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) }
}));
vi.mock("react-native", () => native);
const outbox = vi.hoisted(() => ({
  pending: [] as Array<{ clientCorrectionId: string; failureKind?: string }>,
  listeners: new Set<() => void>(),
  enqueue: vi.fn(async (_owner: unknown, items: unknown[]) => items),
  synchronise: vi.fn(async () => ({}))
}));
vi.mock("../../lib/timelineCorrectionOutbox", () => ({
  enqueueTimelineCorrections: outbox.enqueue,
  synchroniseTimelineCorrections: outbox.synchronise,
  readPendingTimelineCorrections: async () => outbox.pending,
  readAcknowledgedTimelineCorrections: () => [],
  subscribeTimelineCorrectionOutbox: (listener: () => void) => { outbox.listeners.add(listener); return () => outbox.listeners.delete(listener); }
}));
const review = vi.hoisted(() => ({ enqueueReviewMutation: vi.fn(async (_input: Record<string, unknown>) => undefined), synchroniseReviewMutations: vi.fn(async () => undefined) }));
vi.mock("../../lib/reviewSyncStore", () => review);
vi.mock("../../lib/reviewAnswerClaims", () => ({ reviewAnswersDecided: async () => new Set() }));

import * as answers from "../../lib/reviewAnswersAfterCorrections";
import { useAnswersAfterCorrections } from "./useAnswersAfterCorrections";

// Codex r2 on #610: synthetic ids only.
const OWNER = { userId: "user-a", workspaceId: "ws-a" };
const C1 = "6f000000-0000-4000-8000-000000000001";
const item = { id: "ri-1", status: "open", eventSource: "location_learning", eventType: "unknown_stay", rawPayload: { clientSegmentId: "seg-a" },
  suggestedStartedAt: "2026-10-27T09:00:00.000Z", suggestedStoppedAt: "2026-10-27T10:00:00.000Z" };
const data = { user: { id: "user-a" }, workspace: { id: "ws-a" }, reviewItems: [item] } as unknown as MobileBootstrap;
const flush = () => act(async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });

const dropped = vi.hoisted(() => vi.fn());
function Probe({ owner }: { owner: typeof OWNER | null }) {
  probe.current = useAnswersAfterCorrections({ data, owner, onDropped: dropped });
  return null;
}
const probe: { current: ReturnType<typeof useAnswersAfterCorrections> | null } = { current: null };

describe("the Dashboard's release of answers after corrections (Codex r2 on #610)", () => {
  it("hides the waiting \"?\", and once Dayframe opens again with its corrections acknowledged, saves the answer through the Review outbox", async () => {
    storage.clear();
    review.enqueueReviewMutation.mockClear();
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-1", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections("m-1");
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    expect(probe.current!.waitingIds.has("ri-1")).toBe(true);
    expect(review.enqueueReviewMutation).not.toHaveBeenCalled();
    // The server acknowledges it (the outbox marks it before letting go), and the outbox says so.
    await answers.noteTimelineCorrectionAcknowledged(OWNER, C1);
    outbox.pending = [];
    act(() => { for (const listener of outbox.listeners) listener(); });
    await flush();
    expect(review.enqueueReviewMutation).toHaveBeenCalledOnce();
    expect(review.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({ clientMutationId: "m-1", mutation: { action: "confirm" } });
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    // Another account sees none of it.
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-2", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    act(() => { tree.update(<Probe owner={{ userId: "user-b", workspaceId: "ws-b" }} />); });
    await flush();
    expect(probe.current!.waitingIds.size).toBe(0);
    act(() => { tree.unmount(); });
  });

  it("queues a waiting Logs as as log_place only once its corrections are acknowledged, and never after a refusal (Codex r4 on #610)", async () => {
    storage.clear();
    outbox.enqueue.mockClear();
    const LOG = "6f000000-0000-4000-8000-0000000000aa";
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: LOG, reviewItemId: "", logged: true,
      log: { itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1" }, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections(LOG);
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    // Waiting: nothing logged, and the place's "?" stays out meanwhile.
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(probe.current!.waitingSegments.has("seg-a")).toBe(true);
    await answers.noteTimelineCorrectionAcknowledged(OWNER, C1);
    outbox.pending = [];
    act(() => { for (const listener of outbox.listeners) listener(); });
    await flush();
    expect(outbox.enqueue).toHaveBeenCalledWith(OWNER, [{ request: { kind: "log_place", subject: "place", itemId: "seg-a",
      categoryId: "6f000000-0000-4000-8000-0000000000c1", clientCorrectionId: LOG } }]);
    expect(probe.current!.waitingSegments.size).toBe(0);
    // Refused: dropped, nothing logged.
    outbox.enqueue.mockClear();
    outbox.pending = [{ clientCorrectionId: C1, failureKind: "permanent" }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: LOG, reviewItemId: "", logged: true,
      log: { itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1" }, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections(LOG);
    await flush();
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(await answers.readAnswersAfterCorrections(OWNER)).toEqual([]);
    act(() => { tree.unmount(); });
  });

  it("releases a waiting outing answer as one confirm_outing with its trips (Codex r10 on #610)", async () => {
    storage.clear();
    review.enqueueReviewMutation.mockClear();
    outbox.pending = [];
    const trip = (id: string) => ({ ...item, id, eventType: "commute_detected", rawPayload: { clientSegmentId: `seg-${id}` } });
    const outingData = { ...data, reviewItems: [item, trip("ri-in"), trip("ri-out")] } as unknown as MobileBootstrap;
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-out", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    // The record as the gate writes it for an outing.
    const stored = JSON.parse(storage.get("dayframe.reviewAnswersAfterCorrections.v1")!) as Array<Record<string, unknown>>;
    storage.set("dayframe.reviewAnswersAfterCorrections.v1", JSON.stringify(stored.map((record) => ({ ...record, outingMemberIds: ["ri-in", "ri-out"], acknowledged: [C1] }))));
    await answers.commitAnswerAfterCorrections("m-out");
    function OutingProbe() {
      useAnswersAfterCorrections({ data: outingData, owner: OWNER });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<OutingProbe />); });
    await flush();
    expect(review.enqueueReviewMutation).toHaveBeenCalledOnce();
    expect(review.enqueueReviewMutation.mock.calls[0][0]).toMatchObject({ clientMutationId: "m-out",
      mutation: { action: "confirm_outing", memberReviewItemIds: ["ri-in", "ri-out"] } });
    expect((review.enqueueReviewMutation.mock.calls[0][0] as { affectedItems: Array<{ id: string }> }).affectedItems.map((each) => each.id))
      .toEqual(["ri-1", "ri-in", "ri-out"]);
    act(() => { tree.unmount(); });
  });

  it("keeps a waiting outing's trips hidden after a remount, with its stay (Codex r11 on #610)", async () => {
    storage.clear();
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.registerAfterCorrections(OWNER, { id: "m-out", reviewItemId: "ri-1", logged: true, outingMemberIds: ["ri-in", "ri-out"],
      newIds: [C1], itemIds: ["seg-a"] }, { readPending: async () => [], readAcknowledged: () => [] });
    await answers.commitAnswerAfterCorrections("m-out");
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    act(() => { tree.unmount(); });
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    expect([...probe.current!.waitingIds].sort()).toEqual(["ri-1", "ri-in", "ri-out"]);
    act(() => { tree.unmount(); });
  });

  it("carries on with a failed commit after the Dashboard goes away and comes back to the front (Codex r11 on #610)", async () => {
    storage.clear();
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-c", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    // Undo ends while away: the write fails, and the record is `committing` (still hiding its "?").
    storage.failWrites = 1;
    expect(await answers.settleAnswerAfterCorrections(OWNER, "m-c", { inFront: false })).toBe("committing");
    act(() => { tree.unmount(); });
    expect((await answers.readAnswersAfterCorrectionsWithState(OWNER))[0].state).toBe("committing");
    // A new Dashboard, in front: the store's runner tries again, and it is committed.
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    expect((await answers.readAnswersAfterCorrectionsWithState(OWNER))[0].state).toBe("committed");
    expect(probe.current!.waitingIds.has("ri-1")).toBe(true);
    act(() => { tree.unmount(); });
    // Failing again on that return: given up, and its "?" shows (its deletion still being tried).
    storage.clear();
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-d", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    storage.failWrites = 1;
    await answers.settleAnswerAfterCorrections(OWNER, "m-d", { inFront: false });
    dropped.mockClear();
    storage.failWrites = 1;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    // Given up: its record went (or, its deletion failing, would be abandoned), and its "?" shows again.
    expect((await answers.readAnswersAfterCorrectionsWithState(OWNER)).filter((each) => each.state !== "abandoned")).toEqual([]);
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    expect(dropped).toHaveBeenCalledWith(["ri-1"]);
    act(() => { tree.unmount(); });
    storage.failWrites = 0;
  });

  it("gives an answer back but says nothing when Dayframe leaves during the runner's slow write (Codex r12 on #610)", async () => {
    storage.clear();
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-slow", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    storage.failWrites = 1;
    await answers.settleAnswerAfterCorrections(OWNER, "m-slow", { inFront: false });
    native.Alert.alert.mockClear();
    native.AccessibilityInfo.announceForAccessibility.mockClear();
    dropped.mockClear();
    // The runner's retry write fails and, while it runs, Dayframe goes to the background.
    storage.failWrites = 1;
    storage.beforeWrite = () => { native.AppState.currentState = "background"; };
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    storage.beforeWrite = null;
    native.AppState.currentState = "active";
    expect(dropped).toHaveBeenCalledWith(["ri-1"]);
    expect(native.Alert.alert).not.toHaveBeenCalled();
    expect(native.AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    act(() => { tree.unmount(); });
  });

  it("keeps an abandoned answer's \"?\" visible through a new answer and its Undo, while its deletion fails (Codex r11 on #610)", async () => {
    storage.clear();
    outbox.pending = [{ clientCorrectionId: C1 }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-old", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    // Given up, and its deletion fails: abandoned, so it hides nothing.
    storage.failWrites = 3;
    expect(await answers.settleAnswerAfterCorrections(OWNER, "m-old", { inFront: true })).toBe("abandoned");
    storage.failWrites = 0;
    // Its record is still there (its deletion failed), abandoned.
    expect((await answers.readAnswersAfterCorrectionsWithState(OWNER)).map((each) => [each.record.id, each.state])).toEqual([["m-old", "abandoned"]]);
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe owner={OWNER} />); });
    await flush();
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    // Answered again (a new record, held), then Undo: the old record never hides it again.
    await answers.registerAfterCorrections(OWNER, { id: "m-new", reviewItemId: "ri-1", logged: true, newIds: [C1], itemIds: ["seg-a"] },
      { readPending: async () => [], readAcknowledged: () => [] });
    await flush();
    expect(probe.current!.waitingIds.has("ri-1")).toBe(true);
    await answers.cancelAnswerAfterCorrections("m-new");
    await flush();
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    act(() => { tree.unmount(); });
  });

  it("says at once which \"?\" to show again when its change is refused (Codex r3 on #610)", async () => {
    storage.clear();
    dropped.mockClear();
    outbox.pending = [{ clientCorrectionId: C1, failureKind: "permanent" }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-3", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections("m-3");
    act(() => { create(<Probe owner={OWNER} />); });
    await flush();
    expect(dropped).toHaveBeenCalledWith(["ri-1"]);
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    expect(review.enqueueReviewMutation).not.toHaveBeenCalledWith(expect.objectContaining({ clientMutationId: "m-3" }));
  });
});
