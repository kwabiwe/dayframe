import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  createTag: vi.fn(),
  listTags: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/tag-service", () => ({ createTag: mocks.createTag, listTags: mocks.listTags }));

const { GET, POST } = await import("./route");

describe("/api/tags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.listTags.mockResolvedValue([]);
    mocks.createTag.mockResolvedValue({ id: tagId(), name: "Planning", normalizedName: "planning" });
  });

  it("lists scoped autocomplete matches", async () => {
    const response = await GET(new Request("https://dayframe.test/api/tags?q=pl"));
    expect(response.status).toBe(200);
    expect(mocks.listTags).toHaveBeenCalledWith(session, "pl");
  });

  it("creates a normalized tag and rejects unsafe names", async () => {
    const response = await POST(jsonRequest({ name: "Planning" }));
    expect(response.status).toBe(201);
    expect(mocks.createTag).toHaveBeenCalledWith({ name: "Planning" }, session);

    const invalid = await POST(jsonRequest({ name: "client/work" }));
    expect(invalid.status).toBe(400);
    expect(mocks.createTag).toHaveBeenCalledTimes(1);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function tagId() {
  return "50000000-0000-4000-8000-000000000001";
}
