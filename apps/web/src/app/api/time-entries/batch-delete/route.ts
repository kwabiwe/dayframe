import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { deleteTimeEntries, TimeEntryNotFoundError } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

const BatchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(2).max(100)
});

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const { ids } = BatchDeleteSchema.parse(await request.json());
    const result = await deleteTimeEntries(ids, session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Choose between 2 and 100 valid entries." }, { status: 400 });
    }
    if (error instanceof TimeEntryNotFoundError) {
      return NextResponse.json({ error: "One or more time entries were not found." }, { status: 404 });
    }
    throw error;
  }
}
