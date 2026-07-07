import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getBootstrapData: vi.fn(),
  createPlace: vi.fn(),
  updatePlace: vi.fn(),
  deletePlace: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/queries", () => ({
  getBootstrapData: mocks.getBootstrapData
}));

vi.mock("@/lib/event-service", () => ({
  createPlace: mocks.createPlace,
  updatePlace: mocks.updatePlace,
  deletePlace: mocks.deletePlace
}));

const { DELETE, GET, PATCH, POST } = await import("./route");

describe("/api/places", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getBootstrapData.mockResolvedValue({
      places: [placeRow()]
    });
    mocks.createPlace.mockResolvedValue(placeRow());
    mocks.updatePlace.mockResolvedValue({ ...placeRow(), name: "Gym" });
    mocks.deletePlace.mockResolvedValue({ id: placeId() });
  });

  it("lists places for the active workspace", async () => {
    const response = await GET(new Request("https://dayframe.test/api/places"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.places).toHaveLength(1);
    expect(mocks.getBootstrapData).toHaveBeenCalledWith(session);
  });

  it("creates a category-first current-location place without auto-start", async () => {
    const response = await POST(
      jsonRequest({
        name: "Gym",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        defaultCategoryId: categoryId()
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createPlace).toHaveBeenCalledWith(
      {
        name: "Gym",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        priority: 5,
        defaultCategoryId: categoryId(),
        autoStart: false
      },
      session
    );
  });

  it("edits the mobile-supported place fields", async () => {
    const response = await PATCH(
      jsonRequest({
        id: placeId(),
        name: "Gym",
        radiusMeters: 150,
        defaultCategoryId: null
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.updatePlace).toHaveBeenCalledWith(
      placeId(),
      {
        id: placeId(),
        name: "Gym",
        radiusMeters: 150,
        defaultCategoryId: null,
        autoStart: false
      },
      session
    );
  });

  it("deletes a place by id", async () => {
    const response = await DELETE(new Request(`https://dayframe.test/api/places?id=${placeId()}`, { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mocks.deletePlace).toHaveBeenCalledWith(placeId(), session);
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function placeRow() {
  return {
    id: placeId(),
    name: "Office",
    latitude: 51.5,
    longitude: -0.12,
    radiusMeters: 100,
    priority: 5,
    defaultProjectId: null,
    defaultProjectName: null,
    defaultCategoryId: categoryId(),
    defaultCategoryName: "Health",
    autoStart: false
  };
}

function placeId() {
  return "30000000-0000-4000-8000-000000000001";
}

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}
