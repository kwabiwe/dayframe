import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getPlaceVisitStats } from "@/lib/queries";

// Places last visit and sections (location v3 PR 16c): the person's last visit and visits in the
// last 30 days for each active saved place, read from their current stays. Times and counts only.
export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    return NextResponse.json({ visits: await getPlaceVisitStats(session) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
