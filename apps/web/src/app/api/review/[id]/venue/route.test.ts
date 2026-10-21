import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:write"]
};
const reviewId = "40000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({ resolveRequestSession: vi.fn(), setSuggestedVenue: vi.fn() }));
vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/location/venue-suggestion-service", () => ({ setSuggestedVenue: mocks.setSuggestedVenue }));

const { POST } = await import("./route");
const { AuthError } = await import("@/lib/session");

const post = (id: string, body: unknown) => POST(
  new Request(`https://dayframe.test/api/review/${id}/venue`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }),
  { params: Promise.resolve({ id }) }
);

describe("POST /api/review/[id]/venue (location v3 PR 8)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.setSuggestedVenue.mockResolvedValue({ stored: true });
  });

  it("stores or clears an Apple Place ID for the session's own item", async () => {
    expect((await post(reviewId, { placeId: "ISYNTHETICVENUE1" })).status).toBe(200);
    expect(mocks.setSuggestedVenue).toHaveBeenCalledWith(reviewId, "ISYNTHETICVENUE1", session);
    expect((await post(reviewId, { placeId: null })).status).toBe(200);
    expect(mocks.setSuggestedVenue).toHaveBeenLastCalledWith(reviewId, null, session);
  });

  it("refuses names, coordinates and anything else, and stores nothing", async () => {
    for (const body of [{ placeId: "Freshway Superstore" }, { placeId: "" }, { placeId: "I1", latitude: 50 }, {}]) {
      expect((await post(reviewId, body)).status).toBe(400);
    }
    expect(mocks.setSuggestedVenue).not.toHaveBeenCalled();
  });

  it("is not found for a malformed id or an item that can't take one", async () => {
    expect((await post("not-a-uuid", { placeId: "I1" })).status).toBe(404);
    mocks.setSuggestedVenue.mockResolvedValue(null);
    expect((await post(reviewId, { placeId: "I1" })).status).toBe(404);
  });

  it("needs a session", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    expect((await post(reviewId, { placeId: "I1" })).status).toBe(401);
    expect(mocks.setSuggestedVenue).not.toHaveBeenCalled();
  });
});
