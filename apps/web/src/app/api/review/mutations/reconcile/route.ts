import { NextResponse } from "next/server";
import { ReviewReconciliationRequestSchema } from "@dayframe/shared";
import { authErrorResponse, databaseReadinessResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { reconcileReviewMutations } from "@/lib/review-mutation-service";

export const maxDuration = 15;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const session = await resolveRequestSession(request);
    const input = ReviewReconciliationRequestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ ok: false, code: "invalid_reconciliation_request" }, { status: 400 });
    return NextResponse.json(await reconcileReviewMutations(input.data, session, {
      signal: request.signal, deadlineAt: startedAt + 8_000
    }));
  } catch (error) {
    const readiness = databaseReadinessResponse(error);
    if (readiness) return readiness;
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
