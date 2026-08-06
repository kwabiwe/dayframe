import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  registerLiveActivity: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/live-activity-push", () => ({
  registerLiveActivity: mocks.registerLiveActivity
}));

const { POST } = await import("./route");

describe("/api/live-activities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.registerLiveActivity.mockResolvedValue(undefined);
  });

  it("registers an authenticated ActivityKit token", async () => {
    const body = {
      token: "a".repeat(64),
      activityId: "activity-1",
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      environment: "production"
    };
    const response = await POST(new Request("https://dayframe.test/api/live-activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(201);
    expect(mocks.registerLiveActivity).toHaveBeenCalledWith(session, body);
  });

  it("rejects malformed or non-hex tokens", async () => {
    const response = await POST(new Request("https://dayframe.test/api/live-activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "not-a-token",
        activityId: "activity-1",
        activeEntryId: "80000000-0000-4000-8000-000000000001",
        environment: "production"
      })
    }));

    expect(response.status).toBe(400);
    expect(mocks.registerLiveActivity).not.toHaveBeenCalled();
  });
});
