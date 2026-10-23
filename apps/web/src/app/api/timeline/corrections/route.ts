import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { correctLocationTimeline, TimelineCorrectionError } from "@/lib/location/location-timeline-corrections";

/**
 * POST /api/timeline/corrections (location v4 step 11): the person corrects one item on their location
 * timeline — a place's place or times, a trip's times, a trip that wasn't one, or a leg's mode. Replay
 * applies it again from then on.
 */
export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const result = await correctLocationTimeline(await request.json(), session);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof TimelineCorrectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    throw error;
  }
}
