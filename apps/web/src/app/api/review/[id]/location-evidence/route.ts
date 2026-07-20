import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  getLocationReviewEvidence,
  LocationEvidenceNotFoundError
} from "@/lib/location/location-query-service";

const PRIVATE_LOCATION_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie"
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const result = await getLocationReviewEvidence(id, session);
    return NextResponse.json(result, {
      headers: PRIVATE_LOCATION_HEADERS
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) authResponse.headers.set(key, value);
      return authResponse;
    }
    if (error instanceof LocationEvidenceNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: PRIVATE_LOCATION_HEADERS }
      );
    }
    throw error;
  }
}
