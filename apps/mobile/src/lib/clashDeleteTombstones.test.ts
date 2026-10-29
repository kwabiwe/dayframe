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
const { clashStillAsksHere, createDeleteTombstones, runningForStart } = await import("./timerTripClashBlocks");

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

describe("a deleted block's question stays answered through its delete's delivery (Codex r2 on #618)", () => {
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

  it("keeps the tombstone after the delete is acknowledged, through a failed refresh, until a later read settles it", async () => {
    const tombstones = createDeleteTombstones();
    const asks = () => clashStillAsksHere(clash, data, now, undefined, tombstones.ids());
    await outbox.enqueueTimeEntryDelete({ owner: OWNER, target: { targetEntryId: "block-1" } });
    tombstones.observe(await outbox.readPendingTimeEntryCommands(OWNER), Date.now());
    expect(asks()).toBe(false);
    // A read already in flight before delivery (it started now) is not authoritative for it.
    const inFlightStartedAt = Date.now();
    vi.setSystemTime(new Date("2026-10-29T12:00:05.000Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    expect(await outbox.synchroniseTimeEntryCommands({ owner: OWNER, correlations: new Map(), force: true })).toMatchObject({ deliveredCount: 1 });
    // Delivered: the command is gone, but the block is still known deleted.
    tombstones.observe(await outbox.readPendingTimeEntryCommands(OWNER), Date.now());
    expect(await outbox.readPendingTimeEntryCommands(OWNER)).toEqual([]);
    expect(asks()).toBe(false);
    expect(tombstones.authoritative(inFlightStartedAt)).toBe(false);
    // A failed refresh applies nothing: still deleted.
    expect(asks()).toBe(false);
    // A read that started after the delivery: the server's data now speaks for the block.
    vi.setSystemTime(new Date("2026-10-29T12:00:10.000Z"));
    expect(tombstones.authoritative(Date.now())).toBe(true);
    expect(tombstones.ids().has("block-1")).toBe(false);
  });

  it("drops the tombstone of a delete the server refused for good: its block is back", () => {
    const tombstones = createDeleteTombstones();
    tombstones.observe([{ operation: "delete", targetEntryId: "block-1" }], 1);
    tombstones.observe([{ operation: "delete", targetEntryId: "block-1", failureKind: "permanent" }], 2);
    expect(tombstones.ids().has("block-1")).toBe(false);
  });

  it("starts over for another account", () => {
    const tombstones = createDeleteTombstones();
    tombstones.observe([{ operation: "delete", targetEntryId: "block-1" }], 1);
    tombstones.reset();
    expect(tombstones.ids().size).toBe(0);
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
