import { TagMutationSchema } from "@dayframe/shared";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  deleteTag,
  renameTag,
  TagConflictError,
  TagNotFoundError
} from "@/lib/tag-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const input = TagMutationSchema.parse(await request.json());
    return NextResponse.json({ ok: true, tag: await renameTag(id, input, session) });
  } catch (error) {
    return tagErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    return NextResponse.json({ ok: true, ...(await deleteTag(id, session)) });
  } catch (error) {
    return tagErrorResponse(error);
  }
}

function tagErrorResponse(error: unknown) {
  const response = authErrorResponse(error);
  if (response) return response;
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid tag." }, { status: 400 });
  }
  if (error instanceof TagNotFoundError || error instanceof TagConflictError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
