import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { deleteTimeEntry, updateTimeEntry } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const body = await request.json();
    const update: Parameters<typeof updateTimeEntry>[1] = {};
    if (Object.prototype.hasOwnProperty.call(body, "projectId")) update.projectId = optionalStringOrNull(body.projectId);
    if (Object.prototype.hasOwnProperty.call(body, "categoryId")) update.categoryId = optionalStringOrNull(body.categoryId);
    if (Object.prototype.hasOwnProperty.call(body, "placeId")) update.placeId = optionalStringOrNull(body.placeId);
    if (Object.prototype.hasOwnProperty.call(body, "description")) update.description = optionalStringOrNull(body.description);
    if (Object.prototype.hasOwnProperty.call(body, "startedAt")) update.startedAt = optionalString(body.startedAt);
    if (Object.prototype.hasOwnProperty.call(body, "stoppedAt")) update.stoppedAt = optionalStringOrNull(body.stoppedAt);
    await updateTimeEntry(id, update, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    await deleteTimeEntry(id, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringOrNull(value: unknown) {
  if (value === null) return null;
  return optionalString(value) ?? null;
}
