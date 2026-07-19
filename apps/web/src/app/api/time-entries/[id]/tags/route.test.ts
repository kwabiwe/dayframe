import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  attachTagToTimeEntry: vi.fn(),
  detachTagFromTimeEntry: vi.fn(),
  TagNotFoundError: class TagNotFoundError extends Error { status = 404; }
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/tag-service", () => ({
  attachTagToTimeEntry: mocks.attachTagToTimeEntry,
  detachTagFromTimeEntry: mocks.detachTagFromTimeEntry,
  TagNotFoundError: mocks.TagNotFoundError
}));

const { DELETE, POST } = await import("./route");

describe("/api/time-entries/[id]/tags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.attachTagToTimeEntry.mockResolvedValue({ attached: true });
    mocks.detachTagFromTimeEntry.mockResolvedValue({ detached: true });
  });

  it("attaches and detaches a validated tag association", async () => {
    const attached = await POST(request("POST"), context());
    const detached = await DELETE(request("DELETE"), context());

    expect(attached.status).toBe(201);
    expect(detached.status).toBe(200);
    expect(mocks.attachTagToTimeEntry).toHaveBeenCalledWith(entryId(), tagId(), session);
    expect(mocks.detachTagFromTimeEntry).toHaveBeenCalledWith(entryId(), tagId(), session);
  });
});

function request(method: string) {
  return new Request(`https://dayframe.test/api/time-entries/${entryId()}/tags`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagId: tagId() })
  });
}

function context() {
  return { params: Promise.resolve({ id: entryId() }) };
}

function tagId() { return "50000000-0000-4000-8000-000000000001"; }
function entryId() { return "80000000-0000-4000-8000-000000000001"; }
