import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { updateLearnedPlaceStatus } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

const learnedPlaceUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("ignored")
});

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = learnedPlaceUpdateSchema.parse(await request.json());
    const learnedPlace = await updateLearnedPlaceStatus(body.id, body.status, session);
    if (!learnedPlace) return NextResponse.json({ error: "Learned place not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id: learnedPlace.id, status: body.status });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) return NextResponse.json({ issues: error.issues }, { status: 400 });
    throw error;
  }
}
