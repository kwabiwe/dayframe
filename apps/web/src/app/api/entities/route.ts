import { NextResponse } from "next/server";
import { CategoryConflictError, createEntity, UnsupportedEntityError } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json();
    await createEntity(String(body.entity), body.values ?? {}, session);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof CategoryConflictError) {
      return NextResponse.json({ ok: false, code: "name_taken", error: error.message }, { status: error.status });
    }
    if (error instanceof UnsupportedEntityError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
