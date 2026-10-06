import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  addMissingStarterActivities: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/starter-activities-service", () => ({ addMissingStarterActivities: mocks.addMissingStarterActivities }));

const { POST } = await import("./route");

describe("/api/categories/starters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.addMissingStarterActivities.mockResolvedValue({
      added: [{ id: "cat-errands", name: "Errands", starterKey: "errands" }],
      linked: [{ id: "cat-sleep", starterKey: "sleep" }]
    });
  });

  it("adds the missing starter activities to the signed-in workspace", async () => {
    const response = await POST(new Request("https://dayframe.test/api/categories/starters", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      added: [{ id: "cat-errands", name: "Errands", starterKey: "errands" }],
      linked: [{ id: "cat-sleep", starterKey: "sleep" }]
    });
    expect(mocks.addMissingStarterActivities).toHaveBeenCalledWith(session);
  });

  it("requires a session", async () => {
    const { AuthError } = await import("@/lib/session");
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));

    const response = await POST(new Request("https://dayframe.test/api/categories/starters", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.addMissingStarterActivities).not.toHaveBeenCalled();
  });
});
