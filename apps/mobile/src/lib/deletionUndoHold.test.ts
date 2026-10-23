import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stability audit timer-1: a sheet deletion's delete must not reach the server while its Undo, which
// opens only once the sheet has left, still accepts. Drives the real coordinator and the real outbox,
// wired the way DayframeDashboard wires them.

const storage = vi.hoisted(() => new Map<string, string>());
// Lets a test hold the outbox's storage write open, as a slow write during sign-out would be.
const writeGate = vi.hoisted(() => ({ next: null as Promise<void> | null, skip: 0 }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      let gate = key === "dayframe.timeEntryOutbox.v1" ? writeGate.next : null;
      if (gate && writeGate.skip > 0) {
        writeGate.skip -= 1;
        gate = null;
      }
      if (gate) {
        writeGate.next = null;
        await gate;
      }
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
const hold = await import("./deletionUndoHold");
const { createDeletionCoordinator, DELETION_UNDO_MS } = await import("./historyDeletion");
const OWNER = { userId: "user-a", workspaceId: "workspace-a" };

describe("undoable delete hold covers the whole Undo window", () => {
  let deletes: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimeEntryOutboxForTests();
    writeGate.next = null;
    writeGate.skip = 0;
    await account.activateMobileAccount(OWNER);
    deletes = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") deletes.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Holds open the outbox write after `skip` others. */
  function gateNextOutboxWrite(skip = 0) {
    writeGate.skip = skip;
    let open = () => undefined as void;
    writeGate.next = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => open();
  }

  // Mirrors DayframeDashboard: one lease per coordinator, ids recorded once all writes are done.
  function harness() {
    const commandIds = new Map<number, string[]>();
    const restored: number[] = [];
    const refused: number[] = [];
    const lapsed: string[] = [];
    const lease = hold.createUndoHoldLease((clientCommandId) => {
      lapsed.push(clientCommandId);
      for (const [token, ids] of commandIds) {
        if (ids.includes(clientCommandId)) coordinator.commit(token);
      }
    });
    const coordinator = createDeletionCoordinator<{ id: string }, null>({
      canRestore: ({ token }) => hold.canUndoDeletes(commandIds.get(token) ?? []),
      onActivate: ({ activatedAt, token }) => {
        void hold.holdDeletesForOpenedUndoWindow(commandIds.get(token) ?? [], activatedAt);
      },
      onCommit: ({ token }) => {
        void outbox.releaseTimeEntryCommands(commandIds.get(token) ?? [], { owner: OWNER });
      },
      onPendingChange: () => undefined,
      onRestore: ({ token }) => {
        restored.push(token);
        void outbox.removeTimeEntryCommands(commandIds.get(token) ?? []);
      },
      onRestoreRefused: ({ token }) => {
        refused.push(token);
      }
    });
    async function persist(entryIds: string[], token: number) {
      const ids = await hold.persistUndoableTimeEntryDeletes({
        lease,
        owner: OWNER,
        targets: entryIds.map((targetEntryId) => ({ targetEntryId }))
      });
      if (lease.ended) return null;
      commandIds.set(token, ids);
      return ids;
    }
    return {
      coordinator,
      lapsed,
      refused,
      restored,
      // Sign-out (transitionToSignedOut) and provider teardown (unmount) both do this.
      teardown() {
        coordinator.dispose();
        lease.end();
        commandIds.clear();
      },
      persist,
      async prepare(entryId: string) {
        const prepared = coordinator.prepare([{ id: entryId }], null);
        if (!prepared) throw new Error("not prepared");
        const [clientCommandId] = (await persist([entryId], prepared.token)) ?? [];
        return { command: { clientCommandId }, token: prepared.token };
      },
      startGroup(entryIds: string[]) {
        const prepared = coordinator.prepare(entryIds.map((id) => ({ id })), null);
        if (!prepared) throw new Error("not prepared");
        return persist(entryIds, prepared.token);
      }
    };
  }

  function sync(force = false) {
    return outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force });
  }

  async function sheetScenario(sheetExitMs: number, syncAfterOpenMs: number) {
    const h = harness();
    const { token } = await h.prepare("entry-a");
    await vi.advanceTimersByTimeAsync(sheetExitMs);
    // completeActiveEditorExit / completeCalendarEntryExit -> activateSheetDeletion
    expect(h.coordinator.activate(token)).toBe(true);
    await vi.advanceTimersByTimeAsync(syncAfterOpenMs);
    // Any unrelated sync: connectivity recovery on return, a foreground pass, another edit's forced sync.
    await sync();
    await sync(true);
    const undoAccepted = h.coordinator.undo(token);
    await vi.advanceTimersByTimeAsync(0);
    return {
      deletes: deletes.length,
      pendingAfter: (await outbox.readPendingTimeEntryCommands(OWNER)).length,
      undoAccepted
    };
  }

  it("fast sheet exit (400 ms): a sync inside the Undo window is deferred and Undo restores", async () => {
    expect(await sheetScenario(400, 4_600)).toEqual({ deletes: 0, pendingAfter: 0, undoAccepted: true });
  });

  it("slow sheet exit (2 s): a sync 6.1 s after the delete was written cannot delete before Undo", async () => {
    expect(await sheetScenario(2_000, 4_100)).toEqual({ deletes: 0, pendingAfter: 0, undoAccepted: true });
  });

  it("app suspended 30 s mid-dismiss: the sync on return cannot delete before Undo", async () => {
    expect(await sheetScenario(30_000, 0)).toEqual({ deletes: 0, pendingAfter: 0, undoAccepted: true });
    expect(await sheetScenario(30_000, DELETION_UNDO_MS - 1)).toEqual({
      deletes: 0,
      pendingAfter: 0,
      undoAccepted: true
    });
  });

  it("keeps a prepared delete held until its Undo window opens, then until it closes", async () => {
    const h = harness();
    const { token } = await h.prepare("entry-a");
    // Suspended mid-dismiss well past the durable deadline, inside the hold's bound.
    await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS + 1_000 + outbox.HOLD_LAPSE_MARGIN_MS - 1);
    expect((await sync(true)).reason).toBe("deferred");
    expect(deletes).toEqual([]);

    h.coordinator.activate(token);
    await vi.advanceTimersByTimeAsync(0);
    const [command] = await outbox.readPendingTimeEntryCommands(OWNER);
    // A force-quit now still waits for the window that just opened.
    expect(Date.parse(command.deliverAfter as string)).toBe(Date.now() + DELETION_UNDO_MS + 1_000);

    await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS - 1);
    expect((await sync(true)).reason).toBe("deferred");
    expect(deletes).toEqual([]);

    // The window closes: the coordinator commits and releases the delete.
    await vi.advanceTimersByTimeAsync(1);
    await sync(true);
    expect(deletes).toHaveLength(1);
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
  });

  it("delivers a cancelled delete after its durable hold, as after a force-quit", async () => {
    const h = harness();
    await h.prepare("entry-a");
    h.teardown();
    expect((await sync(true)).reason).toBe("deferred");
    await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS + 1_000);
    await sync(true);
    expect(deletes).toHaveLength(1);
  });

  for (const lifetimeEnd of ["sign-out", "dashboard unmount"]) {
    it(`${lifetimeEnd} during a single delete's write leaves no hold behind (Codex r1 on #540)`, async () => {
      const h = harness();
      const openWrite = gateNextOutboxWrite();
      const prepared = h.coordinator.prepare([{ id: "entry-a" }], null);
      const writing = h.persist(["entry-a"], prepared?.token as number);
      await vi.advanceTimersByTimeAsync(0);
      h.teardown();
      openWrite();
      expect(await writing).toBeNull();

      // The delete stands (durable) and goes once its durable hold ends; later work is not stuck.
      expect(await outbox.readPendingTimeEntryCommands(OWNER)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS + 1_000);
      await outbox.enqueueTimeEntryUpdate({
        owner: OWNER,
        target: { targetEntryId: "entry-b" },
        patch: { description: "later edit" }
      });
      await sync(true);
      expect(deletes).toHaveLength(1);
      expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
    });

    it(`${lifetimeEnd} during a group deletion's writes leaves no hold behind`, async () => {
      const h = harness();
      // The first write lands; the second is still being written when the owner goes away.
      const openWrite = gateNextOutboxWrite(1);
      const writing = h.startGroup(["entry-a", "entry-b", "entry-c"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(await outbox.readPendingTimeEntryCommands(OWNER)).toHaveLength(1);
      h.teardown();
      openWrite();
      expect(await writing).toBeNull();

      expect(await outbox.readPendingTimeEntryCommands(OWNER)).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS + 1_000);
      await sync(true);
      expect(deletes).toHaveLength(3);
      expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
    });
  }

  it("bounds a hold whose Undo never opens: it lapses 30 s past its durable deadline, closing Undo first", async () => {
    const h = harness();
    const { command, token } = await h.prepare("entry-a");
    await vi.advanceTimersByTimeAsync(DELETION_UNDO_MS + 1_000 + outbox.HOLD_LAPSE_MARGIN_MS);
    expect((await sync(true)).reason).toBe("deferred");
    expect(h.lapsed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await sync(true);
    expect(h.lapsed).toEqual([command.clientCommandId]);
    expect(h.coordinator.current()).toBeNull();
    expect(h.coordinator.activate(token)).toBe(false);
    expect(h.coordinator.undo(token)).toBe(false);
    expect(h.restored).toEqual([]);
    expect(deletes).toHaveLength(1);
  });

  it("refuses Undo, without restoring, once a request for the delete was sent", async () => {
    const h = harness();
    const { command, token } = await h.prepare("entry-a");
    h.coordinator.activate(token);
    await vi.advanceTimersByTimeAsync(0);
    // Simulate both holds being lost (the app never does this inside the window): the delete goes out.
    await outbox.releaseTimeEntryCommands([command.clientCommandId]);
    await sync(true);
    expect(deletes).toHaveLength(1);

    expect(h.coordinator.undo(token)).toBe(false);
    expect(h.restored).toEqual([]);
    expect(h.refused).toEqual([token]);
    expect(h.coordinator.current()).toBeNull();
  });
});
