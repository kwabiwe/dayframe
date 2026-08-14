import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  getMapTileProvider,
  isValidMapTileCoordinate,
  MapTileProviderError
} from "@/lib/map-tiles";

export async function GET(
  request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> }
) {
  try {
    await resolveRequestSession(request);
    const params = await context.params;
    const zoom = strictInteger(params.z);
    const x = strictInteger(params.x);
    const y = strictInteger(params.y);
    if (zoom == null || x == null || y == null || !isValidMapTileCoordinate(zoom, x, y)) {
      return privateJson({
        error: {
          code: "invalid_map_tile",
          message: "The requested map tile is invalid."
        }
      }, 400);
    }
    const tile = await getMapTileProvider().fetchTile({ zoom, x, y, signal: request.signal });
    return new NextResponse(tile.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Type": tile.contentType,
        Vary: "Cookie, Authorization"
      }
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return withPrivateNoStore(authResponse);
    if (error instanceof MapTileProviderError) {
      const timeout = error.code === "provider_timeout";
      return privateJson({
        error: {
          code: timeout ? "map_background_timeout" : "map_background_unavailable",
          message: "The map background is unavailable. Location evidence can still be reviewed."
        }
      }, timeout ? 504 : 503);
    }
    throw error;
  }
}

function strictInteger(value: string) {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function privateJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}

function withPrivateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
