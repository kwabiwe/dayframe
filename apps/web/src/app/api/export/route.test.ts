import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["exports:read"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

const { GET } = await import("./route");

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
  });

  it("returns a client error for an unsupported export kind", async () => {
    const response = await GET(new Request("https://dayframe.test/api/export?kind=raw_database"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported export kind." });
    expect(mocks.resolveRequestSession).toHaveBeenCalledOnce();
  });
});
