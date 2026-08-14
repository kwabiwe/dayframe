import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  dayframeMapStyle,
  getMapTileProvider,
  MapTileProviderError
} from "@/lib/map-tiles";

export async function GET(request: Request) {
  try {
    await resolveRequestSession(request);
    getMapTileProvider();
    return privateJson(dayframeMapStyle(new URL(request.url).origin));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return withPrivateNoStore(authResponse);
    if (error instanceof MapTileProviderError) {
      return privateJson({
        error: {
          code: "map_background_unavailable",
          message: "The map background is unavailable. Location evidence can still be reviewed."
        }
      }, 503);
    }
    throw error;
  }
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
