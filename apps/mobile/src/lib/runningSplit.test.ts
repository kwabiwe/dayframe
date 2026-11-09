import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";
import type { DurableLocalWork } from "./durableLocalProjection";
import type { PendingTimeEntryCommand } from "./timeEntryOutbox";

// Split for the running block on iPhone (owner 28 Oct 2026): the durable split command, its Undo hold,
// delivery, the second part's id and the projection. Synthetic ids, names and times only.
const storage = vi.hoisted(() => new Map<string, string>());
const correlations = vi.hoisted(() => ({ record: vi.fn(async () => true) }));
const stops = vi.hoisted(() => ({ reject: vi.fn(), deliver: vi.fn() }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); })
  }
}));
vi.mock("./secure-session", () => ({
  invalidateMobileSessionIfCurrent: vi.fn(async () => false),
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({
    status: "authenticated",
    snapshot: { generation: 1, owner, token: "token-a" }
  }))
}));
vi.mock("./api", () => ({
  recordTimerEntryIdCorrelation: correlations.record,
  deliverPendingTimerStop: stops.deliver,
  isNetworkTimerError: (error: unknown) => error instanceof TypeError
}));
vi.mock("./timerStopOutbox", async (original) => {
  const actual = await original<typeof import("./timerStopOutbox")>();
  return { ...actual, rejectPendingTimerStopsForTarget: stops.reject.mockImplementation(actual.rejectPendingTimerStopsForTarget) };
});

const account = await import("./mobileAccount");
const outbox = await import("./timeEntryOutbox");
const stopOutbox = await import("./timerStopOutbox");
const stopSync = await import("./timerStopSync");
const { projectDurableLocalWork } = await import("./durableLocalProjection");

const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
const RUNNING = "70000000-0000-4000-8000-000000000001";
const SECOND_LOCAL = "optimistic-active-timer:split:1";
const SECOND = "70000000-0000-4000-8000-000000000002";
const STARTED_AT = "2026-08-22T10:00:00.000Z";
const SPLIT_AT = "2026-08-22T10:30:00.000Z";

type Call = { url: string; method?: string; body?: Record<string, unknown>; commandId?: string };

function stubServer(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method,
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
      commandId: (init?.headers as Record<string, string> | undefined)?.["X-Dayframe-Client-Command-Id"]
    };
    calls.push(call);
    return answer(call);
  }));
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("iPhone split of the running block: the durable command", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T11:00:00.000Z"));
    storage.clear();
    correlations.record.mockClear();
    stops.reject.mockClear();
    stops.deliver.mockClear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimeEntryOutboxForTests();
    await account.activateMobileAccount(OWNER);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits while its Undo is open; Undo removes it before anything is sent", async () => {
    const calls = stubServer(() => json({ ok: true, newEntryId: SECOND }, 201));
    const lease = outbox.createTimeEntryCommandHoldLease();
    const command = await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL,
      deliverAfter: "2026-08-22T11:00:06.000Z", holdLease: lease
    });
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true }))
      .toMatchObject({ deliveredCount: 0, reason: "deferred" });
    expect(outbox.wereTimeEntryCommandsDispatched([command.clientCommandId])).toBe(false);
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER, target: { optimisticEntryId: SECOND_LOCAL }, patch: { description: "Discard with split" }
    });
    expect(await outbox.undoHeldTimeEntrySplit(OWNER, command.clientCommandId, () => true)).toBe(true);
    await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true });
    expect(calls).toHaveLength(0);
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
  });

  it("once released, splits by the block's id with its command id, and hands the second part's id to what follows it", async () => {
    const calls = stubServer((call) => call.method === "POST"
      ? json({ ok: true, id: RUNNING, newEntryId: SECOND, replayed: false, running: true }, 201)
      : json({ ok: true }));
    const lease = outbox.createTimeEntryCommandHoldLease();
    const split = await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL,
      deliverAfter: "2026-08-22T11:00:06.000Z", holdLease: lease
    });
    // An Edit of the running second part, made during the Undo window, waits behind it.
    await outbox.enqueueTimeEntryUpdate({ owner: OWNER, target: { optimisticEntryId: SECOND_LOCAL }, patch: { description: "Second half" } });
    await outbox.releaseTimeEntryCommands([split.clientCommandId]);
    const result = await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true });
    expect(result).toMatchObject({ deliveredCount: 2, stopped: false });
    expect(calls[0]).toEqual({
      url: expect.stringMatching(/\/api\/time-entries$/), method: "POST",
      body: { mode: "split-running", source: "mobile_app", entryId: RUNNING, splitAt: SPLIT_AT }, commandId: split.clientCommandId
    });
    expect(correlations.record).toHaveBeenCalledWith(SECOND_LOCAL, SECOND, OWNER);
    expect(calls[1]).toMatchObject({ url: expect.stringMatching(new RegExp(`/api/time-entries/${SECOND}$`)), method: "PATCH" });
  });

  it("splits a block whose Start is still queued once that Start has its id, and keeps it through an offline retry", async () => {
    let online = false;
    const calls = stubServer(() => {
      if (!online) throw new TypeError("Network request failed");
      return json({ ok: true, newEntryId: SECOND }, 201);
    });
    await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { optimisticEntryId: "optimistic-active-timer:1" }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL
    });
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true }))
      .toMatchObject({ reason: "dependency_wait" });
    const known = new Map([["optimistic-active-timer:1", RUNNING]]);
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: known, force: true }))
      .toMatchObject({ reason: "retryable_failure", waitingCount: 1 });
    online = true;
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: known, force: true }))
      .toMatchObject({ deliveredCount: 1 });
    expect(calls.at(-1)?.body).toMatchObject({ entryId: RUNNING, splitAt: SPLIT_AT });
    expect(correlations.record).toHaveBeenCalledWith(SECOND_LOCAL, SECOND, OWNER);
  });

  it("preserves the refused split's dependent Stop with its exact tap time and never sends it against another timer", async () => {
    stubServer(() => json({ error: "Choose a split time inside the block." }, 422));
    await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL
    });
    await outbox.enqueueTimeEntryUpdate({ owner: OWNER, target: { optimisticEntryId: SECOND_LOCAL }, patch: { description: "Never" } });
    const occurredAt = "2026-08-22T11:00:01.000Z";
    const stop = await stopOutbox.getOrCreatePendingStop({ owner: OWNER, target: { optimisticEntryId: SECOND_LOCAL }, occurredAt });
    const otherOwner = { userId: "user-b", workspaceId: "workspace-b" };
    const otherStop = await stopOutbox.getOrCreatePendingStop({ owner: otherOwner, target: { optimisticEntryId: SECOND_LOCAL }, occurredAt });
    await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true });
    expect(stops.reject).toHaveBeenCalledWith(OWNER, SECOND_LOCAL, expect.stringContaining("The split was not saved"));
    await expect(stopOutbox.readPendingTimerStops()).resolves.toEqual([
      expect.objectContaining({ ...stop, occurredAt, failureKind: "permanent", refusedSplit: true }), otherStop
    ]);
    await expect(stopSync.synchronisePendingTimerStops({ owner: OWNER, correlations: new Map() }))
      .resolves.toMatchObject({ deliveredCount: 0, needsAttentionCount: 1 });
    expect(stops.deliver).not.toHaveBeenCalled();
    await expect(stopOutbox.retryTimerStopSyncIssue(stop.clientEventId, OWNER)).resolves.toBe(false);
    await expect(stopOutbox.discardTimerStopSyncIssue(stop.clientEventId, OWNER)).resolves.toBe(true);
    await expect(stopOutbox.readPendingTimerStops()).resolves.toEqual([otherStop]);
    const pending = await outbox.readPendingTimeEntryCommands(OWNER);
    expect(pending.map((command) => [command.operation, command.failureKind])).toEqual([["split", "permanent"], ["update", "permanent"]]);
  });

  it("delivers a queued Stop only after the split returns the second part's canonical identity", async () => {
    const calls = stubServer(() => json({ ok: true, newEntryId: SECOND }, 201));
    stops.deliver.mockImplementationOnce(async (pendingStop) => {
      await stopOutbox.removePendingTimerStop(pendingStop.clientEventId);
      return { status: "delivered", pendingStop };
    });
    const lease = outbox.createTimeEntryCommandHoldLease();
    const split = await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL,
      deliverAfter: "2026-08-22T11:00:06.000Z", holdLease: lease
    });
    const stop = await stopOutbox.getOrCreatePendingStop({
      owner: OWNER, target: { optimisticEntryId: SECOND_LOCAL }, occurredAt: "2026-08-22T11:00:00.000Z"
    });
    await stopSync.synchronisePendingTimerStops({ owner: OWNER, correlations: new Map() });
    expect(stops.deliver).not.toHaveBeenCalled();
    await outbox.releaseTimeEntryCommands([split.clientCommandId]);
    await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true });
    expect(calls).toHaveLength(1);
    expect(correlations.record).toHaveBeenCalledWith(SECOND_LOCAL, SECOND, OWNER);
    await expect(stopSync.synchronisePendingTimerStops({
      owner: OWNER, correlations: new Map([[SECOND_LOCAL, SECOND]])
    })).resolves.toMatchObject({ deliveredCount: 1, remaining: [] });
    expect(stops.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ clientEventId: stop.clientEventId, targetEntryId: SECOND }), OWNER, expect.anything()
    );
  });

  it("keeps work queued when an older server cannot yet deliver the running Split mode", async () => {
    stubServer(() => json({ error: "mode must be one of start, stop, manual, split, duplicate, join, or copy-completed." }, 400));
    await outbox.enqueueTimeEntrySplit({ owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL });
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true }))
      .toMatchObject({ reason: "retryable_failure", waitingCount: 1 });
    expect(stops.reject).not.toHaveBeenCalled();
  });

  it("stores an acknowledged split receipt for an older cached bootstrap outside the delivery queue", async () => {
    const firstUpdatedAt = "2026-08-22T11:00:05.000Z";
    stubServer(() => json({
      id: RUNNING, newEntryId: SECOND, replayed: true,
      entries: [{ id: RUNNING, stoppedAt: SPLIT_AT, updatedAt: firstUpdatedAt }, { id: SECOND, stoppedAt: null }]
    }));
    await outbox.enqueueTimeEntrySplit({ owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL });
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true }))
      .toMatchObject({ deliveredCount: 1, waitingCount: 0 });
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
    outbox.__resetTimeEntryOutboxForTests();
    const receipt = await outbox.readPendingTimeEntryCommands(OWNER, { includeRunningSplitReceipts: true });
    expect(receipt[0]?.split?.receipt).toMatchObject({
      firstEntryId: RUNNING, firstUpdatedAt, firstStoppedAt: SPLIT_AT, secondEntryId: SECOND
    });
    const old = { ...entry(RUNNING), updatedAt: "2026-08-22T10:00:00.000Z" };
    expect(projectDurableLocalWork(bootstrap({ activeEntry: old, entries: [old] }), work({ timeEntryCommands: receipt })).activeEntry?.id)
      .toBe(SECOND);
    const newer = { ...old, updatedAt: "2026-08-22T11:00:06.000Z" };
    expect(projectDurableLocalWork(bootstrap({ activeEntry: newer, entries: [newer] }), work({ timeEntryCommands: receipt })).activeEntry)
      .toEqual(newer);
  });

  it("repairs a failed second-block correlation after relaunch without resending the acknowledged Split", async () => {
    const calls = stubServer(() => json({
      id: RUNNING, newEntryId: SECOND, entries: [
        { id: RUNNING, stoppedAt: SPLIT_AT, updatedAt: "2026-08-22T11:00:00.000Z" },
        { id: SECOND, stoppedAt: null, updatedAt: "2026-08-22T11:00:00.000Z" }
      ]
    }, 201));
    const originalLocalId = "optimistic-active-timer:source";
    await outbox.enqueueTimeEntrySplit({
      owner: OWNER, target: { optimisticEntryId: originalLocalId }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL
    });
    correlations.record.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map([[originalLocalId, RUNNING]]), force: true }))
      .resolves.toMatchObject({ deliveredCount: 0, waitingCount: 1, reason: "retryable_failure" });
    expect((await outbox.readPendingTimeEntryCommands(OWNER))[0]?.split?.receipt)
      .toMatchObject({ firstEntryId: RUNNING, secondEntryId: SECOND, correlationPending: true });
    outbox.__resetTimeEntryOutboxForTests();
    await expect(outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true }))
      .resolves.toMatchObject({ deliveredCount: 1, waitingCount: 0 });
    expect(calls).toHaveLength(1);
    expect(correlations.record.mock.calls).toEqual([
      [SECOND_LOCAL, SECOND, OWNER], [SECOND_LOCAL, SECOND, OWNER]
    ]);
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
  });

  it("a repeat answered after its second part went elsewhere leaves nothing waiting for that part", async () => {
    stubServer(() => json({ ok: true, id: RUNNING, newEntryId: null, replayed: true }));
    await outbox.enqueueTimeEntrySplit({ owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL });
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true })).toMatchObject({ deliveredCount: 1 });
    expect(stops.reject).toHaveBeenCalledWith(OWNER, SECOND_LOCAL, expect.stringContaining("The split was not saved"));
    expect(correlations.record).not.toHaveBeenCalled();
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
  });

  it("keeps the split through storage: a malformed split record is quarantined, a valid one survives", async () => {
    await outbox.enqueueTimeEntrySplit({ owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: SPLIT_AT, splitEntryLocalId: SECOND_LOCAL });
    outbox.__resetTimeEntryOutboxForTests();
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([
      expect.objectContaining({ operation: "split", targetEntryId: RUNNING, split: { splitAt: SPLIT_AT, secondLocalId: SECOND_LOCAL } })
    ]);
  });
});

describe("iPhone split of the running block: what the app shows before the server has it", () => {
  const splitCommand = (patch: Partial<PendingTimeEntryCommand> = {}): PendingTimeEntryCommand => ({
    ...OWNER, clientCommandId: "mobile-time-entry:split-1", operation: "split", targetEntryId: RUNNING,
    split: { splitAt: SPLIT_AT, secondLocalId: SECOND_LOCAL }, createdAt: "2026-08-22T11:00:00.000Z",
    updatedAt: "2026-08-22T11:00:00.000Z", attemptCount: 0, ...patch
  });

  it("ends the block at the split and keeps the second part running with every detail: never two running blocks", () => {
    const running = entry(RUNNING);
    const projected = projectDurableLocalWork(bootstrap({ activeEntry: running, entries: [running] }), work({ timeEntryCommands: [splitCommand()] }));
    expect(projected.activeEntry).toMatchObject({ id: SECOND_LOCAL, startedAt: SPLIT_AT, stoppedAt: null, description: "Draft chapter", tagNames: ["deep"], categoryId: "category-a" });
    expect(projected.entries.find((item) => item.id === RUNNING)).toMatchObject({ startedAt: STARTED_AT, stoppedAt: SPLIT_AT });
    expect(projected.entries.filter((item) => !item.stoppedAt)).toHaveLength(1);
  });

  it("Stop after the split, still offline, stops the second part; the server's id replaces the local one once known", () => {
    const running = entry(RUNNING);
    const stop = { ...OWNER, clientEventId: "stop-1", optimisticEntryId: SECOND_LOCAL, occurredAt: "2026-08-22T11:05:00.000Z", queuedAt: "2026-08-22T11:05:00.000Z" };
    const projected = projectDurableLocalWork(bootstrap({ activeEntry: running, entries: [running] }), work({
      timeEntryCommands: [splitCommand()], timerStops: [stop], correlations: new Map([[SECOND_LOCAL, SECOND]])
    }));
    expect(projected.activeEntry).toBeNull();
    expect(projected.entries.map((item) => [item.id, item.startedAt, item.stoppedAt]).sort()).toEqual([
      [RUNNING, STARTED_AT, SPLIT_AT],
      [SECOND, SPLIT_AT, "2026-08-22T11:05:00.000Z"]
    ]);
  });

  it("projects a queued Edit and chained Split through its owner's unpublished second ID", () => {
    const running = { ...entry(RUNNING), updatedAt: STARTED_AT };
    const ackAt = "2026-08-22T11:00:01.000Z";
    const chainedAt = "2026-08-22T10:45:00.000Z";
    const thirdLocal = "optimistic-active-timer:split:chained";
    const firstSplit = splitCommand({
      split: { splitAt: SPLIT_AT, secondLocalId: SECOND_LOCAL, receipt: {
        firstEntryId: RUNNING, firstUpdatedAt: ackAt, firstStoppedAt: SPLIT_AT,
        secondEntryId: SECOND, correlationPending: true
      } }
    });
    const edit: PendingTimeEntryCommand = {
      ...OWNER, clientCommandId: "edit-second", operation: "update", optimisticEntryId: SECOND_LOCAL,
      patch: { description: "Edited second part" }, createdAt: ackAt, updatedAt: ackAt, attemptCount: 0
    };
    const chained = splitCommand({
      clientCommandId: "split-chained", targetEntryId: undefined, optimisticEntryId: SECOND_LOCAL,
      split: { splitAt: chainedAt, secondLocalId: thirdLocal }, createdAt: ackAt
    });
    const unrelated = splitCommand({
      clientCommandId: "other-account-split", userId: "user-b",
      split: { splitAt: SPLIT_AT, secondLocalId: SECOND_LOCAL, receipt: {
        secondEntryId: "unrelated", correlationPending: true
      } }
    });
    const correlations = new Map<string, string>();
    const before = bootstrap({ activeEntry: running, entries: [running] });
    const projected = projectDurableLocalWork(before, work({
      timeEntryCommands: [firstSplit, edit, chained, unrelated], correlations
    }));
    expect(projected.activeEntry).toMatchObject({
      id: thirdLocal, description: "Edited second part", startedAt: chainedAt, runningSplitSourceEntryId: SECOND
    });
    expect(projected.entries.find((row) => row.id === SECOND)).toMatchObject({
      description: "Edited second part", startedAt: SPLIT_AT, stoppedAt: chainedAt
    });
    expect(projected.entries.find((row) => row.id === RUNNING)?.description).toBe(running.description);
    expect(correlations.size).toBe(0);
  });

  it("a refused split shows the block as the server has it", () => {
    const running = entry(RUNNING);
    const projected = projectDurableLocalWork(bootstrap({ activeEntry: running, entries: [running] }), work({
      timeEntryCommands: [splitCommand({ failureKind: "permanent" })]
    }));
    expect(projected.activeEntry?.id).toBe(RUNNING);
  });

  it("leaves the original history and a web replacement intact while a stale split waits", () => {
    const finished = { ...entry(RUNNING), stoppedAt: "2026-08-22T10:50:00.000Z" };
    const replacement = { ...entry(SECOND), startedAt: finished.stoppedAt };
    const before = bootstrap({ activeEntry: replacement, entries: [finished, replacement] });
    expect(projectDurableLocalWork(before, work({ timeEntryCommands: [splitCommand()] }))).toEqual(before);
  });

  it("projects a dependent Switch after Split even when its clock value ties the earlier command", () => {
    const running = entry(RUNNING);
    const change = splitCommand();
    const switchAt = change.createdAt;
    const projection = projectDurableLocalWork(bootstrap({ activeEntry: running, entries: [running] }), work({
      timeEntryCommands: [change],
      activityEvents: [{
        ...OWNER, localId: "optimistic-active-timer:next", type: "timer_start", source: "mobile_app",
        occurredAt: new Date(switchAt), queuedAt: switchAt, afterRunningSplitIds: [change.clientCommandId],
        rawPayload: { startedAt: switchAt }
      }]
    }));
    expect(projection.activeEntry?.id).toBe("optimistic-active-timer:next");
    expect(projection.entries.find((row) => row.id === RUNNING)?.stoppedAt).toBe(SPLIT_AT);
    expect(projection.entries.find((row) => row.id === SECOND_LOCAL)?.stoppedAt).toBe(switchAt);
  });
});

function work(overrides: Partial<DurableLocalWork> = {}): DurableLocalWork {
  return { owner: OWNER, activityEvents: [], timeEntryCommands: [], timerStops: [], correlations: new Map(), ...overrides };
}

function bootstrap(overrides: Partial<MobileBootstrap> = {}): MobileBootstrap {
  return {
    user: { id: OWNER.userId, email: "a@example.com", name: "A" },
    workspace: { id: OWNER.workspaceId, name: "A" },
    activeEntry: null,
    projects: [],
    categories: [{ id: "category-a", name: "Writing", color: "green", isPinned: true }],
    entries: [],
    places: [],
    reviewItems: [],
    ...overrides
  };
}

function entry(id: string): MobileBootstrap["entries"][number] {
  return {
    id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: "category-a",
    categoryName: "Writing", categoryColor: "green", placeName: "Exampleton Library", source: "mobile_app",
    confidence: "high", reviewStatus: "confirmed", description: "Draft chapter", startedAt: STARTED_AT,
    stoppedAt: null, durationSeconds: 0, tagNames: ["deep"]
  };
}
