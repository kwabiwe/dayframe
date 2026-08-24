import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getTimerState: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/timer-state", () => ({
  getTimerState: mocks.getTimerState
}));

const { GET } = await import("./route");

describe("/api/timer-state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getTimerState.mockResolvedValue({
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      updatedAt: "2026-07-30T15:00:00.000Z",
      serverNow: "2026-07-30T15:00:03.000Z"
    });
  });

  it("returns a private workspace-scoped active-timer fingerprint", async () => {
    const response = await GET(new Request("https://dayframe.test/api/timer-state"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      updatedAt: "2026-07-30T15:00:00.000Z",
      serverNow: "2026-07-30T15:00:03.000Z"
    });
    expect(mocks.getTimerState).toHaveBeenCalledWith(session);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(expect.any(Request), {
      allowIngestToken: true,
      requiredScopes: ["time:read"]
    });
  });

  it("keeps integration-token polling to the lightweight fingerprint read", async () => {
    const tokenSession = {
      ...session,
      authMode: "token" as const,
      scopes: ["time:read"]
    };
    mocks.resolveRequestSession.mockResolvedValueOnce(tokenSession);

    const response = await GET(new Request("https://dayframe.test/api/timer-state", {
      headers: { "x-dayframe-ingest-token": "desk-token" }
    }));

    expect(response.status).toBe(200);
    expect(mocks.getTimerState).toHaveBeenCalledWith(tokenSession);
  });
});
