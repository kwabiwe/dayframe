import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_WORKSPACE_COOKIE } from "@/lib/session";

const targetWorkspaceId = "00000000-0000-4000-8000-000000000011";

const baseSession = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "dev" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  resolveRequestSession: vi.fn(),
  sessionTokenFromRequest: vi.fn(),
  switchLocalSessionWorkspace: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/auth/local", () => ({
  sessionTokenFromRequest: mocks.sessionTokenFromRequest,
  switchLocalSessionWorkspace: mocks.switchLocalSessionWorkspace
}));

const { POST } = await import("./route");

describe("POST /api/workspace/switch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(baseSession);
    mocks.query.mockResolvedValue({ rows: [{ id: targetWorkspaceId }] });
    mocks.sessionTokenFromRequest.mockReturnValue("app-token");
    mocks.switchLocalSessionWorkspace.mockResolvedValue({ workspaceId: targetWorkspaceId });
  });

  it("sets the dev workspace cookie after a permitted dev workspace switch", async () => {
    const response = await POST(jsonRequest({ workspaceId: targetWorkspaceId }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, workspaceId: targetWorkspaceId });
    expect(response.headers.get("set-cookie")).toContain(`${DEV_WORKSPACE_COOKIE}=${targetWorkspaceId}`);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("workspace_members"), [
      targetWorkspaceId,
      baseSession.userId
    ]);
  });

  it("returns a useful error when the dev workspace is unavailable", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const response = await POST(jsonRequest({ workspaceId: targetWorkspaceId }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Workspace is not available for this account.");
  });

  it("updates provider app sessions through the stored app session token", async () => {
    mocks.resolveRequestSession.mockResolvedValueOnce({
      ...baseSession,
      authMode: "provider"
    });

    const response = await POST(jsonRequest({ workspaceId: targetWorkspaceId }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, workspaceId: targetWorkspaceId });
    expect(mocks.sessionTokenFromRequest).toHaveBeenCalled();
    expect(mocks.switchLocalSessionWorkspace).toHaveBeenCalledWith("app-token", targetWorkspaceId);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/workspace/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
