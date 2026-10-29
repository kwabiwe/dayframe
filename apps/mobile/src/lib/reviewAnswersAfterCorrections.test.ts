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
const shared = await import("./afterCorrections");

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

  it("a Logs as from a reopened sheet never goes after its earlier correction is refused (Codex r5 on #610)", async () => {
    // A place correction saved while offline.
    await outbox.enqueueTimelineCorrections(OWNER_A, [correction("seg-a", C1)]);
    const sent: Array<{ kind: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      throw new TypeError("Network request failed");
    }));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    // The sheet reopened, Logs as picked: it waits for the earlier correction.
    await answers.holdAnswerAfterCorrections(OWNER_A, { id: C2, reviewItemId: "", logged: true,
      log: { itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1" }, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections(C2);
    // Back online, the correction is refused.
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return json(409, { error: "This place is already in a block." });
    }));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    // The release would queue log_place: it never runs, and nothing but the place correction was ever sent.
    const release = vi.fn(async (): Promise<Outcome> => {
      await outbox.enqueueTimelineCorrections(OWNER_A, [{ request: { kind: "log_place", subject: "place", itemId: "seg-a",
        categoryId: "6f000000-0000-4000-8000-0000000000c1", clientCorrectionId: C2 } }]);
      return "released";
    });
    const result = await releaseWith(release);
    expect(release).not.toHaveBeenCalled();
    expect(result.dropped.map((item) => item.id)).toEqual([C2]);
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    expect(sent.map((body) => body.kind)).not.toContain("log_place");
  });

  it("a Yes from a reopened sheet with no new changes waits for the correction queued earlier; its refusal keeps the \"?\" (Codex r6 on #610)", async () => {
    // A place correction saved offline, still queued.
    await outbox.enqueueTimelineCorrections(OWNER_A, [correction("seg-a", C1)]);
    // Reopened, Yes with nothing new: the shared registration makes it wait.
    const record = await shared.waitForItemCorrections(OWNER_A, { id: "m-yes", itemId: "seg-a", newIds: [],
      action: { kind: "answer", reviewItemId: "ri-1", logged: true } });
    expect(record).toMatchObject({ waitsFor: [C1], acknowledged: [] });
    await answers.commitAnswerAfterCorrections("m-yes");
    expect((await releaseWith()).release).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: "This place is already in a block." })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    const { release, dropped } = await releaseWith();
    expect(release).not.toHaveBeenCalled();
    expect(dropped.map((item) => item.reviewItemId)).toEqual(["ri-1"]);
    // With nothing queued for its item, it needn't wait: answered at once.
    expect(await shared.waitForItemCorrections(OWNER_A, { id: "m-now", itemId: "seg-z", newIds: [],
      action: { kind: "answer", reviewItemId: "ri-2", logged: false } })).toBeNull();
  });

  it("an outing's answer waits for a correction of one of its trips saved offline; its refusal keeps the \"?\" (Codex r10 on #610)", async () => {
    // The inbound trip corrected offline.
    await outbox.enqueueTimelineCorrections(OWNER_A, [{ request: { kind: "delete", subject: "trip", itemId: "trip-in", clientCorrectionId: C1 } }]);
    const record = await shared.waitForItemCorrections(OWNER_A, { id: "m-out", itemId: "stay-seg", memberItemIds: ["trip-in", "trip-out"], newIds: [],
      action: { kind: "answer", reviewItemId: "ri-stay", logged: true, outingMemberIds: ["ri-in", "ri-out"] } });
    expect(record).toMatchObject({ waitsFor: [C1], outingMemberIds: ["ri-in", "ri-out"] });
    await answers.commitAnswerAfterCorrections("m-out");
    expect((await releaseWith()).release).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: "This trip is already in a block." })));
    await outbox.synchroniseTimelineCorrections({ owner: OWNER_A, force: true });
    const { release, dropped } = await releaseWith();
    expect(release).not.toHaveBeenCalled();
    expect(dropped.map((item) => item.reviewItemId)).toEqual(["ri-stay"]);
  });

  it("registers atomically: an acknowledgement arriving during registration is never lost, and the log still goes (Codex r6 on #610)", async () => {
    let acknowledging: Promise<void> | null = null;
    const queue = {
      readPending: async () => {
        // The server acknowledges C1 while the queue is being read: its mark waits for the record's write.
        acknowledging = answers.noteTimelineCorrectionAcknowledged(OWNER_A, C1);
        return [{ clientCorrectionId: C1, request: { kind: "place", itemId: "seg-a" } }];
      },
      readAcknowledged: () => []
    };
    await answers.registerAfterCorrections(OWNER_A, { id: "log-1", reviewItemId: "", logged: true,
      log: { itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1" }, newIds: [], itemIds: ["seg-a"] }, queue);
    await acknowledging;
    expect((await answers.readAnswersAfterCorrections(OWNER_A))[0].acknowledged).toEqual([C1]);
    await answers.commitAnswerAfterCorrections("log-1");
    // C1 has left the queue: acknowledged, so the log goes.
    const release = vi.fn(async (): Promise<Outcome> => "released");
    await answers.releaseAnswersAfterCorrections({ owner: OWNER_A, readPending: async () => [], release });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ id: "log-1", log: { itemId: "seg-a", categoryId: "6f000000-0000-4000-8000-0000000000c1" } }));
    // Already acknowledged in the queue's memory when registering (still in its stored copy): recorded as such at once.
    const remembered = await answers.registerAfterCorrections(OWNER_A, { id: "log-2", reviewItemId: "", logged: true, newIds: [], itemIds: ["seg-b"] },
      { readPending: async () => [{ clientCorrectionId: C2, request: { kind: "times", itemId: "seg-b" } }], readAcknowledged: () => [{ clientCorrectionId: C2 }] });
    expect(remembered?.acknowledged).toEqual([C2]);
  });

  it("counts a dependency that just left the queue, still in its memory, as accepted when releasing, never refused (Codex r6 on #610)", async () => {
    await answers.holdAnswerAfterCorrections(OWNER_A, { id: "m-4", reviewItemId: "ri-4", logged: true, waitsFor: [C1] });
    await answers.commitAnswerAfterCorrections("m-4");
    const release = vi.fn(async (): Promise<Outcome> => "released");
    const result = await answers.releaseAnswersAfterCorrections({ owner: OWNER_A, readPending: async () => [],
      readAcknowledged: () => [{ clientCorrectionId: C1 }], release });
    expect(release).toHaveBeenCalledOnce();
    expect(result.dropped).toEqual([]);
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
