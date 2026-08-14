import { describe, expect, it, vi } from "vitest";
import {
  createGeoapifyMapTileProvider,
  dayframeMapStyle,
  isValidMapTileCoordinate,
  MAP_TILE_MAX_BYTES,
  MapTileProviderError
} from "./map-tiles";

describe("map tiles", () => {
  it("builds a same-origin raster style with complete attribution and no provider key", () => {
    const style = dayframeMapStyle();
    const source = style.sources["dayframe-base-map"];

    expect(source.tiles).toEqual(["/api/map-tiles/{z}/{x}/{y}"]);
    expect(source.attribution).toContain("Geoapify");
    expect(source.attribution).toContain("OpenMapTiles");
    expect(source.attribution).toContain("OpenStreetMap contributors");
    expect(JSON.stringify(style)).not.toContain("server-secret");
  });

  it("accepts only integer XYZ coordinates within the configured zoom", () => {
    expect(isValidMapTileCoordinate(0, 0, 0)).toBe(true);
    expect(isValidMapTileCoordinate(20, 2 ** 20 - 1, 2 ** 20 - 1)).toBe(true);
    expect(isValidMapTileCoordinate(2, 4, 0)).toBe(false);
    expect(isValidMapTileCoordinate(2, 0, 4)).toBe(false);
    expect(isValidMapTileCoordinate(21, 0, 0)).toBe(false);
    expect(isValidMapTileCoordinate(2.5, 1, 1)).toBe(false);
  });

  it("keeps the provider key in the server request and returns only a validated image", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "image/png", "Content-Length": "3" }
    }));
    const provider = createGeoapifyMapTileProvider({ apiKey: "server-secret", fetchImpl });

    const tile = await provider.fetchTile({ zoom: 12, x: 2048, y: 1362 });

    expect(tile.contentType).toBe("image/png");
    expect(tile.body.byteLength).toBe(3);
    const requestedUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("maps.geoapify.com");
    expect(requestedUrl).toContain("apiKey=server-secret");
  });

  it("rejects non-image provider responses", async () => {
    const provider = createGeoapifyMapTileProvider({
      apiKey: "server-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      }))
    });

    await expect(provider.fetchTile({ zoom: 1, x: 0, y: 0 })).rejects.toEqual(
      new MapTileProviderError("provider_invalid_response")
    );
  });

  it("cancels a chunked provider response as soon as it exceeds the byte limit", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAP_TILE_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel
    }), {
      status: 200,
      headers: { "Content-Type": "image/png" }
    });
    const provider = createGeoapifyMapTileProvider({
      apiKey: "server-secret",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response)
    });

    await expect(provider.fetchTile({ zoom: 1, x: 0, y: 0 })).rejects.toEqual(
      new MapTileProviderError("provider_invalid_response")
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
