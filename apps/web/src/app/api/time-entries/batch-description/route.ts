import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import {
  TimeEntryNotFoundError,
  TimeEntryValidationError,
  updateTimeEntryDescriptions
} from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

const BatchDescriptionSchema = z.object({
  ids: z.array(z.string().uuid()).min(2),
  description: z.string().nullable()
});

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = BatchDescriptionSchema.parse(await request.json());
    const description = body.description?.trim() || null;
    const result = await updateTimeEntryDescriptions(body.ids, description, session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError || error instanceof TimeEntryValidationError) {
      return NextResponse.json({ error: error instanceof ZodError ? "Choose at least two valid grouped entries." : error.message }, { status: 400 });
    }
    if (error instanceof TimeEntryNotFoundError) {
      return NextResponse.json({ error: "One or more time entries were not found." }, { status: 404 });
    }
    throw error;
  }
}
