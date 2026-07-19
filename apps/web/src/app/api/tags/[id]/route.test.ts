import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  deleteTag: vi.fn(),
  renameTag: vi.fn(),
  TagNotFoundError: class TagNotFoundError extends Error { status = 404; },
  TagConflictError: class TagConflictError extends Error { status = 409; }
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/tag-service", () => ({
  deleteTag: mocks.deleteTag,
  renameTag: mocks.renameTag,
  TagNotFoundError: mocks.TagNotFoundError,
  TagConflictError: mocks.TagConflictError
}));

const { DELETE, PATCH } = await import("./route");

describe("/api/tags/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.renameTag.mockResolvedValue({ id: tagId(), name: "Focused work", normalizedName: "focused-work" });
    mocks.deleteTag.mockResolvedValue({ id: tagId(), deleted: true });
  });

  it("renames and deletes through the request session", async () => {
    const renamed = await PATCH(jsonRequest({ name: "Focused work" }), context());
    const deleted = await DELETE(new Request(`https://dayframe.test/api/tags/${tagId()}`, { method: "DELETE" }), context());

    expect(renamed.status).toBe(200);
    expect(deleted.status).toBe(200);
    expect(mocks.renameTag).toHaveBeenCalledWith(tagId(), { name: "Focused work" }, session);
    expect(mocks.deleteTag).toHaveBeenCalledWith(tagId(), session);
  });

  it("returns a conflict for a case-insensitive duplicate rename", async () => {
    mocks.renameTag.mockRejectedValueOnce(new mocks.TagConflictError("A tag with that name already exists."));
    const response = await PATCH(jsonRequest({ name: "planning" }), context());
    expect(response.status).toBe(409);
  });
});

function context() {
  return { params: Promise.resolve({ id: tagId() }) };
}

function jsonRequest(body: unknown) {
  return new Request(`https://dayframe.test/api/tags/${tagId()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function tagId() {
  return "50000000-0000-4000-8000-000000000001";
}
