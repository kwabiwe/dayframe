import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { archiveCategory, updateCategory } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const body = await request.json();
    await updateCategory(id, body, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(_request);
    const { id } = await context.params;
    await archiveCategory(id, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
