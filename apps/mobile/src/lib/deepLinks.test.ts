import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueEvent: vi.fn()
}));

vi.mock("expo-linking", () => ({
  parse: vi.fn()
}));

vi.mock("./api", () => ({
  enqueueEvent: mocks.enqueueEvent
}));

const { enqueueShortcutAction } = await import("./deepLinks");

describe("deep link shortcuts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.enqueueEvent.mockResolvedValue([]);
  });

  it("queues category-only start actions", async () => {
    await enqueueShortcutAction(
      "action/start",
      { categoryId: "20000000-0000-4000-8000-000000000001" },
      { route: "action/start" }
    );

    expect(mocks.enqueueEvent).toHaveBeenCalledWith({
      source: "shortcut",
      type: "shortcut_action",
      projectId: undefined,
      categoryId: "20000000-0000-4000-8000-000000000001",
      rawPayload: { route: "action/start" }
    });
  });
});
