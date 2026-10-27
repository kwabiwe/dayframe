import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { isLockNotAvailableError, isStatementTimeoutError } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { SyncOperationError } from "@/lib/sync-transaction";
import { correctLocationTimeline, TimelineCorrectionError } from "@/lib/location/location-timeline-corrections";

/**
 * POST /api/timeline/corrections (location v4 step 11): the person corrects one item on their location
 * timeline — a place's place or times, a trip's times, a trip that wasn't one, or a leg's mode. Replay
 * applies it again from then on. A `clientCorrectionId` makes a retry safe: the same id gets the same
 * correction back. 503 when busy, so the app retries.
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
    // Busy (the owner lock, a timeout). The outcome may be unknown (a commit whose reply was lost), so the
    // app sends the same request again with the same clientCorrectionId, which answers it either way (step 12).
    if (isLockNotAvailableError(error) || isStatementTimeoutError(error) || error instanceof SyncOperationError) {
      return NextResponse.json({ error: "Dayframe is busy. Try again in a moment.", code: "timeline_busy", retryAfterMs: 5_000 },
        { status: 503, headers: { "Retry-After": "5" } });
    }
    throw error;
  }
}
