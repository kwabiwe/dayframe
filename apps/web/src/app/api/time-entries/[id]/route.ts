import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { deleteTimeEntry, TimeEntryNotFoundError, updateTimeEntry } from "@/lib/event-service";
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
    if (Object.prototype.hasOwnProperty.call(body, "startedAt")) update.startedAt = requiredString(body.startedAt, "startedAt");
    if (Object.prototype.hasOwnProperty.call(body, "stoppedAt")) update.stoppedAt = optionalStringOrNull(body.stoppedAt);
    validateTimeWindow(update);
    await updateTimeEntry(id, update, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ZodError || error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const result = await deleteTimeEntry(id, session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof TimeEntryNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string) {
  const next = optionalString(value);
  if (!next) throw new BadRequestError(`${field} is required.`);
  return next;
}

function optionalStringOrNull(value: unknown) {
  if (value === null) return null;
  return optionalString(value) ?? null;
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function validateTimeWindow(update: Parameters<typeof updateTimeEntry>[1]) {
  if (!update.startedAt) return;

  const startedAt = new Date(update.startedAt);
  if (Number.isNaN(startedAt.getTime())) {
    throw new BadRequestError("startedAt must be a valid date.");
  }

  const now = new Date();
  if (startedAt.getTime() > now.getTime()) {
    throw new BadRequestError("Start time cannot be in the future.");
  }

  if (update.stoppedAt) {
    const stoppedAt = new Date(update.stoppedAt);
    if (Number.isNaN(stoppedAt.getTime())) {
      throw new BadRequestError("stoppedAt must be a valid date.");
    }
    if (startedAt.getTime() >= stoppedAt.getTime()) {
      throw new BadRequestError("Start time must be before the finish time.");
    }
  }
}
