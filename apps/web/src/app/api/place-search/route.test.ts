import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";
import { PlaceSearchProviderError } from "@/lib/place-search";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  suggest: vi.fn(),
  getWebPlaceSearchProvider: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/place-search", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/place-search")>();
  return {
    ...original,
    getWebPlaceSearchProvider: mocks.getWebPlaceSearchProvider
  };
});

const { GET } = await import("./route");

describe("/api/place-search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getWebPlaceSearchProvider.mockReturnValue({ suggest: mocks.suggest });
    mocks.suggest.mockResolvedValue([{
      id: "synthetic-place",
      title: "Synthetic Sports Centre",
      subtitle: "Example Road, Chelmsford",
      formattedAddress: "Synthetic Sports Centre, Example Road, Chelmsford",
      latitude: 51.73,
      longitude: 0.47,
      resultType: "amenity"
    }]);
  });

  it("rejects unauthenticated searches without exposing session details", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Unauthorized", 401));
    const response = await GET(request("?q=School"));
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).not.toContain(session.userId);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it.each([
    ["missing query", ""],
    ["one-character query", "?q=A"],
    ["overlong query", `?q=${"a".repeat(161)}`],
    ["invalid latitude", "?q=School&biasLat=91&biasLon=0"],
    ["invalid longitude", "?q=School&biasLat=51&biasLon=181"],
    ["partial coordinate bias", "?q=School&biasLat=51"]
  ])("rejects %s", async (_label, search) => {
    const response = await GET(request(search));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it("returns normalized private suggestions with the requested bias", async () => {
    const response = await GET(request("?q=%20School%20&biasLat=51.7&biasLon=0.4&language=en"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.suggestions).toHaveLength(1);
    expect(mocks.suggest).toHaveBeenCalledWith({
      query: "School",
      biasLat: 51.7,
      biasLon: 0.4,
      language: "en",
      signal: expect.any(AbortSignal)
    });
    expect(JSON.stringify(payload)).not.toContain("server-secret");
  });

  it.each([
    ["provider missing", "provider_unavailable", 503, "place_search_unavailable"],
    ["provider 4xx", "provider_rejected", 503, "place_search_unavailable"],
    ["provider 5xx", "provider_failed", 503, "place_search_unavailable"],
    ["malformed payload", "provider_invalid_response", 503, "place_search_unavailable"],
    ["timeout", "provider_timeout", 504, "place_search_timeout"]
  ] as const)("handles %s safely", async (_label, code, status, publicCode) => {
    mocks.suggest.mockRejectedValue(new PlaceSearchProviderError(code));
    const response = await GET(request("?q=School"));
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toContain(publicCode);
    expect(body).not.toContain(code);
    expect(body).not.toContain("api.geoapify.com");
  });

  it("handles a provider factory failure without exposing configuration", async () => {
    mocks.getWebPlaceSearchProvider.mockImplementation(() => {
      throw new PlaceSearchProviderError("provider_unavailable");
    });
    const response = await GET(request("?q=School"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain("place_search_unavailable");
    expect(body).not.toContain("GEOAPIFY_API_KEY");
  });
});

function request(search: string) {
  return new Request(`https://dayframe.test/api/place-search${search}`);
}
