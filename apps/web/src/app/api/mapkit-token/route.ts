import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { mapKitConfig, signMapKitToken } from "@/lib/mapkit-token";

/**
 * A MapKit JS token for the signed-in viewer's page (UI review, owner 29 Oct 2026). It is locked to the request's
 * own origin, so a token copied elsewhere does not work, and is never cached. 404 means MapKit JS isn't
 * configured here: the web keeps its current map.
 */
export async function GET(request: Request) {
  try {
    await resolveRequestSession(request);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      authResponse.headers.set("Cache-Control", "private, no-store");
      return authResponse;
    }
    throw error;
  }
  const config = mapKitConfig();
  if (!config) return privateJson({ available: false }, 404);
  const { token, expiresAt } = signMapKitToken(config, new URL(request.url).origin);
  return privateJson({ available: true, token, expiresAt });
}

function privateJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
