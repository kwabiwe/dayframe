import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn(),
  pendingShortcutEvents: vi.fn(),
  removeShortcutEvents: vi.fn(),
  settingsStore: new Map<string, unknown>()
}));

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      pendingShortcutEvents: mocks.pendingShortcutEvents,
      removeShortcutEvents: mocks.removeShortcutEvents
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
  enqueueEvent: mocks.enqueueEvent
}));

vi.mock("./mobileAccount", () => ({
  mobileAccountOwnersEqual: (
    left: { userId?: string; workspaceId?: string } | null,
    right: { userId?: string; workspaceId?: string } | null
  ) => left?.userId === right?.userId && left?.workspaceId === right?.workspaceId,
  readActiveMobileAccount: vi.fn(async () => ({ userId: "user-1", workspaceId: "workspace-1" }))
}));

const {
  drainNativeShortcutQueue,
  getNativeShortcutPendingCount,
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
        { color: "#F87168", id: "category-2", name: "Family" },
        { color: "#4BCE97", id: "category-1", name: "Focus" }
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
});
