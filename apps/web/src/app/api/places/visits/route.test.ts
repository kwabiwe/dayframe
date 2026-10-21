import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read"]
};

const mocks = vi.hoisted(() => ({ resolveRequestSession: vi.fn(), getPlaceVisitStats: vi.fn() }));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/queries", () => ({ getPlaceVisitStats: mocks.getPlaceVisitStats }));

const { GET } = await import("./route");
const { AuthError } = await import("@/lib/session");

describe("GET /api/places/visits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
  });

  it("returns times and counts for the session's own places", async () => {
    const visits = [{ placeId: "30000000-0000-4000-8000-000000000001", lastVisitAt: "2026-10-20T10:00:00.000Z", visitsLast30Days: 3 }];
    mocks.getPlaceVisitStats.mockResolvedValue(visits);
    const response = await GET(new Request("https://dayframe.test/api/places/visits"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ visits });
    expect(mocks.getPlaceVisitStats).toHaveBeenCalledWith(session);
  });

  it("refuses without a session and reads nothing", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    const response = await GET(new Request("https://dayframe.test/api/places/visits"));
    expect(response.status).toBe(401);
    expect(mocks.getPlaceVisitStats).not.toHaveBeenCalled();
  });
});
