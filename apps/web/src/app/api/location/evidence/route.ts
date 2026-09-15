import { locationRequestDiagnostics } from "@/lib/location/location-sync-diagnostics";
import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isLockNotAvailableError, isStatementTimeoutError, query } from "@/lib/db";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  ingestLocationEvidence,
  LOCATION_EVIDENCE_BODY_LIMIT_BYTES,
  LocationIngestError
} from "@/lib/location/location-ingest-service";

const PRIVATE_LOCATION_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie"
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_LOCATION_HEADERS });
}

export const maxDuration = 15;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const diagnostics = locationRequestDiagnostics("evidence", startedAt);
  const respond = (body: Record<string, unknown>, status = 200, error?: unknown) =>
    diagnostics.finish(privateJson(body, status), error, status >= 400 ? body : undefined);
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return respond({ error: "Location evidence batch is too large." }, 413);
    }
    const session = await resolveRequestSession(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return respond({ error: "Location evidence batch is too large." }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return respond({ error: "Location evidence body must be valid JSON." }, 400);
    }
    const result = await ingestLocationEvidence(body, session, undefined, {signal: request.signal, deadlineAt: startedAt + 8_000, onLocationStage: diagnostics.onLocationStage});
    return respond(result, result.duplicateBatch ? 200 : 201);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) authResponse.headers.set(key, value);
      return diagnostics.finish(authResponse, error);
    }
    if (error instanceof LocationIngestError) {
      return respond({ error: error.message, code: error.code }, error.status, error);
    }
    if (error instanceof ZodError) {
      return respond({ error: "Invalid location evidence batch." }, 400);
    }
    if (isLockNotAvailableError(error) || isStatementTimeoutError(error) || error instanceof SyncOperationError) {
      return respond({
        error: "Location processing is busy. The saved evidence will retry automatically.",
        code: "location_processing_busy",
        ...syncFailureMetadata(error),
        ...(isLockNotAvailableError(error) ? { reason: "lock_unavailable" } : {}),
        retryAfterMs: 5_000
      }, 503, error);
    }
    return respond({ error: "Unable to sync location evidence." }, 500, error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const result = await query(
      `delete from location_evidence
       where workspace_id = $1 and user_id = $2`,
      [session.workspaceId, session.userId]
    );
    return privateJson({ ok: true, deletedEvidenceCount: result.rowCount ?? 0 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) authResponse.headers.set(key, value);
      return authResponse;
    }
    console.error("Location evidence deletion failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return privateJson({ error: "Unable to delete recent location evidence." }, 500);
  }
}
