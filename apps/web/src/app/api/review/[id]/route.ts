import { NextResponse } from "next/server";
import { resolveReviewItem, ReviewResolutionError } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = isRecord(body) ? body.action : undefined;
    const result = await resolveReviewItem(id, action, session);
    return NextResponse.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ReviewResolutionError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: error.message,
          ...(error.details ? error.details : {})
        },
        { status: error.status }
      );
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
