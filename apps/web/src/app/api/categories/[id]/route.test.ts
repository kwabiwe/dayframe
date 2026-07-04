import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  archiveCategory: vi.fn(),
  updateCategory: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  archiveCategory: mocks.archiveCategory,
  updateCategory: mocks.updateCategory
}));

const { DELETE, PATCH } = await import("./route");

describe("/api/categories/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.archiveCategory.mockResolvedValue(undefined);
    mocks.updateCategory.mockResolvedValue(undefined);
  });

  it("updates a category", async () => {
    const response = await PATCH(jsonRequest({ name: "Focus", isPinned: true }), {
      params: Promise.resolve({ id: "category-1" })
    });

    expect(response.status).toBe(200);
    expect(mocks.updateCategory).toHaveBeenCalledWith(
      "category-1",
      { name: "Focus", isPinned: true },
      session
    );
  });

  it("archives a category", async () => {
    const response = await DELETE(new Request("https://dayframe.test/api/categories/category-1"), {
      params: Promise.resolve({ id: "category-1" })
    });

    expect(response.status).toBe(200);
    expect(mocks.archiveCategory).toHaveBeenCalledWith("category-1", session);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/categories/category-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
