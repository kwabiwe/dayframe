import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { pool } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { forgetLearnedNameForEntry } from "@/lib/location/name-patterns";

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
