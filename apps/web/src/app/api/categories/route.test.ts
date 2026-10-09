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
  archiveCategory: vi.fn(),
  listArchivedCategories: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/queries", () => ({
  getBootstrapData: mocks.getBootstrapData
}));

vi.mock("@/lib/event-service", () => ({
  CategoryConflictError: class CategoryConflictError extends Error {
    status = 409;
  },
  QuickStartFullError: class QuickStartFullError extends Error {
    status = 409;
    code = "quick_start_full";
  },
  createCategory: mocks.createCategory,
  updateCategory: mocks.updateCategory,
  archiveCategory: mocks.archiveCategory,
  listArchivedCategories: mocks.listArchivedCategories
}));

const { missingRequiredColumnError } = await import("@/lib/db");
const { CategoryConflictError, QuickStartFullError } = await import("@/lib/event-service");
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

  it("creates and updates an activity icon from the shared set", async () => {
    const created = await POST(new Request("https://dayframe.test/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Garden", color: "moss", icon: "garden" })
    }));
    expect(created.status).toBe(201);
    expect(mocks.createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: "Garden", icon: "garden" }), session);

    const cleared = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), icon: null })
    }));
    expect(cleared.status).toBe(200);
    expect(mocks.updateCategory).toHaveBeenCalledWith(categoryId(), expect.objectContaining({ icon: null }), session);
  });

  it("rejects icons outside the shared set and starter keys from clients", async () => {
    const badIcon = await POST(new Request("https://dayframe.test/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Garden", icon: "shopping-bag" })
    }));
    expect(badIcon.status).toBe(400);

    const starter = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), starterKey: "sleep" })
    }));
    expect(mocks.updateCategory).not.toHaveBeenCalledWith(categoryId(), expect.objectContaining({ starterKey: "sleep" }), session);
    expect([200, 400]).toContain(starter.status);
    expect(mocks.createCategory).not.toHaveBeenCalled();
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

  it("keeps the automatic colour and unpinned default when picker colour is untouched", async () => {
    mocks.createCategory.mockResolvedValueOnce({ id: categoryId(), name: "Writing", color: "blue", isPinned: false });

    const response = await POST(jsonRequest({ name: "  Writing  " }));

    expect(response.status).toBe(201);
    expect(mocks.createCategory).toHaveBeenCalledWith({ name: "Writing" }, session);
  });

  it("creates an unpinned picker category with an explicitly chosen palette colour", async () => {
    mocks.createCategory.mockResolvedValueOnce({ id: categoryId(), name: "Writing", color: "sky", isPinned: false });

    const response = await POST(jsonRequest({ name: "  Writing  ", color: "sky" }));

    expect(response.status).toBe(201);
    expect(mocks.createCategory).toHaveBeenCalledWith({ name: "Writing", color: "sky" }, session);
  });

  it("rejects blank and duplicate category names with actionable errors", async () => {
    const blank = await POST(jsonRequest({ name: "   " }));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ error: "Activity name is required." });
    expect(mocks.createCategory).not.toHaveBeenCalled();

    mocks.createCategory.mockRejectedValueOnce(new CategoryConflictError("An activity with that name already exists."));
    const duplicate = await POST(jsonRequest({ name: "focus" }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: "An activity with that name already exists." });
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

// Blocks 6b-2: Archived activities, Restore, and the server's rename and quick-start checks.
describe("/api/categories archive, restore and limits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.updateCategory.mockResolvedValue({ id: categoryId(), name: "Pottery", color: "orange", isPinned: false });
  });

  it("lists archived activities for the signed-in workspace", async () => {
    mocks.listArchivedCategories.mockResolvedValue([{ id: categoryId(), name: "Pottery", color: "orange", isPinned: false }]);
    const response = await GET(new Request("https://dayframe.test/api/categories?archived=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categories: [{ id: categoryId(), name: "Pottery", color: "orange", isPinned: false }] });
    expect(mocks.listArchivedCategories).toHaveBeenCalledWith(session);
    expect(mocks.getBootstrapData).not.toHaveBeenCalled();
  });

  it("restores with isArchived false and refuses any other archive value", async () => {
    const restored = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), isArchived: false })
    }));
    expect(restored.status).toBe(200);
    expect(mocks.updateCategory).toHaveBeenCalledWith(categoryId(), expect.objectContaining({ isArchived: false }), session);

    const archiving = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), isArchived: true })
    }));
    expect(archiving.status).toBe(400);
  });

  it("answers 409 for a rename to a taken name and for a pin past quick start's limit", async () => {
    mocks.updateCategory.mockRejectedValueOnce(new CategoryConflictError("An activity with that name already exists."));
    const taken = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), name: "Focus" })
    }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "name_taken" });

    mocks.updateCategory.mockRejectedValueOnce(new QuickStartFullError("Quick start holds 6 activities. Unpin one first."));
    const full = await PATCH(new Request("https://dayframe.test/api/categories", {
      method: "PATCH",
      body: JSON.stringify({ id: categoryId(), isPinned: true })
    }));
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "quick_start_full", error: "Quick start holds 6 activities. Unpin one first." });
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
