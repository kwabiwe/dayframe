import { beforeEach, describe, expect, it, vi } from "vitest";

const baseSession = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  changeSupabasePassword: vi.fn(),
  hashPassword: vi.fn(),
  query: vi.fn(),
  resolveRequestSession: vi.fn(),
  verifyPassword: vi.fn()
}));

vi.mock("@/lib/auth/supabase", () => ({
  changeSupabasePassword: mocks.changeSupabasePassword
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

  it("refuses a goal change made for another account than the one signed in now (UIA-309)", async () => {
    const response = await PATCH(jsonRequest({ dailyGoalMinutes: 600, expectedUserId: "someone-else" }));
    expect(response.status).toBe(409);
    expect(mocks.query).not.toHaveBeenCalled();
    const ok = await PATCH(jsonRequest({ dailyGoalMinutes: 600, expectedUserId: baseSession.userId }));
    expect(ok.status).toBe(200);
  });

  it("reauthenticates provider sessions before changing their Supabase password", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ email: "kb@example.com", passwordHash: null }]
    });
    const response = await PATCH(jsonRequest({
      currentPassword: "current-password",
      newPassword: "new-password"
    }));

    expect(response.status).toBe(200);
    expect(mocks.changeSupabasePassword).toHaveBeenCalledWith(
      "kb@example.com",
      "current-password",
      "new-password"
    );
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
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

  it("bumps the goals revision in the same update and replies with the stored goals (UIA-309)", async () => {
    mocks.query.mockImplementation(async (text: string) => (
      text.includes("goals_revision")
        ? { rows: [{ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400, goalsRevision: "7" }] }
        : { rows: [] }
    ));
    const response = await PATCH(jsonRequest({ dailyGoalMinutes: 540 }));
    const update = mocks.query.mock.calls.find(([text]) => String(text).includes("daily_goal_minutes"))!;
    expect(String(update[0])).toContain("goals_revision = goals_revision + 1");
    expect(String(update[0])).toContain("returning");
    expect(await response.json()).toEqual({ ok: true, goals: { dailyGoalMinutes: 540, weeklyGoalMinutes: 2400, goalsRevision: 7 } });
  });

  it("turns Log trips automatically on or off and replies with the stored value (PRD D19, A4)", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ value: false }] });
    const response = await PATCH(jsonRequest({ logTripsAutomatically: false }));
    expect(await response.json()).toEqual({ ok: true, logTripsAutomatically: false });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("log_trips_automatically = $1"), [false, baseSession.userId]);
    const invalid = await PATCH(jsonRequest({ logTripsAutomatically: "no" }));
    expect(invalid.status).toBe(400);
  });

  it("leaves the goals revision alone when no goal changes", async () => {
    const response = await PATCH(jsonRequest({ name: "Demo User" }));
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.query.mock.calls.some(([text]) => String(text).includes("goals_revision"))).toBe(false);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
