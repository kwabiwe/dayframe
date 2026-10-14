import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn(),
  pendingShortcutEvents: vi.fn(),
  removeShortcutEvents: vi.fn(),
  pendingShortcutStartMarkers: vi.fn(),
  addPendingShortcutStartMarkers: vi.fn(),
  markPendingShortcutStartsReconciled: vi.fn(),
  clearPendingShortcutStartMarkers: vi.fn(),
  accountListeners: [] as Array<() => void>,
  queueListeners: [] as Array<() => void>,
  readQueue: vi.fn(),
  settingsStore: new Map<string, unknown>()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      pendingShortcutEvents: mocks.pendingShortcutEvents,
      removeShortcutEvents: mocks.removeShortcutEvents,
      pendingShortcutStartMarkers: mocks.pendingShortcutStartMarkers,
      addPendingShortcutStartMarkers: mocks.addPendingShortcutStartMarkers,
      markPendingShortcutStartsReconciled: mocks.markPendingShortcutStartsReconciled,
      clearPendingShortcutStartMarkers: mocks.clearPendingShortcutStartMarkers
    }
  },
  Platform: { OS: "ios" },
  Settings: {
    get: (key: string) => mocks.settingsStore.get(key),
    set: (settings: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(settings)) {
        mocks.settingsStore.set(key, value);
      }
    }
  }
}));

vi.mock("./api", () => ({
  enqueueEvent: mocks.enqueueEvent,
  readQueue: mocks.readQueue,
  subscribeActivityQueue: (listener: () => void) => {
    mocks.queueListeners.push(listener);
    return () => undefined;
  }
}));

vi.mock("./mobileAccount", () => ({
  mobileAccountOwnersEqual: (
    left: { userId?: string; workspaceId?: string } | null,
    right: { userId?: string; workspaceId?: string } | null
  ) => left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
  readActiveMobileAccount: vi.fn(async () => ({ userId: "user-1", workspaceId: "workspace-1" })),
  subscribeActiveMobileAccount: (listener: () => void) => {
    mocks.accountListeners.push(listener);
    return () => undefined;
  }
}));

const {
  clearActiveOwnerNativeShortcutQueue,
  drainNativeShortcutQueue,
  getNativeShortcutPendingCount,
  reconcilePendingShortcutStartMarkers,
  startPendingShortcutStartReconciliation,
  syncShortcutCatalog
} = await import("./shortcuts");
const OWNER = { userId: "user-1", workspaceId: "workspace-1" };

describe("native Shortcut bridge", () => {
  beforeEach(() => {
    mocks.enqueueEvent.mockReset();
    mocks.enqueueEvent.mockResolvedValue([]);
    mocks.pendingShortcutEvents.mockReset();
    mocks.pendingShortcutEvents.mockResolvedValue([]);
    mocks.removeShortcutEvents.mockReset();
    mocks.removeShortcutEvents.mockResolvedValue(0);
    mocks.settingsStore.clear();
    mocks.pendingShortcutStartMarkers.mockReset();
    mocks.pendingShortcutStartMarkers.mockResolvedValue([]);
    mocks.clearPendingShortcutStartMarkers.mockReset();
    mocks.clearPendingShortcutStartMarkers.mockResolvedValue(0);
    mocks.addPendingShortcutStartMarkers.mockReset();
    mocks.addPendingShortcutStartMarkers.mockResolvedValue(0);
    mocks.markPendingShortcutStartsReconciled.mockReset();
    mocks.markPendingShortcutStartsReconciled.mockResolvedValue(true);
    mocks.accountListeners.length = 0;
    mocks.queueListeners.length = 0;
    mocks.readQueue.mockReset();
    mocks.readQueue.mockResolvedValue([]);
  });

  it("clears a pending-Start marker only once that Start has left both queues (Codex r2 on #403)", async () => {
    mocks.pendingShortcutStartMarkers.mockResolvedValue([
      { localId: "start-delivered", userId: "user-1", workspaceId: "workspace-1" },
      { localId: "start-in-app-queue", userId: "user-1", workspaceId: "workspace-1" },
      { localId: "start-still-native", userId: "user-1", workspaceId: "workspace-1" },
      { localId: "start-other-account", userId: "user-2", workspaceId: "workspace-2" }
    ]);
    mocks.pendingShortcutEvents.mockResolvedValue([
      { localId: "start-still-native", type: "shortcut_action", occurredAt: "2026-10-14T08:00:00.000Z", userId: "user-1", workspaceId: "workspace-1" }
    ]);
    // Moved into the app's queue but not yet acknowledged (or permanently failed: Sync help can retry it).
    mocks.readQueue.mockResolvedValue([{ localId: "start-in-app-queue", source: "shortcut", type: "shortcut_action", failureKind: "permanent" }]);
    await reconcilePendingShortcutStartMarkers(OWNER);
    expect(mocks.clearPendingShortcutStartMarkers).toHaveBeenCalledExactlyOnceWith(["start-delivered"]);
    expect(mocks.addPendingShortcutStartMarkers).not.toHaveBeenCalled();
    expect(mocks.markPendingShortcutStartsReconciled).toHaveBeenCalledWith("user-1", "workspace-1");
  });

  it("backfills a marker for a Start an older build moved into the app queue (Codex r3 on #403)", async () => {
    mocks.readQueue.mockResolvedValue([
      { localId: "older-start", source: "shortcut", type: "shortcut_action" },
      { localId: "app-start", source: "mobile_app", type: "shortcut_action" },
      { localId: "older-stop", source: "shortcut", type: "timer_stop" }
    ]);
    await reconcilePendingShortcutStartMarkers(OWNER);
    expect(mocks.addPendingShortcutStartMarkers).toHaveBeenCalledExactlyOnceWith([
      { localId: "older-start", userId: "user-1", workspaceId: "workspace-1" }
    ]);
  });

  it("reconciles after an empty drain and whenever the account changes, so orphans clear", async () => {
    mocks.pendingShortcutStartMarkers.mockResolvedValue([{ localId: "orphan", userId: "user-1", workspaceId: "workspace-1" }]);
    await drainNativeShortcutQueue(OWNER);
    expect(mocks.clearPendingShortcutStartMarkers).toHaveBeenCalledWith(["orphan"]);
    mocks.clearPendingShortcutStartMarkers.mockClear();
    const stop = startPendingShortcutStartReconciliation();
    await vi.waitFor(() => expect(mocks.clearPendingShortcutStartMarkers).toHaveBeenCalledTimes(1));
    mocks.accountListeners.forEach((listener) => listener());
    await vi.waitFor(() => expect(mocks.clearPendingShortcutStartMarkers).toHaveBeenCalledTimes(2));
    stop();
  });

  it("keeps the marker of a Start the drain just moved into the app queue", async () => {
    const start = { localId: "start-1", type: "shortcut_action", occurredAt: "2026-10-14T08:00:00.000Z", userId: "user-1", workspaceId: "workspace-1" };
    mocks.pendingShortcutEvents.mockResolvedValueOnce([start]).mockResolvedValue([]);
    mocks.pendingShortcutStartMarkers.mockResolvedValue([{ localId: "start-1", userId: "user-1", workspaceId: "workspace-1" }]);
    mocks.readQueue.mockResolvedValue([{ localId: "start-1", type: "shortcut_action" }]);
    await drainNativeShortcutQueue(OWNER);
    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["start-1"]);
    expect(mocks.clearPendingShortcutStartMarkers).not.toHaveBeenCalled();
  });

  it("mirrors non-secret native Shortcut config with the catalog", () => {
    syncShortcutCatalog({
      user: { id: "user-1", email: "user@example.com", name: "User" },
      workspace: { id: "workspace-1", name: "Personal" },
      categories: [
        { id: "category-2", name: "Family", color: "coral", isPinned: true },
        { id: "category-1", name: "Focus", color: "lime", isPinned: true }
      ]
    });

    expect(JSON.parse(String(mocks.settingsStore.get("dayframe.shortcutCatalog.v1")))).toEqual({
      user: { id: "user-1" },
      workspace: { id: "workspace-1", name: "Personal" },
      categories: [
        { color: "#F2475E", id: "category-2", lightColor: "#D0344C", name: "Family" },
        { color: "#16D2A6", id: "category-1", lightColor: "#0FBF95", name: "Focus" }
      ]
    });
  });

  it("moves native pending Shortcut events into the normal offline queue", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([
      {
        localId: "native-shortcut-1",
        type: "shortcut_action",
        occurredAt: "2026-07-12T03:50:00.000Z",
        categoryId: "category-1",
        description: "School run",
        rawPayload: { origin: "ios_app_intent", categoryName: "Family" },
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      },
      {
        localId: "native-shortcut-2",
        type: "timer_stop",
        occurredAt: "2026-07-12T04:05:00.000Z",
        rawPayload: { origin: "ios_app_intent" },
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      }
    ]);

    await expect(drainNativeShortcutQueue(OWNER)).resolves.toEqual({
      transferredCount: 2,
      transferredLocalIds: ["native-shortcut-1", "native-shortcut-2"]
    });

    expect(mocks.enqueueEvent).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(1, {
      owner: OWNER,
      localId: "native-shortcut-1",
      source: "shortcut",
      type: "shortcut_action",
      occurredAt: new Date("2026-07-12T03:50:00.000Z"),
      categoryId: "category-1",
      description: "School run",
      rawPayload: { origin: "ios_app_intent", categoryName: "Family" }
    });
    expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(2, {
      owner: OWNER,
      localId: "native-shortcut-2",
      source: "shortcut",
      type: "timer_stop",
      occurredAt: new Date("2026-07-12T04:05:00.000Z"),
      categoryId: undefined,
      description: undefined,
      rawPayload: { origin: "ios_app_intent" }
    });
    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["native-shortcut-1", "native-shortcut-2"]);
  });

  it("only acknowledges native Shortcut events that transferred before a failure", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([
      {
        localId: "native-shortcut-1",
        type: "shortcut_action",
        occurredAt: "2026-07-12T03:50:00.000Z",
        rawPayload: { origin: "ios_app_intent" },
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      },
      {
        localId: "native-shortcut-2",
        type: "timer_stop",
        occurredAt: "2026-07-12T04:05:00.000Z",
        rawPayload: { origin: "ios_app_intent" },
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      }
    ]);
    mocks.enqueueEvent
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("AsyncStorage failed"));

    await expect(drainNativeShortcutQueue(OWNER)).rejects.toThrow("AsyncStorage failed");

    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["native-shortcut-1"]);
  });

  it("counts and drains only native events owned by the active account", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([
      {
        localId: "owned",
        type: "shortcut_action",
        occurredAt: "2026-07-12T03:50:00.000Z",
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      },
      {
        localId: "other-account",
        type: "shortcut_action",
        occurredAt: "2026-07-12T03:51:00.000Z",
        userId: "user-2",
        workspaceId: "workspace-2"
      }
    ]);

    await expect(getNativeShortcutPendingCount(OWNER)).resolves.toBe(1);
    await expect(drainNativeShortcutQueue(OWNER)).resolves.toMatchObject({
      transferredCount: 1,
      transferredLocalIds: ["owned"]
    });
    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["owned"]);
  });

  it("adopts legacy unscoped native events into the active account queue", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([{
      localId: "legacy-unscoped",
      type: "shortcut_action",
      occurredAt: "2026-07-12T03:50:00.000Z"
    }]);

    await expect(getNativeShortcutPendingCount(OWNER)).resolves.toBe(1);
    await expect(drainNativeShortcutQueue(OWNER)).resolves.toEqual({
      transferredCount: 1,
      transferredLocalIds: ["legacy-unscoped"]
    });
    expect(mocks.enqueueEvent).toHaveBeenCalledWith(expect.objectContaining({
      localId: "legacy-unscoped",
      owner: OWNER,
      source: "shortcut"
    }));
    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["legacy-unscoped"]);
  });

  it("does not adopt partially scoped or other-account native events", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([
      {
        localId: "missing-workspace",
        type: "shortcut_action",
        userId: OWNER.userId
      },
      {
        localId: "other-account",
        type: "shortcut_action",
        userId: "user-2",
        workspaceId: "workspace-2"
      }
    ]);

    await expect(getNativeShortcutPendingCount(OWNER)).resolves.toBe(0);
    await expect(drainNativeShortcutQueue(OWNER)).resolves.toEqual({
      transferredCount: 0,
      transferredLocalIds: []
    });
    expect(mocks.enqueueEvent).not.toHaveBeenCalled();
    expect(mocks.removeShortcutEvents).not.toHaveBeenCalled();
  });

  it("clears owned and legacy events at logout without deleting another account's work", async () => {
    mocks.pendingShortcutEvents.mockResolvedValue([
      {
        localId: "owned",
        type: "shortcut_action",
        userId: OWNER.userId,
        workspaceId: OWNER.workspaceId
      },
      {
        localId: "legacy-unscoped",
        type: "timer_stop"
      },
      {
        localId: "other-account",
        type: "shortcut_action",
        userId: "user-2",
        workspaceId: "workspace-2"
      }
    ]);
    mocks.removeShortcutEvents.mockResolvedValue(2);

    await expect(clearActiveOwnerNativeShortcutQueue(OWNER)).resolves.toBe(2);
    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith([
      "owned",
      "legacy-unscoped"
    ]);
  });
});
