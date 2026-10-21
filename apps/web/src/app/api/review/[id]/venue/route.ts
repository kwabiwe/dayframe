import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { ApplePlaceIdSchema } from "@dayframe/shared";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { setSuggestedVenue } from "@/lib/location/venue-suggestion-service";

// The iPhone's venue suggestion for an open Review card's unsaved stay (location v3 PR 8): an
// Apple Place ID, or null to clear it. Sent only while the stay is on screen, once per stay.
const bodySchema = z.object({ placeId: ApplePlaceIdSchema.nullable() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "Review item not found." }, { status: 404 });
    }
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await setSuggestedVenue(id, body.placeId, session);
    if (!result) return NextResponse.json({ error: "Review item not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}
