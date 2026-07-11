import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn()
}));

vi.mock("./api", () => ({
  enqueueEvent: apiMocks.enqueueEvent
}));

vi.mock("expo-linking", () => ({
  parse: vi.fn()
}));

const { enqueueShortcutAction } = await import("./deepLinks");

describe("Dayframe deep links", () => {
  beforeEach(() => {
    apiMocks.enqueueEvent.mockReset();
    apiMocks.enqueueEvent.mockResolvedValue([]);
  });

  it("queues Shortcut starts without requiring a category", async () => {
    await enqueueShortcutAction("action/start", {}, { route: "action/start" });

    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith({
      source: "shortcut",
      type: "shortcut_action",
      categoryId: undefined,
      description: undefined,
      rawPayload: { route: "action/start" }
    });
  });

  it("keeps explicit Shortcut description values", async () => {
    await enqueueShortcutAction(
      "action/start",
      { category: "Family", description: "School pickup" },
      { route: "action/start" }
    );

    expect(apiMocks.enqueueEvent).toHaveBeenCalledWith({
      source: "shortcut",
      type: "shortcut_action",
      categoryId: undefined,
      description: "School pickup",
      rawPayload: { categoryName: "Family", route: "action/start" }
    });
  });
});
