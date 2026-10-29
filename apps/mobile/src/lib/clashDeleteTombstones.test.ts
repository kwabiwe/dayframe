import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, MobileReviewItem } from "./api";

// The real durable time-entry outbox over in-memory storage (as timeEntryOutbox.test.ts), with the clash filter.
const storage = vi.hoisted(() => new Map<string, string>());
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
  readOwnedAuthenticatedSessionSnapshot: vi.fn(async (owner) => ({ status: "authenticated", snapshot: { generation: 1, owner, token: "token-a" } }))
}));

const account = await import("./mobileAccount");
const outbox = await import("./timeEntryOutbox");
const { bootstrapBlocksById, clashEndsFor, clashStillAsksHere, createAcknowledgedEndLedger, createDeleteTombstones, projectTimerTripClashEnds,
  runningForStart } = await import("./timerTripClashBlocks");
const { captureDashboardRefreshGuard, reconcileDashboardRefreshCandidate } = await import("./dashboardRefresh");

const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
// Synthetic Exampleton data (location v4 design §7): "Team sync ran 18m into your trip", on block-1.
const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute).toISOString();
const clash: MobileReviewItem = {
  id: "clash-1", type: "location_timer_trip_clash", title: "Team sync ran 18m into your trip", eventSource: "location_learning",
  eventType: "timer_trip_clash", categoryName: null, placeName: null, suggestedCategoryId: null, suggestedPlaceId: null,
  suggestedStartedAt: at(9), suggestedStoppedAt: at(10, 42), confidence: "high", status: "open", notes: null,
  rawPayload: { timeEntryId: "block-1", tripId: "trip-1", tripStartedAt: at(10, 42), tripStoppedAt: at(11, 10), overlapSeconds: 1080 },
  createdAt: at(11), proposalHash: "e".repeat(64)
};
// The block is gone from the projected data (deleted here): only the tombstone tells "deleted" from "not loaded".
const data = { user: { id: OWNER.userId }, workspace: { id: OWNER.workspaceId }, categories: [], activeEntry: null, entries: [],
  reviewItems: [clash] } as unknown as MobileBootstrap;
const now = Date.parse(at(18));

describe("a deleted block's question and its delete's delivery, Undo and applied data (Codex r2 and r3 on #618)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"));
    storage.clear();
    account.__resetMobileAccountForTests();
    outbox.__resetTimeEntryOutboxForTests();
    await account.activateMobileAccount(OWNER);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** The Dashboard's wiring: the outbox's commands, and its delivered deletes, into one account's tombstones. */
  function wire() {
    const tombstones = createDeleteTombstones();
    const unsubscribe = outbox.subscribeDeliveredTimeEntryDeletes((command) => tombstones.delivered(command, Date.now()));
    const observe = async () => tombstones.observe(await outbox.readPendingTimeEntryCommands(OWNER));
    return { tombstones, observe, unsubscribe };
  }

  it("delete then Undo while offline: the tombstone goes with the command, and the restored block asks again", async () => {
    const { tombstones, observe, unsubscribe } = wire();
    await outbox.enqueueTimeEntryDelete({ owner: OWNER, target: { targetEntryId: "block-1" } });
    await observe();
    expect(clashStillAsksHere(clash, data, now, undefined, tombstones.ids())).toBe(false);
    // Offline: nothing is delivered. Undo removes the unsent command.
    const [command] = await outbox.readPendingTimeEntryCommands(OWNER);
    expect(await outbox.removeTimeEntryCommands([command.clientCommandId])).toBe(1);
    await observe();
    expect(tombstones.ids().size).toBe(0);
    // Its block is back in the data: the question is on it again.
    const restored = { ...data, entries: [{ id: "block-1", startedAt: at(9), stoppedAt: null, source: "mobile_app", reviewStatus: "confirmed",
      categoryId: null }] } as unknown as MobileBootstrap;
    expect(clashStillAsksHere(clash, restored, now, undefined, tombstones.ids())).toBe(true);
    unsubscribe();
  });

  it("an acknowledged delete keeps its tombstone through a failed refresh and a read the refresh guard discards", async () => {
    const { tombstones, observe, unsubscribe } = wire();
    await outbox.enqueueTimeEntryDelete({ owner: OWNER, target: { targetEntryId: "block-1" } });
    await observe();
    const startedBeforeDelivery = Date.now();
    vi.setSystemTime(new Date("2026-10-29T12:00:05.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true })).toMatchObject({ deliveredCount: 1 });
    await observe();
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
    expect(clashStillAsksHere(clash, data, now, undefined, tombstones.ids())).toBe(false);
    // The Dashboard's load: the real refresh guard; only an accepted read reports it was applied.
    vi.setSystemTime(new Date("2026-10-29T12:00:10.000Z"));
    const readStartedAt = Date.now();
    let revision = 1;
    const discarded = await reconcileDashboardRefreshCandidate({
      candidate: data, guard: captureDashboardRefreshGuard({ currentRevision: revision, timerMutationsInFlight: 0 }),
      currentRevision: () => revision, timerMutationsInFlight: () => 0,
      // A local mutation overtakes the read while it is reconciled.
      reconcile: async (candidate) => { revision += 1; return candidate; },
      onApplied: () => tombstones.applied(readStartedAt)
    });
    expect(discarded.action).toBe("refresh");
    expect(clashStillAsksHere(clash, data, now, undefined, tombstones.ids())).toBe(false);
    // A read that started before the delivery settles nothing even when applied.
    expect(tombstones.applied(startedBeforeDelivery)).toBe(false);
    const accepted = await reconcileDashboardRefreshCandidate({
      candidate: data, guard: captureDashboardRefreshGuard({ currentRevision: revision, timerMutationsInFlight: 0 }),
      currentRevision: () => revision, timerMutationsInFlight: () => 0, reconcile: async (candidate) => candidate,
      onApplied: () => tombstones.applied(readStartedAt)
    });
    expect(accepted.action).toBe("apply");
    expect(tombstones.ids().has("block-1")).toBe(false);
    unsubscribe();
  });

  it("drops the tombstone of a delete the server refused for good: its block is back", () => {
    const tombstones = createDeleteTombstones();
    tombstones.observe([{ operation: "delete", targetEntryId: "block-1" }]);
    tombstones.observe([{ operation: "delete", targetEntryId: "block-1", failureKind: "permanent" }]);
    expect(tombstones.ids().has("block-1")).toBe(false);
  });
});

describe("an acknowledged End it stays shown until applied server data confirms it (Codex r3 on #618)", () => {
  const running = { id: "block-1", startedAt: at(9), stoppedAt: null, source: "mobile_app", reviewStatus: "confirmed", categoryId: null,
    durationSeconds: 0 };
  const canonical = { ...data, activeEntry: running, entries: [running] } as unknown as MobileBootstrap;
  const end = { clientMutationId: "m-1", reviewItemId: "clash-1", timeEntryId: "block-1", tripStartedAt: at(10, 42), acknowledged: true,
    stoppedRunningTimer: true };

  it("keeps the block ended through a failed refresh and an unrelated queued edit, and retires only on confirming data", () => {
    const ledger = createAcknowledgedEndLedger();
    ledger.observe([end], 1_000);
    const shown = (bootstrap: MobileBootstrap) => projectTimerTripClashEnds(bootstrap, clashEndsFor([], new Set(), ledger.live([end])));
    expect(shown(canonical)!.activeEntry).toBeNull();
    // The refresh failed (nothing applied); an edit to another block is queued: new data, same stale running block.
    const edited = { ...canonical, entries: [...canonical.entries, { ...running, id: "other", stoppedAt: at(8) }] } as MobileBootstrap;
    expect(shown(edited)!.activeEntry).toBeNull();
    expect(bootstrapBlocksById(shown(edited)).get("block-1")?.stoppedAt).toBe(at(10, 42));
    // Applied data read before the acknowledgement was seen, still showing it running: not confirmation.
    expect(ledger.applied(500, canonical)).toBe(false);
    expect(shown(canonical)!.activeEntry).toBeNull();
    // Applied data that shows it ended at the trip's start: confirmed, the projection retires.
    const ended = { ...canonical, activeEntry: null, entries: [{ ...running, stoppedAt: at(10, 42) }] } as unknown as MobileBootstrap;
    expect(ledger.applied(500, ended)).toBe(true);
    expect(ledger.live([end])).toEqual([]);
  });

  it("retires on any applied read that started after the acknowledgement was seen: the server's data then speaks", () => {
    const ledger = createAcknowledgedEndLedger();
    ledger.observe([end], 1_000);
    expect(ledger.applied(1_000, canonical)).toBe(true);
    // An End it not yet acknowledged is always shown.
    expect(ledger.live([{ ...end, clientMutationId: "m-2", acknowledged: false }])).toHaveLength(1);
  });
});

describe("Start guards read the block as this iPhone shows it (Codex r2 on #618)", () => {
  const running = { id: "block-1", categoryId: "work" };
  it("treats a running block End it ended here as not running, and a deleting one too; otherwise the canonical one", () => {
    expect(runningForStart(running, { clashEndedId: "block-1" })).toBeNull();
    expect(runningForStart(running, { pendingDeletion: true })).toBeNull();
    expect(runningForStart(running, { clashEndedId: "other" })).toBe(running);
    expect(runningForStart(null, {})).toBeNull();
  });
});
