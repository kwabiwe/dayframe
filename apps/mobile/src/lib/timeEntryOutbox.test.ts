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
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({
    status: "authenticated",
    snapshot: { generation: 1, owner, token: "token-a" }
  }))
}));

const account = await import("./mobileAccount");
const outbox = await import("./timeEntryOutbox");
const secureSession = await import("./secure-session");
const {
  getTimerBackgroundExecutionSnapshot,
  subscribeTimerBackgroundExecution
} = await import("./timerBackgroundExecution");
const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;

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

  it("retains an in-flight Edit when finite background execution expires", async () => {
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-expiry" },
      patch: { description: "Still saved" }
    });
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sync = outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new Error("Background execution expired."));

    await expect(sync).resolves.toMatchObject({
      deliveredCount: 0,
      reason: "retryable_failure",
      waitingCount: 1
    });
    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([
      expect.objectContaining({
        failureKind: "retryable",
        operation: "update",
        targetEntryId: "entry-expiry"
      })
    ]);
  });

  it("reserves finite execution only after an immediately deliverable Edit is durable", async () => {
    let finishDurableWrite!: () => void;
    const durableWrite = new Promise<void>((resolve) => {
      finishDurableWrite = resolve;
    });
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
      await durableWrite;
      storage.set(key, value);
    });
    const enqueue = outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-storage-boundary" },
      patch: { description: "Saved first" },
      requestImmediateDelivery: true
    });
    await Promise.resolve();
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);

    finishDurableWrite();
    await enqueue;
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(1);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({ deliveredCount: 1, waitingCount: 0 });
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);
  });

  it.each([
    {
      expectedReason: "deferred",
      record: commandFixture({
        clientCommandId: "undo-held",
        deliverAfter: "2026-08-22T12:00:06.000Z",
        targetEntryId: "entry-undo-held"
      })
    },
    {
      expectedReason: "dependency_wait",
      record: commandFixture({
        clientCommandId: "dependency-held",
        optimisticEntryId: "optimistic-entry",
        targetEntryId: null
      })
    },
    {
      expectedReason: "retry_wait",
      record: commandFixture({
        clientCommandId: "backoff-held",
        failureKind: "retryable",
        nextAttemptAt: "2026-08-22T12:05:00.000Z",
        targetEntryId: "entry-backoff-held"
      })
    }
  ])("keeps $expectedReason work pending without showing transmission", async ({
    expectedReason,
    record
  }) => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([record]));
    const activeCounts: number[] = [];
    const unsubscribe = subscribeTimerBackgroundExecution(() => {
      activeCounts.push(getTimerBackgroundExecutionSnapshot().activeLeaseCount);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      now: new Date("2026-08-22T12:00:01.000Z")
    })).resolves.toMatchObject({
      reason: expectedReason,
      waitingCount: 1
    });
    unsubscribe();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(activeCounts).not.toContain(1);
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);
  });

  // Stability audit 22 Oct 2026 (iphone-timer-sync-3): an Edit for a Start that was refused used to wait
  // for a block that never comes and hold the account's whole outbox.
  it("lets a refused Start's Edits stop holding the outbox, discardable but never retried", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({ clientCommandId: "for-refused", optimisticEntryId: "optimistic-y", targetEntryId: null }),
      commandFixture({ clientCommandId: "other-block", targetEntryId: "entry-x" })
    ]));
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(outbox.synchroniseTimeEntryCommands({ owner: OWNER_A, correlations: new Map(), force: true }))
      .resolves.toMatchObject({ deliveredCount: 0, reason: "dependency_wait" });

    await outbox.refuseTimeEntryCommandsForOptimisticEntry(OWNER_A, "optimistic-y", "never saved");
    await expect(outbox.synchroniseTimeEntryCommands({ owner: OWNER_A, correlations: new Map(), force: true }))
      .resolves.toMatchObject({ deliveredCount: 1 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/time-entries/entry-x");

    await expect(outbox.retryTimeEntrySyncIssue("for-refused", OWNER_A)).resolves.toBe(false);
    expect((await outbox.listTimeEntrySyncIssues(OWNER_A))[0]).toMatchObject({ clientCommandId: "for-refused", refusedStart: true });
    await expect(outbox.discardTimeEntrySyncIssue("for-refused", OWNER_A)).resolves.toBe(true);
    expect(await outbox.listTimeEntrySyncIssues(OWNER_A)).toEqual([]);
  });

  it("turns the Edits for a refused Start into issues the person can see and discard", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({ clientCommandId: "for-refused", optimisticEntryId: "optimistic-y", targetEntryId: null }),
      commandFixture({ clientCommandId: "other-account", optimisticEntryId: "optimistic-y", targetEntryId: null, ...OWNER_B }),
      commandFixture({ clientCommandId: "other-block", targetEntryId: "entry-x" })
    ]));

    await expect(outbox.refuseTimeEntryCommandsForOptimisticEntry(OWNER_A, "optimistic-y", "never saved")).resolves.toBe(1);
    expect((await outbox.listTimeEntrySyncIssues(OWNER_A)).map((issue) => issue.clientCommandId)).toEqual(["for-refused"]);
    expect((await outbox.listTimeEntrySyncIssues(OWNER_B))).toEqual([]);
  });

  // Codex r3 on #532: the refusal fence. A command written for a refused Start after settlement is a
  // sync issue at once (never deferred, never waiting), only for that account, and the fence is bounded.
  it("refuses an Edit or Delete written for a fenced Start as it is written, for that account only", async () => {
    await outbox.refuseTimeEntryCommandsForOptimisticEntry(OWNER_A, "optimistic-z");
    const late = await outbox.enqueueTimeEntryDelete({
      owner: OWNER_A,
      target: { optimisticEntryId: "optimistic-z" },
      deliverAfter: "2026-08-22T12:00:06.000Z",
      requestImmediateDelivery: true
    });
    expect(late).toMatchObject({ failureKind: "permanent", refusedStart: true, lastError: outbox.REFUSED_START_COMMAND_MESSAGE });
    expect(late.deliverAfter).toBeUndefined();
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);
    await outbox.enqueueTimeEntryUpdate({ owner: OWNER_A, target: { targetEntryId: "entry-x" }, patch: { description: "Unrelated" } });
    vi.stubGlobal("fetch", vi.fn((_url: string) => Promise.resolve(new Response(null, { status: 204 }))));
    await expect(outbox.synchroniseTimeEntryCommands({ owner: OWNER_A, correlations: new Map(), force: true }))
      .resolves.toMatchObject({ deliveredCount: 1, waitingCount: 0, needsAttentionCount: 1 });

    // Another account's block with the same local ID is not fenced.
    await account.activateMobileAccount(OWNER_B);
    const other = await outbox.enqueueTimeEntryUpdate({ owner: OWNER_B, target: { optimisticEntryId: "optimistic-z" }, patch: { description: "B" } });
    expect(other.failureKind).toBeUndefined();
  });

  it("keeps the refusal fence bounded: records older than 30 days and beyond 200 are dropped", async () => {
    storage.set("dayframe.timeEntryOutbox.refusedStarts.v1", JSON.stringify([
      { ...OWNER_A, optimisticEntryId: "optimistic-old", message: "never saved", refusedAt: "2026-07-01T12:00:00.000Z" },
      ...Array.from({ length: 200 }, (_, index) => ({
        ...OWNER_A, optimisticEntryId: `optimistic-${index}`, message: "never saved", refusedAt: "2026-08-22T11:00:00.000Z"
      }))
    ]));
    const old = await outbox.enqueueTimeEntryUpdate({ owner: OWNER_A, target: { optimisticEntryId: "optimistic-old" }, patch: { description: "Old" } });
    expect(old.failureKind).toBeUndefined();

    await outbox.refuseTimeEntryCommandsForOptimisticEntry(OWNER_A, "optimistic-new");
    const fence = JSON.parse(storage.get("dayframe.timeEntryOutbox.refusedStarts.v1") as string) as Array<{ optimisticEntryId: string }>;
    expect(fence).toHaveLength(200);
    expect(fence.map((record) => record.optimisticEntryId)).not.toContain("optimistic-old");
    expect(fence.map((record) => record.optimisticEntryId)).not.toContain("optimistic-0");
    expect(fence.at(-1)?.optimisticEntryId).toBe("optimistic-new");
  });

  it("does not dispatch when the durable owner and bearer owner differ", async () => {
    await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "entry-a" },
      patch: { description: "Account A" }
    });
    vi.mocked(secureSession.readOwnedAuthenticatedSessionSnapshot)
      .mockResolvedValueOnce({ status: "owner_mismatch" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({
      reason: "session_changed",
      waitingCount: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it("keeps a permanent rejection as actionable diagnostics without pending projection", async () => {
    const command = await outbox.enqueueTimeEntryUpdate({
      owner: OWNER_A,
      target: { targetEntryId: "deleted-on-server" },
      patch: { description: "Offline ghost edit" }
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));

    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({
      needsAttentionCount: 1,
      waitingCount: 0
    });
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      needsAttentionCount: 1,
      pendingCount: 0
    });
    await expect(outbox.listTimeEntrySyncIssues(OWNER_A)).resolves.toEqual([
      expect.objectContaining({
        clientCommandId: command.clientCommandId,
        failureKind: "permanent",
        lastStatusCode: 404
      })
    ]);

    await expect(outbox.retryTimeEntrySyncIssue(command.clientCommandId, OWNER_A))
      .resolves.toBe(true);
    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({ deliveredCount: 1, needsAttentionCount: 0 });
  });

  it("discards only an owned permanent issue", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({ clientCommandId: "issue-a", failureKind: "permanent" }),
      commandFixture({
        clientCommandId: "issue-b",
        failureKind: "permanent",
        userId: OWNER_B.userId,
        workspaceId: OWNER_B.workspaceId
      })
    ]));

    await expect(outbox.discardTimeEntrySyncIssue("issue-b", OWNER_A)).resolves.toBe(false);
    await expect(outbox.discardTimeEntrySyncIssue("issue-a", OWNER_A)).resolves.toBe(true);
    await expect(outbox.readPendingTimeEntryCommands(OWNER_B)).resolves.toEqual([
      expect.objectContaining({ clientCommandId: "issue-b" })
    ]);
  });

  it("quarantines malformed storage instead of silently treating it as empty", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", "{not-json");

    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([]);
    expect(storage.has("dayframe.timeEntryOutbox.v1")).toBe(false);
    const quarantined = JSON.parse(
      storage.get("dayframe.timeEntryOutbox.quarantine.v1") ?? "[]"
    ) as Array<{ raw: string; reason: string }>;
    expect(quarantined).toEqual([
      expect.objectContaining({
        raw: "{not-json",
        reason: expect.stringContaining("could not be parsed")
      })
    ]);
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      quarantinedCount: 0,
      deviceQuarantinedCount: 1
    });
    await expect(outbox.clearTimeEntryOutboxQuarantine(OWNER_A)).resolves.toBe(false);
    await outbox.clearDeviceTimeEntryOutboxQuarantine();
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      quarantinedCount: 0,
      deviceQuarantinedCount: 0
    });
  });

  it("quarantines a non-array outbox container", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify({ command: "not-an-array" }));

    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([]);
    expect(storage.has("dayframe.timeEntryOutbox.v1")).toBe(false);
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      quarantinedCount: 0,
      deviceQuarantinedCount: 1
    });
  });

  it("quarantines invalid records without discarding valid owned commands", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      commandFixture({ clientCommandId: "valid-command" }),
      {
        clientCommandId: "invalid-command",
        operation: "update",
        userId: OWNER_A.userId,
        workspaceId: OWNER_A.workspaceId
      }
    ]));

    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([
      expect.objectContaining({ clientCommandId: "valid-command" })
    ]);
    expect(JSON.parse(storage.get("dayframe.timeEntryOutbox.v1") ?? "[]"))
      .toEqual([expect.objectContaining({ clientCommandId: "valid-command" })]);
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      pendingCount: 1,
      quarantinedCount: 1,
      deviceQuarantinedCount: 0
    });
  });

  it("scopes recoverable quarantine evidence and clearing to its account", async () => {
    storage.set("dayframe.timeEntryOutbox.v1", JSON.stringify([
      {
        clientCommandId: "invalid-a",
        operation: "update",
        userId: OWNER_A.userId,
        workspaceId: OWNER_A.workspaceId
      },
      {
        clientCommandId: "invalid-b",
        operation: "update",
        userId: OWNER_B.userId,
        workspaceId: OWNER_B.workspaceId
      }
    ]));

    await outbox.readPendingTimeEntryCommands(OWNER_A);
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      quarantinedCount: 1,
      deviceQuarantinedCount: 0
    });
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_B)).resolves.toMatchObject({
      quarantinedCount: 1,
      deviceQuarantinedCount: 0
    });

    await expect(outbox.clearTimeEntryOutboxQuarantine(OWNER_A)).resolves.toBe(true);
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_A)).resolves.toMatchObject({
      quarantinedCount: 0
    });
    await expect(outbox.getTimeEntryOutboxDiagnostics(OWNER_B)).resolves.toMatchObject({
      quarantinedCount: 1
    });
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
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);

    await expect(outbox.releaseTimeEntryCommands([held.clientCommandId], {
      owner: OWNER_A,
      requestImmediateDelivery: true
    })).resolves.toBe(1);
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(1);
    await expect(outbox.synchroniseTimeEntryCommands({
      owner: OWNER_A,
      correlations: new Map(),
      force: true
    })).resolves.toMatchObject({ deliveredCount: 1, waitingCount: 0 });
    expect(getTimerBackgroundExecutionSnapshot().activeLeaseCount).toBe(0);

    const undone = await outbox.enqueueTimeEntryDelete({
      owner: OWNER_A,
      target: { targetEntryId: "entry-undone" },
      deliverAfter: "2026-08-22T12:00:06.000Z"
    });
    await expect(outbox.removeTimeEntryCommands([undone.clientCommandId])).resolves.toBe(1);
    await expect(outbox.readPendingTimeEntryCommands(OWNER_A)).resolves.toEqual([]);
  });

  it.each(["update", "delete"] as const)(
    "sends the %s command's own id, unchanged, on the first attempt and on a resend after a lost response (item 17)",
    async (operation) => {
      const patch = { categoryId: "cat-x", description: "phone A", tagNames: ["alpha"] };
      if (operation === "update") {
        await outbox.enqueueTimeEntryUpdate({ owner: OWNER_A, target: { targetEntryId: "entry-1" }, patch });
      } else {
        await outbox.enqueueTimeEntryDelete({ owner: OWNER_A, target: { targetEntryId: "entry-1" } });
      }
      const [queued] = await outbox.readPendingTimeEntryCommands(OWNER_A);
      const sent: Array<{ headers: Record<string, string>; body?: unknown }> = [];
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
        sent.push({ headers: init?.headers as Record<string, string>, body: init?.body });
        // The first attempt reaches the server but its response is lost.
        if (sent.length === 1) return new Promise(() => undefined);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }));

      const first = outbox.synchroniseTimeEntryCommands({ owner: OWNER_A, correlations: new Map(), force: true });
      await vi.advanceTimersByTimeAsync(outbox.MOBILE_TIME_ENTRY_COMMAND_TIMEOUT_MS);
      expect(await first).toMatchObject({ reason: "retryable_failure", waitingCount: 1 });
      expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER_A, correlations: new Map(), force: true }))
        .toMatchObject({ deliveredCount: 1, waitingCount: 0 });

      expect(sent).toHaveLength(2);
      expect(queued?.clientCommandId).toMatch(/^mobile-time-entry:/);
      for (const request of sent) {
        expect(request.headers["X-Dayframe-Client-Command-Id"]).toBe(queued?.clientCommandId);
      }
      // The Edit body is exactly what an older build sends: the id travels only in the header.
      expect(sent[0]?.body).toBe(operation === "update" ? JSON.stringify(patch) : undefined);
      expect(sent[1]?.body).toBe(sent[0]?.body);
    }
  );
});

function commandFixture(input: {
  clientCommandId: string;
  deliverAfter?: string;
  failureKind?: "retryable" | "permanent";
  nextAttemptAt?: string;
  optimisticEntryId?: string;
  targetEntryId?: string | null;
  userId?: string;
  workspaceId?: string;
}) {
  return {
    attemptCount: input.failureKind ? 1 : 0,
    clientCommandId: input.clientCommandId,
    createdAt: "2026-08-22T11:59:00.000Z",
    operation: "update",
    patch: { description: input.clientCommandId },
    ...(input.targetEntryId === null
      ? {}
      : { targetEntryId: input.targetEntryId ?? `entry:${input.clientCommandId}` }),
    ...(input.optimisticEntryId ? { optimisticEntryId: input.optimisticEntryId } : {}),
    updatedAt: "2026-08-22T11:59:00.000Z",
    userId: input.userId ?? OWNER_A.userId,
    workspaceId: input.workspaceId ?? OWNER_A.workspaceId,
    ...(input.failureKind ? { failureKind: input.failureKind } : {}),
    ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    ...(input.deliverAfter ? { deliverAfter: input.deliverAfter } : {})
  };
}
