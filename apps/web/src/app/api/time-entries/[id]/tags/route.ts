import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  attachTagToTimeEntry,
  detachTagFromTimeEntry,
  TagNotFoundError
} from "@/lib/tag-service";

const AssociationSchema = z.object({ tagId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const { tagId } = AssociationSchema.parse(await request.json());
    return NextResponse.json({ ok: true, ...(await attachTagToTimeEntry(id, tagId, session)) }, { status: 201 });
  } catch (error) {
    return associationErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const { tagId } = AssociationSchema.parse(await request.json());
    return NextResponse.json({ ok: true, ...(await detachTagFromTimeEntry(id, tagId, session)) });
  } catch (error) {
    return associationErrorResponse(error);
  }
}

function associationErrorResponse(error: unknown) {
  const response = authErrorResponse(error);
  if (response) return response;
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "tagId must be a valid UUID." }, { status: 400 });
  }
  if (error instanceof TagNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
