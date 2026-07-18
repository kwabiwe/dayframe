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

const { drainNativeShortcutQueue, syncShortcutCatalog } = await import("./shortcuts");

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
      workspace: { id: "workspace-1", name: "Personal" },
      categories: [
        { id: "category-2", name: "Family", color: "coral", isPinned: true },
        { id: "category-1", name: "Focus", color: "lime", isPinned: true }
      ]
    });

    expect(JSON.parse(String(mocks.settingsStore.get("dayframe.shortcutCatalog.v1")))).toEqual({
      workspace: { id: "workspace-1", name: "Personal" },
      categories: [
        { color: "#12B8B0", id: "category-2", name: "Family" },
        { color: "#3ED598", id: "category-1", name: "Focus" }
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
        rawPayload: { origin: "ios_app_intent", categoryName: "Family" }
      },
      {
        localId: "native-shortcut-2",
        type: "timer_stop",
        occurredAt: "2026-07-12T04:05:00.000Z",
        rawPayload: { origin: "ios_app_intent" }
      }
    ]);

    await expect(drainNativeShortcutQueue()).resolves.toEqual({
      transferredCount: 2,
      transferredLocalIds: ["native-shortcut-1", "native-shortcut-2"]
    });

    expect(mocks.enqueueEvent).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(1, {
      localId: "native-shortcut-1",
      source: "shortcut",
      type: "shortcut_action",
      occurredAt: new Date("2026-07-12T03:50:00.000Z"),
      categoryId: "category-1",
      description: "School run",
      rawPayload: { origin: "ios_app_intent", categoryName: "Family" }
    });
    expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(2, {
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
        rawPayload: { origin: "ios_app_intent" }
      },
      {
        localId: "native-shortcut-2",
        type: "timer_stop",
        occurredAt: "2026-07-12T04:05:00.000Z",
        rawPayload: { origin: "ios_app_intent" }
      }
    ]);
    mocks.enqueueEvent
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("AsyncStorage failed"));

    await expect(drainNativeShortcutQueue()).rejects.toThrow("AsyncStorage failed");

    expect(mocks.removeShortcutEvents).toHaveBeenCalledWith(["native-shortcut-1"]);
  });
});
