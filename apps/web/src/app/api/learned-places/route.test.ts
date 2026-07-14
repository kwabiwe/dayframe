import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  deleteLearnedPlace: vi.fn(),
  resolveLearnedPlaceLocation: vi.fn(),
  updateLearnedPlaceStatus: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  deleteLearnedPlace: mocks.deleteLearnedPlace,
  resolveLearnedPlaceLocation: mocks.resolveLearnedPlaceLocation,
  updateLearnedPlaceStatus: mocks.updateLearnedPlaceStatus
}));

const { DELETE, PATCH } = await import("./route");

describe("/api/learned-places", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.deleteLearnedPlace.mockResolvedValue({ id: learnedPlaceId() });
    mocks.resolveLearnedPlaceLocation.mockResolvedValue({
      id: learnedPlaceId(),
      name: "Tesco Springfield",
      address: { name: "Tesco Springfield", formattedAddress: "Springfield Road, Chelmsford, CM2 6QT" },
      poiName: "Tesco Springfield",
      formattedAddress: "Springfield Road, Chelmsford, CM2 6QT",
      geocodedAt: "2026-07-14T10:00:00.000Z"
    });
    mocks.updateLearnedPlaceStatus.mockResolvedValue({ id: learnedPlaceId() });
  });

  it("caches a lazily resolved address for a legacy candidate", async () => {
    const address = {
      name: "Tesco Springfield",
      street: "Springfield Road",
      city: "Chelmsford",
      postalCode: "CM2 6QT",
      formattedAddress: "Springfield Road, Chelmsford, CM2 6QT"
    };
    const response = await PATCH(jsonRequest({
      id: learnedPlaceId(),
      action: "resolve_location",
      address
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.learnedPlace).toMatchObject({
      id: learnedPlaceId(),
      name: "Tesco Springfield"
    });
    expect(mocks.resolveLearnedPlaceLocation).toHaveBeenCalledWith(learnedPlaceId(), address, session);
  });

  it("ignores learned place candidates", async () => {
    const response = await PATCH(jsonRequest({ id: learnedPlaceId(), status: "ignored" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, id: learnedPlaceId(), status: "ignored" });
    expect(mocks.updateLearnedPlaceStatus).toHaveBeenCalledWith(learnedPlaceId(), "ignored", session);
  });

  it("forgets learned place candidates", async () => {
    const response = await DELETE(new Request(`https://dayframe.test/api/learned-places?id=${learnedPlaceId()}`, {
      method: "DELETE"
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, id: learnedPlaceId(), status: "forgotten" });
    expect(mocks.deleteLearnedPlace).toHaveBeenCalledWith(learnedPlaceId(), session);
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
