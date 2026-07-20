import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getBootstrapData: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/queries", () => ({
  getBootstrapData: mocks.getBootstrapData
}));

const { GET } = await import("./route");

describe("/api/bootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getBootstrapData.mockResolvedValue({
      tags: [
        { id: "50000000-0000-4000-8000-000000000001", name: "Planning", normalizedName: "planning", usageCount: 1 }
      ],
      activeEntry: {
        id: "80000000-0000-4000-8000-000000000001",
        tagNames: ["Planning"],
        tags: [{ id: "50000000-0000-4000-8000-000000000001", name: "Planning", normalizedName: "planning" }]
      },
      places: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Kids' school",
          latitude: 51.5,
          longitude: -0.12,
          radiusMeters: 100,
          priority: 5,
          defaultProjectId: null,
          defaultProjectName: null,
          defaultCategoryId: "20000000-0000-4000-8000-000000000001",
          defaultCategoryName: "Family",
          defaultActivityDescription: "School drop-off/pickup",
          autoStart: false
        }
      ]
    });
  });

  it("includes place default activity descriptions in bootstrap places", async () => {
    const response = await GET(new Request("https://dayframe.test/api/bootstrap"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.places[0].defaultActivityDescription).toBe("School drop-off/pickup");
    expect(payload.locationRolloutMode).toBe("v2_shadow");
    expect(mocks.getBootstrapData).toHaveBeenCalledWith(session, { selectedDate: null });
  });

  it("serializes normalized tag records and active-entry associations without replacing legacy tagNames", async () => {
    const response = await GET(new Request("https://dayframe.test/api/bootstrap"));
    const payload = await response.json();

    expect(payload.tags[0]).toEqual(expect.objectContaining({
      name: "Planning",
      normalizedName: "planning",
      usageCount: 1
    }));
    expect(payload.activeEntry.tags[0].normalizedName).toBe("planning");
    expect(payload.activeEntry.tagNames).toEqual(["Planning"]);
  });
});
