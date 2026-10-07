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
  createPlaceFromLearnedPlace: vi.fn(),
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
  createPlaceFromLearnedPlace: mocks.createPlaceFromLearnedPlace,
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
    mocks.createPlaceFromLearnedPlace.mockResolvedValue(placeRow());
    mocks.updatePlace.mockResolvedValue({ ...placeRow(), name: "Gym" });
    mocks.deletePlace.mockResolvedValue({ id: placeId() });
  });

  it("lists places for the active workspace", async () => {
    const response = await GET(new Request("https://dayframe.test/api/places"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.places).toHaveLength(1);
    expect(payload.places[0].defaultActivityDescription).toBe("School drop-off/pickup");
    expect(mocks.getBootstrapData).toHaveBeenCalledWith(session);
  });

  it("creates a category-first current-location place without auto-start", async () => {
    const response = await POST(
      jsonRequest({
        name: "Gym",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        defaultCategoryId: categoryId(),
        defaultActivityDescription: "School drop-off/pickup"
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
        defaultActivityDescription: "School drop-off/pickup",
        autoStart: false
      },
      session,
      undefined
    );
  });

  it("promotes a learned place through the place create endpoint", async () => {
    const response = await POST(
      jsonRequest({
        learnedPlaceId: learnedPlaceId(),
        name: "Office",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 160
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createPlaceFromLearnedPlace).toHaveBeenCalledWith(
      learnedPlaceId(),
      {
        name: "Office",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 160,
        priority: 5,
        autoStart: false
      },
      session,
      undefined
    );
    expect(mocks.createPlace).not.toHaveBeenCalled();
  });

  it("adds a place straight into the Home slot and passes the old Home's new name", async () => {
    const response = await POST(
      jsonRequest({ name: "12 Example Street", latitude: 51.5, longitude: -0.12, role: "home", previousPlaceName: " Previous home " })
    );

    expect(response.status).toBe(201);
    expect(mocks.createPlace).toHaveBeenCalledWith(
      { name: "12 Example Street", latitude: 51.5, longitude: -0.12, radiusMeters: 100, priority: 5, autoStart: false },
      session,
      { role: "home", previousPlaceName: "Previous home" }
    );
  });

  it("rejects roles other than Home and Work", async () => {
    const response = await POST(jsonRequest({ name: "Gym", role: "gym" }));

    expect(response.status).toBe(400);
    expect(mocks.createPlace).not.toHaveBeenCalled();
  });

  it("reports a concurrent role move as a retryable conflict", async () => {
    const { PlaceRoleConflictError } = await import("@/lib/place-role-service");
    mocks.createPlace.mockRejectedValue(new PlaceRoleConflictError(new Error("unique")));

    const response = await POST(jsonRequest({ name: "Office", role: "work" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "place_role_conflict" }));
  });

  it("does not let an ordinary edit change a role", async () => {
    const response = await PATCH(jsonRequest({ id: placeId(), name: "Gym", role: "home" }));

    expect(response.status).toBe(200);
    expect(mocks.updatePlace.mock.calls[0]?.[1]).not.toHaveProperty("role");
  });

  it("edits the mobile-supported place fields", async () => {
    const response = await PATCH(
      jsonRequest({
        id: placeId(),
        name: "Gym",
        radiusMeters: 150,
        defaultCategoryId: null,
        defaultActivityDescription: null
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
        defaultActivityDescription: null,
        autoStart: false
      },
      session
    );
  });

  it("clears default logging fields when place visit logging is turned off", async () => {
    const response = await PATCH(
      jsonRequest({
        id: placeId(),
        name: "Home",
        loggingEnabled: false,
        defaultCategoryId: categoryId(),
        defaultActivityDescription: "Home time"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.updatePlace).toHaveBeenCalledWith(
      placeId(),
      {
        id: placeId(),
        name: "Home",
        loggingEnabled: false,
        defaultCategoryId: null,
        defaultActivityDescription: null,
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
    defaultActivityDescription: "School drop-off/pickup",
    autoStart: false,
    loggingEnabled: true
  };
}

function placeId() {
  return "30000000-0000-4000-8000-000000000001";
}

function learnedPlaceId() {
  return "40000000-0000-4000-8000-000000000001";
}

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}
