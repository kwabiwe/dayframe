import { describe, expect, it, vi } from "vitest";
import {
  createGeoapifyPlaceSearchProvider,
  getWebPlaceSearchProvider,
  PlaceSearchProviderError,
  WEB_PLACE_SEARCH_MAX_RESULTS
} from "./place-search";

describe("Geoapify web place-search provider", () => {
  it("normalizes and caps provider results without returning the raw payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({
        results: Array.from({ length: 8 }, (_, index) => ({
          place_id: `place-${index}`,
          name: `Synthetic place ${index}`,
          address_line1: `Synthetic place ${index}`,
          address_line2: "Example district, GB",
          formatted: `Synthetic place ${index}, Example district, GB`,
          lat: 51.5 + index / 100,
          lon: -0.1 - index / 100,
          result_type: "amenity",
          datasource: { raw: "must-not-escape" },
          apiKey: "must-not-escape"
        }))
      });
    });
    const provider = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl: fetchMock as typeof fetch
    });

    const suggestions = await provider.suggest({
      query: "Synthetic",
      biasLat: 51.5,
      biasLon: -0.1
    });

    expect(suggestions).toHaveLength(WEB_PLACE_SEARCH_MAX_RESULTS);
    expect(suggestions[0]).toEqual({
      id: "place-0",
      title: "Synthetic place 0",
      subtitle: "Example district, GB",
      formattedAddress: "Synthetic place 0, Example district, GB",
      latitude: 51.5,
      longitude: -0.1,
      resultType: "amenity"
    });
    expect(JSON.stringify(suggestions)).not.toContain("must-not-escape");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("bias=proximity%3A-0.1%2C51.5");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=6");
  });

  it("uses a soft UK bias without restricting explicit remote searches", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({
        results: [{
          place_id: "remote",
          name: "Edinburgh Castle",
          formatted: "Edinburgh Castle, Scotland",
          lat: 55.9486,
          lon: -3.1999
        }]
      });
    });
    const provider = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl: fetchMock as typeof fetch
    });

    const suggestions = await provider.suggest({ query: "Edinburgh Castle" });

    expect(suggestions[0]?.title).toBe("Edinburgh Castle");
    const providerUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(providerUrl).toContain("bias=countrycode%3Agb");
    expect(providerUrl).not.toContain("filter=");
  });

  it("turns malformed responses and upstream failures into stable provider errors", async () => {
    const malformed = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => Response.json({ features: [] })) as typeof fetch
    });
    await expect(malformed.suggest({ query: "School" })).rejects.toMatchObject({
      code: "provider_invalid_response"
    });

    const rejected = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => new Response("raw provider error", { status: 429 })) as typeof fetch
    });
    await expect(rejected.suggest({ query: "School" })).rejects.toEqual(
      new PlaceSearchProviderError("provider_rejected")
    );

    const failed = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl: vi.fn(async () => new Response("raw provider error", { status: 502 })) as typeof fetch
    });
    await expect(failed.suggest({ query: "School" })).rejects.toEqual(
      new PlaceSearchProviderError("provider_failed")
    );
  });

  it("fails closed when the server-only key is missing", () => {
    const previous = process.env.GEOAPIFY_API_KEY;
    delete process.env.GEOAPIFY_API_KEY;
    try {
      expect(() => getWebPlaceSearchProvider()).toThrow(
        new PlaceSearchProviderError("provider_unavailable")
      );
    } finally {
      if (previous === undefined) delete process.env.GEOAPIFY_API_KEY;
      else process.env.GEOAPIFY_API_KEY = previous;
    }
  });

  it("aborts a slow provider request with a stable timeout", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
    const provider = createGeoapifyPlaceSearchProvider({
      apiKey: "server-secret",
      fetchImpl,
      timeoutMs: 5
    });

    await expect(provider.suggest({ query: "Sports centre" })).rejects.toMatchObject({
      code: "provider_timeout"
    });
  });
});
