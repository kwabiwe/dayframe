import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getBootstrapData: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/queries", () => ({
  getBootstrapData: mocks.getBootstrapData
}));

vi.mock("@/lib/event-service", () => ({
  createCategory: mocks.createCategory,
  updateCategory: mocks.updateCategory,
  archiveCategory: mocks.archiveCategory
}));

const { missingRequiredColumnError } = await import("@/lib/db");
const { DELETE, GET, PATCH, POST } = await import("./route");

describe("/api/categories", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getBootstrapData.mockResolvedValue({
      categories: [{ id: categoryId(), name: "Focus", color: "lime", isPinned: true }]
    });
    mocks.createCategory.mockResolvedValue({ id: categoryId(), name: "Focus", color: "lime", isPinned: true });
    mocks.updateCategory.mockResolvedValue({ id: categoryId(), name: "Deep work", color: "sky", isPinned: true });
    mocks.archiveCategory.mockResolvedValue(undefined);
  });

  it("lists categories for the active workspace", async () => {
    const response = await GET(new Request("https://dayframe.test/api/categories"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.categories).toHaveLength(1);
    expect(mocks.getBootstrapData).toHaveBeenCalledWith(session);
  });

  it("creates a pinned category", async () => {
    const response = await POST(jsonRequest({ name: "Focus", color: "lime", isPinned: true }));

    expect(response.status).toBe(201);
    expect(mocks.createCategory).toHaveBeenCalledWith(
      { name: "Focus", color: "lime", isPinned: true },
      session
    );
  });

  it("edits category name, colour and pin state", async () => {
    const response = await PATCH(jsonRequest({ id: categoryId(), name: "Deep work", color: "sky", isPinned: true }));

    expect(response.status).toBe(200);
    expect(mocks.updateCategory).toHaveBeenCalledWith(
      categoryId(),
      { id: categoryId(), name: "Deep work", color: "sky", isPinned: true },
      session
    );
  });

  it("returns a clear schema error when category pin support is missing", async () => {
    mocks.updateCategory.mockRejectedValueOnce(
      missingRequiredColumnError(
        "categories",
        "is_pinned",
        "supabase/migrations/202607040001_category_pins_and_project_backfill.sql"
      )
    );

    const response = await PATCH(jsonRequest({ id: categoryId(), isPinned: true }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain("categories.is_pinned");
  });

  it("deletes a category", async () => {
    const response = await DELETE(new Request(`https://dayframe.test/api/categories?id=${categoryId()}`, { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mocks.archiveCategory).toHaveBeenCalledWith(categoryId(), session);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}
