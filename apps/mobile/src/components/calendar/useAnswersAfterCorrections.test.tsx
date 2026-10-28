import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "../../lib/api";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    removeItem: async (key: string) => { storage.delete(key); },
    setItem: async (key: string, value: string) => { storage.set(key, value); }
  }
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
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

  it("says at once which \"?\" to show again when its change is refused (Codex r3 on #610)", async () => {
    storage.clear();
    dropped.mockClear();
    outbox.pending = [{ clientCorrectionId: C1, failureKind: "permanent" }];
    await answers.holdAnswerAfterCorrections(OWNER, { id: "m-3", reviewItemId: "ri-1", logged: true, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections("m-3");
    act(() => { create(<Probe owner={OWNER} />); });
    await flush();
    expect(dropped).toHaveBeenCalledWith("ri-1");
    expect(probe.current!.waitingIds.has("ri-1")).toBe(false);
    expect(review.enqueueReviewMutation).not.toHaveBeenCalledWith(expect.objectContaining({ clientMutationId: "m-3" }));
  });
});
