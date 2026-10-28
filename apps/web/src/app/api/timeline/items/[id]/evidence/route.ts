import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getTimelineItemEvidence, LocationEvidenceNotFoundError } from "@/lib/location/location-query-service";

const PRIVATE_LOCATION_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie"
};

/**
 * GET /api/timeline/items/{id}/evidence?kind=place|trip&startedAt=ISO (location v4 step 12): the map for a place
 * or trip on the location timeline (`{id}` is the timeline's item id, with its kind and start as the timeline
 * gives them), as a Review item's evidence is, for the correction sheets.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    // The item's kind and start pick it exactly: a client segment id is unique per device only (Codex r1 on #599).
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const startedAt = url.searchParams.get("startedAt");
    if (!id || id.length > 200 || (kind !== "place" && kind !== "trip") || !startedAt || !Number.isFinite(Date.parse(startedAt))) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: PRIVATE_LOCATION_HEADERS });
    }
    const result = await getTimelineItemEvidence(id, session, { kind, startedAt: new Date(startedAt).toISOString() });
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
