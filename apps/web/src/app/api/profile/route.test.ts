import { beforeEach, describe, expect, it, vi } from "vitest";

const baseSession = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  query: vi.fn(),
  resolveRequestSession: vi.fn(),
  verifyPassword: vi.fn()
}));

vi.mock("@/lib/auth/local", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

const { PATCH } = await import("./route");

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(baseSession);
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.hashPassword.mockResolvedValue("new-password-hash");
  });

  it("rejects empty profile and workspace names without discarding form intent", async () => {
    const profileResponse = await PATCH(jsonRequest({ name: " " }));
    const workspaceResponse = await PATCH(jsonRequest({ workspaceName: "" }));

    expect(profileResponse.status).toBe(400);
    expect(await profileResponse.json()).toEqual({ error: "Enter your name." });
    expect(workspaceResponse.status).toBe(400);
    expect(await workspaceResponse.json()).toEqual({ error: "Enter a workspace name." });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("keeps goals inside the existing stored ranges, including rejecting zero", async () => {
    const zeroResponse = await PATCH(jsonRequest({ dailyGoalMinutes: 0, weeklyGoalMinutes: 2400 }));
    const excessiveResponse = await PATCH(jsonRequest({ dailyGoalMinutes: 480, weeklyGoalMinutes: 10081 }));

    expect(zeroResponse.status).toBe(400);
    expect(excessiveResponse.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not expose a broken local-password flow to provider sessions", async () => {
    const response = await PATCH(jsonRequest({
      currentPassword: "current-password",
      newPassword: "new-password"
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Password changes are available only for local sign-in."
    });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("changes a password only for a verified local session", async () => {
    mocks.resolveRequestSession.mockResolvedValueOnce({ ...baseSession, authMode: "local" });
    mocks.query
      .mockResolvedValueOnce({ rows: [{ passwordHash: "current-password-hash" }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await PATCH(jsonRequest({
      currentPassword: "current-password",
      newPassword: "new-password"
    }));

    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("current-password", "current-password-hash");
    expect(mocks.hashPassword).toHaveBeenCalledWith("new-password");
    expect(mocks.query).toHaveBeenLastCalledWith(
      "update users set password_hash = $1 where id = $2",
      ["new-password-hash", baseSession.userId]
    );
  });

  it("rejects an incorrect current password without updating it", async () => {
    mocks.resolveRequestSession.mockResolvedValueOnce({ ...baseSession, authMode: "local" });
    mocks.query.mockResolvedValueOnce({ rows: [{ passwordHash: "current-password-hash" }] });
    mocks.verifyPassword.mockResolvedValueOnce(false);

    const response = await PATCH(jsonRequest({
      currentPassword: "incorrect-password",
      newPassword: "new-password"
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Current password is incorrect." });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it("updates names and minute-based goals through the existing contract", async () => {
    const response = await PATCH(jsonRequest({
      name: "Demo User",
      workspaceName: "Personal",
      dailyGoalMinutes: 495,
      weeklyGoalMinutes: 2430
    }));

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(
      "update users set name = $1 where id = $2",
      ["Demo User", baseSession.userId]
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "update workspaces set name = $1 where id = $2",
      ["Personal", baseSession.workspaceId]
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("daily_goal_minutes"),
      [495, 2430, baseSession.userId]
    );
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
