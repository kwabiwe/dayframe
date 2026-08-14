import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";
import { MapTileProviderError } from "@/lib/map-tiles";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getMapTileProvider: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/map-tiles", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/map-tiles")>();
  return { ...original, getMapTileProvider: mocks.getMapTileProvider };
});

const { GET } = await import("./route");

describe("/api/map-style", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    mocks.getMapTileProvider.mockReturnValue({ fetchTile: vi.fn() });
  });

  it("returns an authenticated same-origin style without exposing the server key", async () => {
    const response = await GET(new Request("https://dayframe.test/api/map-style"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toContain("https://dayframe.test/api/map-tiles/{z}/{x}/{y}");
    expect(body).toContain("Geoapify");
    expect(body).not.toContain("server-secret");
  });

  it("fails closed when unauthenticated", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    const response = await GET(new Request("https://dayframe.test/api/map-style"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getMapTileProvider).not.toHaveBeenCalled();
  });

  it("returns a friendly unavailable state when the server provider is missing", async () => {
    mocks.getMapTileProvider.mockImplementation(() => {
      throw new MapTileProviderError("provider_unavailable");
    });
    const response = await GET(new Request("https://dayframe.test/api/map-style"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("map_background_unavailable");
    expect(body).not.toContain("GEOAPIFY_API_KEY");
  });
});
