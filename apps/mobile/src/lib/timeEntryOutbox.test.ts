import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    })
  }
}));

vi.mock("./secure-session", () => ({
  invalidateMobileSessionIfCurrent: vi.fn(async () => false),
  isAuthenticatedSessionSnapshotCurrent: vi.fn(() => true),
  readAuthenticatedSessionSnapshot: vi.fn(async () => ({
    status: "authenticated",
    snapshot: { generation: 1, token: "token-a" }
  }))
}));

const account = await import("./mobileAccount");
const outbox = await import("./timeEntryOutbox");

const OWNER_A = { userId: "user-a", workspaceId: "workspace-a" };
const OWNER_B = { userId: "user-b", workspaceId: "workspace-b" };

describe("durable time-entry outbox", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimeEntryOutboxForTests();
    await account.activateMobileAccount(OWNER_A);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["update", "delete"] as const)(
    "keeps a %s command durable when delivery reaches the bounded deadline",
    async (operation) => {
      if (operation === "update") {
        await outbox.enqueueTimeEntryUpdate({
          owner: OWNER_A,
          target: { targetEntryId: "entry-a" },
          patch: { description: "Saved offline" }
        });
      } else {
        await outbox.enqueueTimeEntryDelete({
          owner: OWNER_A,
          target: { targetEntryId: "entry-b" }
        });
      }
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

      const sync = outbox.synchroniseTimeEntryCommands({
        owner: OWNER_A,
        correlations: new Map(),
        force: true
      });
      await vi.advanceTimersByTimeAsync(outbox.MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS);
      const result = await sync;

      expect(result).toMatchObject({
        deliveredCount: 0,
        reason: "retryable_failure",
        stopped: true,
        waitingCount: 1
      });
      const retained = await outbox.readPendingTimeEntryCommands(OWNER_A);
      expect(retained).toHaveLength(1);
      expect(retained[0]).toMatchObject({
        attemptCount: 1,
        failureKind: "retryable",
        operation
      });
      expect(retained[0]?.nextAttemptAt).toBeTruthy();
    }
  );

  it("persists new work without waiting for an existing delivery and shares the drain", async () => {
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-a" },
      patch: { description: "First" }
    });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let finishFirstFetch!: (response: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      finishFirstFetch = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => {
        markFetchStarted();
        return firstFetch;
      })
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const firstDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    });
    const sharedDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    });
    await fetchStarted;

    await expect(outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-b" },
      patch: { description: "Second" }
    })).resolves.toBeTruthy();
    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toHaveLength(2);

    finishFirstFetch(new Response(null, { status: 204 }));
    await expect(Promise.all([firstDrain, sharedDrain])).resolves.toEqual([
      expect.objectContaining({ deliveredCount: 2, waitingCount: 0 }),
      expect.objectContaining({ deliveredCount: 2, waitingCount: 0 })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves a forced reconnect request while a non-forced drain is active", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({
        clientCommandId: "command-in-flight",
        targetEntryId: "entry-in-flight"
      }),
      commandFixture({
        clientCommandId: "command-in-backoff",
        failureKind: "retryable",
        nextAttemptAt: "2026-08-22T12:05:00.000Z",
        targetEntryId: "entry-in-backoff"
      })
    ]));
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let finishFirstFetch!: (response: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      finishFirstFetch = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => {
        markFetchStarted();
        return firstFetch;
      })
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const ordinaryDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map()
    });
    await fetchStarted;
    const reconnectDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    });
    finishFirstFetch(new Response(null, { status: 204 }));

    await expect(Promise.all([ordinaryDrain, reconnectDrain])).resolves.toEqual([
      expect.objectContaining({ deliveredCount: 2, waitingCount: 0 }),
      expect.objectContaining({ deliveredCount: 2, waitingCount: 0 })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forces the oldest backoff command when reconnect joins its drain", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({
        clientCommandId: "oldest-command-in-backoff",
        failureKind: "retryable",
        nextAttemptAt: "2026-08-22T12:05:00.000Z",
        targetEntryId: "entry-in-backoff"
      })
    ]));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const ordinaryDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map()
    });
    const reconnectDrain = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    });

    await expect(reconnectDrain).resolves.toMatchObject({
      deliveredCount: 1,
      waitingCount: 0
    });
    await expect(ordinaryDrain).resolves.toMatchObject({
      waitingCount: 0
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps commands isolated from a different active account", async () => {
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-a" },
      patch: { description: "Account A" }
    });
    await account.activateMobileAccount(OWNER_B);
    expect(await outbox.readPendingTimeEntryCommands()).toEqual([]);
    expect(await outbox.readPendingTimeEntryCommands(OWNER_A)).toHaveLength(1);
  });

  it("translates an optimistic dependency when its canonical correlation arrives", async () => {
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { optimisticEntryId: "local-start" },
      patch: { description: "Final" }
    });
    const resolved = await outbox.resolvePendingTimeEntryCommandTargets(
      OWNER_A,
      new Map([["local-start", "canonical-start"]])
    );
    expect(resolved[0]).toMatchObject({
      optimisticEntryId: "local-start",
      targetEntryId: "canonical-start"
    });
  });

  it("persists Delete during Undo, defers delivery, then releases or removes it durably", async () => {
    const held = await outbox.enqueueTimeEntryDelete({
      owner: OWNER_A,
      target: { targetEntryId: "entry-held" },
      deliverAfter: "2026-08-22T12:00:06.000Z"
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true,
      now: new Date("2026-08-22T12:00:01.000Z")
    })).resolves.toMatchObject({ reason: "deferred", waitingCount: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(outbox.releaseTimeEntryCommands([held.clientCommandId])).resolves.toBe(1);
    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({ deliveredCount: 1, waitingCount: 0 });

    const undone = await outbox.enqueueTimeEntryDelete({
      owner: OWNER_A,
      target: { targetEntryId: "entry-undone" },
      deliverAfter: "2026-08-22T12:00:06.000Z"
    });
    await expect(outbox.removeTimeEntryCommands([undone.clientCommandId])).resolves.toBe(1);
    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([]);
  });
});

function commandFixture(input: {
  clientCommandId: string;
  failureKind?: "retryable";
  nextAttemptAt?: string;
  targetEntryId: string;
}) {
  return {
    attemptCount: input.failureKind ? 1 : 0,
    clientCommandId: input.clientCommandId,
    createdAt: "2026-08-22T11:59:00.000Z",
    operation: "update",
    patch: { description: input.clientCommandId },
    targetEntryId: input.targetEntryId,
    updatedAt: "2026-08-22T11:59:00.000Z",
    userId: OWNER_A.userId,
    workspaceId: OWNER_A.workspaceId,
    ...(input.failureKind ? { failureKind: input.failureKind } : {}),
    ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {})
  };
}
