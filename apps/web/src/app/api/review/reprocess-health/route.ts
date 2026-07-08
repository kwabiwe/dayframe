import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { isLockNotAvailableError, isStatementTimeoutError } from "@/lib/db";
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
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.failedCount > 0 || result.partial ? 207 : 200 }
    );
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isLockNotAvailableError(error) || isStatementTimeoutError(error)) {
      return NextResponse.json(
        {
          ok: false,
          code: "review_reprocess_busy",
          message: "Health review reprocess is already updating review items. Try again in a moment."
        },
        { status: 409 }
      );
    }
    throw error;
  }
}
