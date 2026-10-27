import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getTimelineItemEvidence, LocationEvidenceNotFoundError } from "@/lib/location/location-query-service";

const PRIVATE_LOCATION_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie"
};

/**
 * GET /api/timeline/items/{id}/evidence (location v4 step 12): the map for a place or trip on the location
 * timeline (`{id}` is the timeline's item id), as a Review item's evidence is, for the correction sheets.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    if (!id || id.length > 200) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_LOCATION_HEADERS });
    }
    const result = await getTimelineItemEvidence(id, session);
    return NextResponse.json(result, { headers: PRIVATE_LOCATION_HEADERS });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) authResponse.headers.set(key, value);
      return authResponse;
    }
    if (error instanceof LocationEvidenceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_LOCATION_HEADERS });
    }
    throw error;
  }
}
