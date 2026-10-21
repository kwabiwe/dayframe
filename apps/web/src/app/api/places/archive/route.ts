import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { MissingRequiredColumnError } from "@/lib/db";
import { PlaceArchiveBusyError, setPlaceArchived } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getArchivedPlaces } from "@/lib/queries";

// Archive place (location v3 PR 15, PRD D19 A10). GET lists archived places for Places' Archived
// section; POST archives (true) or restores (false) one place.
const archiveSchema = z.object({ id: z.string().uuid(), archived: z.boolean() });

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    return NextResponse.json({ places: await getArchivedPlaces(session) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = archiveSchema.parse(await request.json());
    const place = await setPlaceArchived(body.id, body.archived, session);
    if (!place) return NextResponse.json({ error: "Place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, place });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const response = authErrorResponse(error);
  if (response) return response;
  if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
  if (error instanceof MissingRequiredColumnError) return NextResponse.json({ error: error.message }, { status: 500 });
  if (error instanceof PlaceArchiveBusyError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  throw error;
}
