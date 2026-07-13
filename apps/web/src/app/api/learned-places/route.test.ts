import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  updateLearnedPlaceStatus: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  updateLearnedPlaceStatus: mocks.updateLearnedPlaceStatus
}));

const { PATCH } = await import("./route");

describe("/api/learned-places", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.updateLearnedPlaceStatus.mockResolvedValue({ id: learnedPlaceId() });
  });

  it("ignores learned place candidates", async () => {
    const response = await PATCH(jsonRequest({ id: learnedPlaceId(), status: "ignored" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, id: learnedPlaceId(), status: "ignored" });
    expect(mocks.updateLearnedPlaceStatus).toHaveBeenCalledWith(learnedPlaceId(), "ignored", session);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/learned-places", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function learnedPlaceId() {
  return "40000000-0000-4000-8000-000000000001";
}
