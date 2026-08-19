import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStore = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    })
  }
}));

const owner = { userId: "user-a", workspaceId: "workspace-a" };

async function loadOutbox() {
  vi.resetModules();
  return import("./timerStopOutbox");
}

describe("timer Stop outbox", () => {
  beforeEach(() => {
    asyncStore.clear();
  });

  it("survives a module reload after the local write", async () => {
    const firstModule = await loadOutbox();
    const pending = await firstModule.getOrCreatePendingStop({
      owner,
      target: { targetEntryId: "entry-a" },
      occurredAt: "2026-08-19T09:00:00.000Z"
    });

    const reloadedModule = await loadOutbox();

    await expect(reloadedModule.readPendingTimerStops()).resolves.toEqual([pending]);
  });

  it("reuses one clientEventId for repeated Stop of the same timer", async () => {
    const outbox = await loadOutbox();
    const first = await outbox.getOrCreatePendingStop({
      owner,
      target: { targetEntryId: "entry-a" }
    });
    const repeated = await outbox.getOrCreatePendingStop({
      owner,
      target: { targetEntryId: "entry-a" }
    });

    expect(repeated.clientEventId).toBe(first.clientEventId);
    await expect(outbox.readPendingTimerStops()).resolves.toHaveLength(1);
  });

  it("keeps optimistic identity until its canonical correlation is durable", async () => {
    const outbox = await loadOutbox();
    const pending = await outbox.getOrCreatePendingStop({
      owner,
      target: { optimisticEntryId: "optimistic-active-timer:a" }
    });

    expect(pending).toMatchObject({
      optimisticEntryId: "optimistic-active-timer:a"
    });
    expect(pending.targetEntryId).toBeUndefined();

    const resolved = await outbox.resolvePendingTimerStopTargets(new Map([
      ["optimistic-active-timer:a", "80000000-0000-4000-8000-000000000001"]
    ]));

    expect(resolved[0]).toMatchObject({
      clientEventId: pending.clientEventId,
      optimisticEntryId: "optimistic-active-timer:a",
      targetEntryId: "80000000-0000-4000-8000-000000000001"
    });
  });

  it("removes only the acknowledged logical Stop", async () => {
    const outbox = await loadOutbox();
    const first = await outbox.getOrCreatePendingStop({ owner, target: { targetEntryId: "entry-a" } });
    const second = await outbox.getOrCreatePendingStop({ owner, target: { targetEntryId: "entry-b" } });

    await outbox.removePendingTimerStop(first.clientEventId);

    await expect(outbox.readPendingTimerStops()).resolves.toEqual([second]);
  });

  it("serializes concurrent enqueue and removal without losing another record", async () => {
    const outbox = await loadOutbox();
    const first = await outbox.getOrCreatePendingStop({ owner, target: { targetEntryId: "entry-a" } });

    const [, second] = await Promise.all([
      outbox.removePendingTimerStop(first.clientEventId),
      outbox.getOrCreatePendingStop({ owner, target: { targetEntryId: "entry-b" } })
    ]);

    await expect(outbox.readPendingTimerStops()).resolves.toEqual([second]);
  });

  it("keeps a force-quit boundary recoverable before any network delivery", async () => {
    const outbox = await loadOutbox();
    const pending = await outbox.getOrCreatePendingStop({
      owner,
      target: { targetEntryId: "entry-a" },
      occurredAt: "2026-08-19T09:30:00.000Z"
    });

    const afterForceQuit = await loadOutbox();
    const recovered = await afterForceQuit.readPendingTimerStops();

    expect(recovered).toEqual([pending]);
    expect(recovered[0]?.failureCount).toBeUndefined();
  });

  it("keeps account ownership separate for an identical timer ID", async () => {
    const outbox = await loadOutbox();
    const accountA = await outbox.getOrCreatePendingStop({
      owner,
      target: { targetEntryId: "entry-shared" }
    });
    const accountB = await outbox.getOrCreatePendingStop({
      owner: { userId: "user-b", workspaceId: "workspace-b" },
      target: { targetEntryId: "entry-shared" }
    });

    expect(accountB.clientEventId).not.toBe(accountA.clientEventId);
    expect(outbox.pendingTimerStopsForOwner([accountA, accountB], owner)).toEqual([accountA]);
  });

  it("resolves and removes optimistic targets only within their owning account", async () => {
    const outbox = await loadOutbox();
    const accountA = await outbox.getOrCreatePendingStop({
      owner,
      target: { optimisticEntryId: "optimistic-active-timer:shared" }
    });
    const accountB = await outbox.getOrCreatePendingStop({
      owner: { userId: "user-b", workspaceId: "workspace-b" },
      target: { optimisticEntryId: "optimistic-active-timer:shared" }
    });

    await outbox.resolvePendingTimerStopTargets(
      new Map([["optimistic-active-timer:shared", "80000000-0000-4000-8000-000000000001"]]),
      owner
    );
    const afterResolution = await outbox.readPendingTimerStops();
    expect(afterResolution.find((item) => item.clientEventId === accountA.clientEventId)?.targetEntryId)
      .toBe("80000000-0000-4000-8000-000000000001");
    expect(afterResolution.find((item) => item.clientEventId === accountB.clientEventId)?.targetEntryId)
      .toBeUndefined();

    await outbox.removePendingTimerStopsForTarget(owner, {
      optimisticEntryId: "optimistic-active-timer:shared"
    });
    await expect(outbox.readPendingTimerStops()).resolves.toEqual([accountB]);
  });
});
