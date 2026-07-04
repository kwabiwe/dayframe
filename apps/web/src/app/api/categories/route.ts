import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { reorderCategories } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function PATCH(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json();
    const categoryIds = Array.isArray(body.categoryIds)
      ? body.categoryIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];

    await reorderCategories(categoryIds, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
