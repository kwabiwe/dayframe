export const MAP_TILE_MAX_ZOOM = 20;
export const MAP_TILE_TIMEOUT_MS = 4_500;
export const MAP_TILE_MAX_BYTES = 3_000_000;

const GEOAPIFY_MAP_STYLE = "osm-bright-grey";
const MAP_ATTRIBUTION = [
  'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>',
  '<a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>',
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>'
].join(" | ");

export type DayframeMapTile = {
  body: ArrayBuffer;
  contentType: string;
};

export type MapTileProvider = {
  fetchTile(input: {
    zoom: number;
    x: number;
    y: number;
    signal?: AbortSignal;
  }): Promise<DayframeMapTile>;
};

export type MapTileProviderErrorCode =
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rejected"
  | "provider_failed"
  | "provider_invalid_response";

export class MapTileProviderError extends Error {
  readonly code: MapTileProviderErrorCode;

  constructor(code: MapTileProviderErrorCode) {
    super(code);
    this.name = "MapTileProviderError";
    this.code = code;
  }
}

export function getMapTileProvider(): MapTileProvider {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) throw new MapTileProviderError("provider_unavailable");
  return createGeoapifyMapTileProvider({ apiKey });
}

export function createGeoapifyMapTileProvider({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = MAP_TILE_TIMEOUT_MS
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): MapTileProvider {
  return {
    async fetchTile({ zoom, x, y, signal }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
      const abortFromCaller = () => controller.abort("cancelled");
      signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        const url = new URL(
          `https://maps.geoapify.com/v1/tile/${GEOAPIFY_MAP_STYLE}/${zoom}/${x}/${y}@2x.png`
        );
        url.searchParams.set("apiKey", apiKey);
        const response = await fetchImpl(url, {
          headers: { Accept: "image/png" },
          signal: controller.signal
        });
        if (response.status >= 400 && response.status < 500) {
          throw new MapTileProviderError("provider_rejected");
        }
        if (!response.ok) throw new MapTileProviderError("provider_failed");
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (!contentType?.startsWith("image/")) {
          throw new MapTileProviderError("provider_invalid_response");
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAP_TILE_MAX_BYTES) {
          throw new MapTileProviderError("provider_invalid_response");
        }
        const body = await response.arrayBuffer();
        if (!body.byteLength || body.byteLength > MAP_TILE_MAX_BYTES) {
          throw new MapTileProviderError("provider_invalid_response");
        }
        return { body, contentType };
      } catch (error) {
        if (error instanceof MapTileProviderError) throw error;
        if (controller.signal.aborted && !signal?.aborted) {
          throw new MapTileProviderError("provider_timeout");
        }
        if (signal?.aborted) throw error;
        throw new MapTileProviderError("provider_failed");
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    }
  };
}

export function dayframeMapStyle(origin: string) {
  const tileUrl = `${origin.replace(/\/$/, "")}/api/map-tiles/{z}/{x}/{y}`;
  return {
    version: 8 as const,
    sources: {
      "dayframe-base-map": {
        type: "raster" as const,
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: MAP_TILE_MAX_ZOOM,
        attribution: MAP_ATTRIBUTION
      }
    },
    layers: [{
      id: "dayframe-base-map",
      type: "raster" as const,
      source: "dayframe-base-map"
    }]
  };
}

export function isValidMapTileCoordinate(zoom: number, x: number, y: number) {
  if (![zoom, x, y].every(Number.isInteger)) return false;
  if (zoom < 0 || zoom > MAP_TILE_MAX_ZOOM) return false;
  const maximumCoordinate = 2 ** zoom;
  return x >= 0 && x < maximumCoordinate && y >= 0 && y < maximumCoordinate;
}
