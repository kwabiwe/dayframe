import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { reprocessHealthReviewItems } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json().catch(() => ({}));
    const result = await reprocessHealthReviewItems(
      typeof body === "object" && body !== null ? body : {},
      session
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
