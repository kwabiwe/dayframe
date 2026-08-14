import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";
import { MapTileProviderError } from "@/lib/map-tiles";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  fetchTile: vi.fn(),
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

describe("/api/map-tiles/:z/:x/:y", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
    mocks.getMapTileProvider.mockReturnValue({ fetchTile: mocks.fetchTile });
    mocks.fetchTile.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]).buffer,
      contentType: "image/png"
    });
  });

  it("returns a private browser-cacheable tile after authentication", async () => {
    const response = await GET(request("/api/map-tiles/12/2048/1362"), context("12", "2048", "1362"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(mocks.fetchTile).toHaveBeenCalledWith({
      zoom: 12,
      x: 2048,
      y: 1362,
      signal: expect.any(AbortSignal)
    });
  });

  it.each([
    ["non-integer", "x", "0", "0"],
    ["zoom above maximum", "21", "0", "0"],
    ["x outside zoom", "2", "4", "0"],
    ["y outside zoom", "2", "0", "4"]
  ])("rejects %s coordinates before the provider call", async (_label, z, x, y) => {
    const response = await GET(request(`/api/map-tiles/${z}/${x}/${y}`), context(z, x, y));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.fetchTile).not.toHaveBeenCalled();
  });

  it("fails closed when unauthenticated", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    const response = await GET(request("/api/map-tiles/1/0/0"), context("1", "0", "0"));

    expect(response.status).toBe(401);
    expect(mocks.fetchTile).not.toHaveBeenCalled();
  });

  it("does not expose provider details on timeout", async () => {
    mocks.fetchTile.mockRejectedValue(new MapTileProviderError("provider_timeout"));
    const response = await GET(request("/api/map-tiles/1/0/0"), context("1", "0", "0"));
    const body = await response.text();

    expect(response.status).toBe(504);
    expect(body).toContain("map_background_timeout");
    expect(body).not.toContain("Geoapify");
  });
});

function request(path: string) {
  return new Request(`https://dayframe.test${path}`);
}

function context(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}
