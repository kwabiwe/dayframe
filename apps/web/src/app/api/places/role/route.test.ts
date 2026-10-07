import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};
const placeId = "30000000-0000-4000-8000-000000000001";
const previousPlaceId = "30000000-0000-4000-8000-000000000002";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  assignPlaceRole: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/place-role-service", async () => {
  class PlaceRoleConflictError extends Error {
    readonly code = "place_role_conflict";
  }
  return { assignPlaceRole: mocks.assignPlaceRole, PlaceRoleConflictError };
});

const { PUT } = await import("./route");
const { PlaceRoleConflictError } = await import("@/lib/place-role-service");

function request(body: unknown) {
  return new Request("https://dayframe.test/api/places/role", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("PUT /api/places/role", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.assignPlaceRole.mockResolvedValue({ status: "assigned", placeId, previousPlaceId });
  });

  it("moves Home to a saved place and renames the old Home", async () => {
    const response = await PUT(request({ role: "home", placeId, previousPlaceName: " Previous home " }));

    expect(response.status).toBe(200);
    expect(mocks.assignPlaceRole).toHaveBeenCalledWith(session, { role: "home", placeId, previousPlaceName: "Previous home" });
    await expect(response.json()).resolves.toEqual({ ok: true, role: "home", placeId, previousPlaceId });
  });

  it("empties a slot", async () => {
    mocks.assignPlaceRole.mockResolvedValue({ status: "assigned", placeId: null, previousPlaceId });
    const response = await PUT(request({ role: "work", placeId: null }));

    expect(response.status).toBe(200);
    expect(mocks.assignPlaceRole).toHaveBeenCalledWith(session, { role: "work", placeId: null });
  });

  it("rejects unknown roles, missing places and blank or long previous names", async () => {
    for (const body of [
      { role: "gym", placeId },
      { role: "home" },
      { role: "home", placeId, previousPlaceName: "   " },
      { role: "home", placeId, previousPlaceName: "x".repeat(121) }
    ]) {
      expect((await PUT(request(body))).status).toBe(400);
    }
    expect(mocks.assignPlaceRole).not.toHaveBeenCalled();
  });

  it("returns 404 for a place outside the workspace", async () => {
    mocks.assignPlaceRole.mockResolvedValue({ status: "place_not_found" });
    expect((await PUT(request({ role: "home", placeId }))).status).toBe(404);
  });

  it("returns a retryable 409 when another move raced it", async () => {
    mocks.assignPlaceRole.mockRejectedValue(new PlaceRoleConflictError(new Error("unique")));
    const response = await PUT(request({ role: "home", placeId }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "place_role_conflict" }));
  });

  it("requires a session before touching places", async () => {
    const { AuthError } = await import("@/lib/session");
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));

    expect((await PUT(request({ role: "home", placeId }))).status).toBe(401);
    expect(mocks.assignPlaceRole).not.toHaveBeenCalled();
  });
});
