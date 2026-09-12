import { NextResponse } from "next/server";
import { ReviewPresentationRequestSchema } from "@dayframe/shared";
import { authErrorResponse, databaseReadinessResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  getReviewPresentation,
  ReviewPresentationError
} from "@/lib/review-presentation-service";
import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";

export const maxDuration = 15;
export const REVIEW_PRESENTATION_BODY_LIMIT_BYTES = 64 * 1024;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie"
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > REVIEW_PRESENTATION_BODY_LIMIT_BYTES) {
      return privateJson({ error: "Review presentation request is too large." }, 413);
    }
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const body = await readBoundedJson(request);
    const parsed = ReviewPresentationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return privateJson({
        error: "Invalid Review presentation request.",
        issues: parsed.error.issues
      }, 400);
    }
    const presentation = await getReviewPresentation(session, parsed.data, {
      signal: request.signal,
      deadlineAt: startedAt + 8_000
    });
    return privateJson(presentation);
  } catch (error) {
    const readiness = databaseReadinessResponse(error);
    if (readiness) return withPrivateHeaders(readiness);
    const auth = authErrorResponse(error);
    if (auth) return withPrivateHeaders(auth);
    if (error instanceof ReviewPresentationError) {
      return privateJson({ ok: false, code: error.code, error: error.message }, error.status);
    }
    if (error instanceof SyncOperationError) {
      return privateJson({
        ok: false,
        code: "presentation_unavailable",
        error: "Review presentation is temporarily unavailable. Keep your saved Review actions; try refresh later.",
        ...syncFailureMetadata(error)
      }, 503);
    }
    throw error;
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ReviewPresentationError("presentation_unavailable", "Review presentation body is missing.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > REVIEW_PRESENTATION_BODY_LIMIT_BYTES) {
      await reader.cancel();
      const error = new ReviewPresentationError("presentation_unavailable", "Review presentation request is too large.", 413);
      throw error;
    }
    chunks.push(next.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewPresentationError("presentation_unavailable", "Review presentation body must be valid JSON.");
  }
}

function withPrivateHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
  return response;
}
