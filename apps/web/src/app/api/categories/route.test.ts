import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  reorderCategories: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  reorderCategories: mocks.reorderCategories
}));

const { PATCH } = await import("./route");

describe("PATCH /api/categories", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.reorderCategories.mockResolvedValue(undefined);
  });

  it("reorders categories for the resolved workspace", async () => {
    const response = await PATCH(jsonRequest({ categoryIds: ["category-2", "category-1"] }));

    expect(response.status).toBe(200);
    expect(mocks.reorderCategories).toHaveBeenCalledWith(["category-2", "category-1"], session);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
