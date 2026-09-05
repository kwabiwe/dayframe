import { NextResponse } from "next/server";
import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";
import { authErrorResponse, databaseReadinessResponse } from "@/lib/api-errors";
import { isLockNotAvailableError, isStatementTimeoutError } from "@/lib/db";
import { reprocessHealthReviewItems } from "@/lib/event-service";
import { resolveRequestSession } from "@/lib/ingest-auth";

export const maxDuration = 15;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json().catch(() => ({}));
    const result = await reprocessHealthReviewItems(
      typeof body === "object" && body !== null ? body : {},
      session,
      { signal: request.signal, deadlineAt: startedAt + 6_000 }
    );
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.failedCount > 0 || result.partial ? 207 : 200 }
    );
  } catch (error) {
    const readiness = databaseReadinessResponse(error);
    if (readiness) return readiness;
    const response = authErrorResponse(error);
    if (response) return response;
    if (isStatementTimeoutError(error) || error instanceof SyncOperationError) {
      return NextResponse.json({ ok: false, code: "health_reprocess_timeout",
        ...syncFailureMetadata(error), retryAfterMs: 5_000,
        message: "Health processing could not finish in this request." }, { status: 503 });
    }
    if (isLockNotAvailableError(error)) {
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
