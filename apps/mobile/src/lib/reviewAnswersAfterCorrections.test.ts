import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({ status: "authenticated", snapshot: { generation: 1, owner, token: "token-a" } }))
}));

const account = await import("./mobileAccount");
const outbox = await import("./timelineCorrectionOutbox");
const answers = await import("./reviewAnswersAfterCorrections");

// Codex r2 on #610: synthetic ids only.
const OWNER_A = { userId: "user-a", workspaceId: "workspace-a" };
const OWNER_B = { userId: "user-b", workspaceId: "workspace-b" };
const C1 = "6f000000-0000-4000-8000-000000000001";
const C2 = "6f000000-0000-4000-8000-000000000002";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const correction = (itemId: string, clientCorrectionId: string) =>
  ({ request: { kind: "times" as const, subject: "place" as const, itemId, startedAt: "2026-10-27T09:00:00.000Z", stoppedAt: "2026-10-27T10:00:00.000Z", clientCorrectionId } });

describe("answers that wait for the sheet's corrections (Codex r2 on #610)", () => {
  beforeEach(async () => {
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimelineCorrectionOutboxForTests();
    answers.__resetAnswersAfterCorrectionsForTests();
    await account.activateMobileAccount(OWNER_A);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The order the sheet keeps: the answer first (held for Undo), then its corrections; Undo's end commits it.
  async function answerWithCorrections(owner = OWNER_A, ids = [C1, C2]) {
    await answers.holdAnswerAfterCorrections(owner, { id: "m-1", reviewItemId: "ri-1", logged: true, waitsFor: ids });
    await outbox.enqueueTimelineCorrections(owner, ids.map((id, index) => correction(`seg-${index}`, id)));
  }
  type Outcome = "released" | "gone" | "wait";
  const releaseWith = (release = vi.fn(async (): Promise<Outcome> => "released"), owner = OWNER_A) =>
    answers.releaseAnswersAfterCorrections({ owner, readPending: outbox.readPendingTimelineCorrections, release }).then((result) => ({ ...result, release }));

  it("waits for every correction, then releases the answer once the server has acknowledged them", async () => {
    await answerWithCorrections();
    await answers.commitAnswerAfterCorrections("m-1");
    expect((await releaseWith()).release).not.toHaveBeenCalled();
    const replies = [json(200, { ok: true }), json(503, { error: "busy" })];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift()!));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    // One acknowledged, one waiting: still not released.
    expect((await answers.readAnswersAfterCorrections(OWNER_A))[0].acknowledged).toEqual([C1]);
    expect((await releaseWith()).release).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    const { release, released } = await releaseWith();
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ id: "m-1", reviewItemId: "ri-1", logged: true }));
    expect(released).toEqual(["ri-1"]);
    expect(await answers.readAnswersAfterCorrections(OWNER_A)).toEqual([]);
  });

  it("marks the answer acknowledged before the correction leaves the queue, so the order is never in doubt", async () => {
    await answerWithCorrections(OWNER_A, [C1]);
    let seenWhileStillQueued: string[] | null = null;
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true })));
    const unsubscribe = answers.subscribeAnswersAfterCorrections(() => {
      void Promise.all([outbox.readPendingTimelineCorrections(OWNER_A), answers.readAnswersAfterCorrections(OWNER_A)]).then(([pending, records]) => {
        if (seenWhileStillQueued === null) seenWhileStillQueued = pending.map((item) => item.clientCorrectionId).concat(records[0]?.acknowledged ?? []);
      });
    });
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    // At the moment it was marked, the correction was still queued and already acknowledged.
    expect(seenWhileStillQueued).toEqual([C1, C1]);
  });

  it("drops the answer when a correction is refused, or leaves the queue without being acknowledged", async () => {
    await answerWithCorrections();
    await answers.commitAnswerAfterCorrections("m-1");
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: "This place is already in a block." })));
    const refusal = await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    expect(refusal.refused.map((item) => item.clientCorrectionId)).toEqual([C1, C2]);
    const onDropped = vi.fn();
    const release = vi.fn(async () => "released" as const);
    const result = await answers.releaseAnswersAfterCorrections({ owner: OWNER_A, readPending: outbox.readPendingTimelineCorrections, release, onDropped });
    expect(release).not.toHaveBeenCalled();
    expect(result.dropped.map((item) => item.reviewItemId)).toEqual(["ri-1"]);
    expect(onDropped).toHaveBeenCalledOnce();
    // Discarded (gone from the queue, never acknowledged): dropped too, never released.
    await outbox.enqueueTimelineCorrections(OWNER_A, [correction("seg-9", "6f000000-0000-4000-8000-000000000009")]);
    await answers.holdAnswerAfterCorrections(OWNER_A, { id: "m-2", reviewItemId: "ri-2", logged: false, waitsFor: ["6f000000-0000-4000-8000-000000000009"] });
    await outbox.removeTimelineCorrections(["6f000000-0000-4000-8000-000000000009"]);
    await answers.commitAnswerAfterCorrections("m-2");
    const gone = await releaseWith();
    expect(gone.release).not.toHaveBeenCalled();
    expect(gone.dropped.map((item) => item.id)).toEqual(["m-2"]);
  });

  it("is kept on the phone: a relaunch still releases it once its corrections are acknowledged", async () => {
    await answerWithCorrections(OWNER_A, [C1]);
    await answers.commitAnswerAfterCorrections("m-1");
    // A held one (Undo still running when the app was killed) never survives a relaunch.
    await answers.holdAnswerAfterCorrections(OWNER_A, { id: "m-held", reviewItemId: "ri-9", logged: true, waitsFor: [C1] });
    // The app is killed and opened again: nothing in memory, the same storage.
    outbox.__resetTimelineCorrectionOutboxForTests();
    answers.__resetAnswersAfterCorrectionsForTests({ newRun: true });
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    const { release, released } = await releaseWith();
    expect(released).toEqual(["ri-1"]);
    expect(release).toHaveBeenCalledOnce();
    expect(await answers.readAnswersAfterCorrections(OWNER_A)).toEqual([]);
  });

  it("keeps each account's answers its own, and logout clears only that account's", async () => {
    await answerWithCorrections(OWNER_A, [C1]);
    await answers.holdAnswerAfterCorrections(OWNER_B, { id: "m-b", reviewItemId: "ri-b", logged: true, waitsFor: [C2] });
    await answers.commitAnswerAfterCorrections("m-1");
    await answers.commitAnswerAfterCorrections("m-b");
    // Another account's acknowledgement of the same id never counts for this one.
    await answers.noteTimelineCorrectionAcknowledged(OWNER_B, C1);
    expect((await answers.readAnswersAfterCorrections(OWNER_A))[0].acknowledged).toEqual([]);
    // A's release never touches B's record.
    await releaseWith();
    expect((await answers.readAnswersAfterCorrections(OWNER_B)).map((item) => item.id)).toEqual(["m-b"]);
    await outbox.clearTimelineCorrectionsForOwner(OWNER_A);
    expect(await answers.readAnswersAfterCorrections(OWNER_A)).toEqual([]);
    expect((await answers.readAnswersAfterCorrections(OWNER_B)).map((item) => item.id)).toEqual(["m-b"]);
  });

  it("Undo during the wait takes back the answer and nothing else: the corrections still go", async () => {
    await answerWithCorrections(OWNER_A, [C1]);
    await answers.cancelAnswerAfterCorrections("m-1");
    const fetch = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    expect(fetch).toHaveBeenCalledOnce();
    const { release } = await releaseWith();
    expect(release).not.toHaveBeenCalled();
    // Still in its Undo window: acknowledged, but not released until Undo ends.
    await answers.holdAnswerAfterCorrections(OWNER_A, { id: "m-3", reviewItemId: "ri-3", logged: true, waitsFor: [C1] });
    await answers.noteTimelineCorrectionAcknowledged(OWNER_A, C1);
    expect((await releaseWith()).release).not.toHaveBeenCalled();
    await answers.commitAnswerAfterCorrections("m-3");
    expect((await releaseWith()).released).toEqual(["ri-3"]);
  });

  it("keeps an answer whose release can't happen yet (its \"?\" not read yet), and forgets one whose \"?\" is gone", async () => {
    await answerWithCorrections(OWNER_A, [C1]);
    await answers.commitAnswerAfterCorrections("m-1");
    await answers.noteTimelineCorrectionAcknowledged(OWNER_A, C1);
    await releaseWith(vi.fn(async (): Promise<Outcome> => "wait"));
    expect(await answers.readAnswersAfterCorrections(OWNER_A)).toHaveLength(1);
    const gone = await releaseWith(vi.fn(async (): Promise<Outcome> => "gone"));
    expect(gone.released).toEqual([]);
    expect(await answers.readAnswersAfterCorrections(OWNER_A)).toEqual([]);
  });
});

describe("the correction outbox's acknowledgement (#609)", () => {
  beforeEach(async () => {
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimelineCorrectionOutboxForTests();
    await account.activateMobileAccount(OWNER_A);
  });
  it("keeps the review items the server resolved with a Logs as, so their \"?\" leave at once", async () => {
    await outbox.enqueueTimelineCorrections(OWNER_A, [{ request: { kind: "log_place", subject: "place", itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1", clientCorrectionId: C1 } }]);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { ok: true, logged: { entryIds: ["e-1"] }, resolvedReviewItemIds: ["ri-1"] })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    expect(outbox.readAcknowledgedTimelineCorrections(OWNER_A)[0].resolvedReviewItemIds).toEqual(["ri-1"]);
    vi.unstubAllGlobals();
  });
});
