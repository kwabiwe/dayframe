import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  deleteTimeEntries: vi.fn(),
  resolveRequestSession: vi.fn(),
  TimeEntryNotFoundError: class TimeEntryNotFoundError extends Error {}
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  deleteTimeEntries: mocks.deleteTimeEntries,
  TimeEntryNotFoundError: mocks.TimeEntryNotFoundError
}));

const { POST } = await import("./route");

describe("POST /api/time-entries/batch-delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.deleteTimeEntries.mockResolvedValue({ ids: ids(), deletedCount: 2 });
  });

  it("deletes one scoped group atomically", async () => {
    const response = await POST(request(ids()));
    expect(response.status).toBe(200);
    expect(mocks.deleteTimeEntries).toHaveBeenCalledWith(ids(), session);
    await expect(response.json()).resolves.toMatchObject({ ok: true, deletedCount: 2 });
  });

  it("rejects invalid or single-entry batches", async () => {
    const response = await POST(request([ids()[0]]));
    expect(response.status).toBe(400);
    expect(mocks.deleteTimeEntries).not.toHaveBeenCalled();
  });
});

function request(entryIds: string[]) {
  return new Request("https://dayframe.test/api/time-entries/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: entryIds })
  });
}

function ids() {
  return [
    "80000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000002"
  ];
}
