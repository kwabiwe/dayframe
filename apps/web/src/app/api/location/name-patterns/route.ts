import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { pool } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { forgetLearnedNameForEntry, resumeLoggingTrips, stopLoggingTripsLike, stoppedTripPatterns } from "@/lib/location/name-patterns";

/** "Stop suggesting this" (PRD D19, A8): forgets the learned name of the pattern a location block came from. */
export async function DELETE(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const entryId = z.string().uuid().parse(new URL(request.url).searchParams.get("entryId"));
    const forgotten = await forgetLearnedNameForEntry(pool, session, entryId);
    return NextResponse.json({ ok: true, forgotten });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}

const TripPatternActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stop_trips"), eventId: z.string().uuid() }),
  z.object({ action: z.literal("resume_trips"), patternKey: z.string().min(1).max(300) })
]);

/**
 * "Don't log trips like this" (`stop_trips`, from the Move's event of a deleted automatic block) and
 * "Log automatically again" (`resume_trips`, from Places › Trips) — PRD D19, A4.
 */
export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const action = TripPatternActionSchema.parse(await request.json());
    if (action.action === "stop_trips") {
      const stopped = await stopLoggingTripsLike(pool, session, action.eventId);
      if (!stopped) return NextResponse.json({ error: "This trip has no pattern to stop." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    await resumeLoggingTrips(pool, session, action.patternKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    throw error;
  }
}

/** Places › Trips: the trip patterns the person stopped logging automatically. */
export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    return NextResponse.json({ trips: await stoppedTripPatterns(pool, session) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
