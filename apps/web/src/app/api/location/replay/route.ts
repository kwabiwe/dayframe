import { locationRequestDiagnostics } from "@/lib/location/location-sync-diagnostics";
import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { isLockNotAvailableError, isStatementTimeoutError } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  LOCATION_EVIDENCE_BODY_LIMIT_BYTES,
  LocationIngestError,
  replayRetainedLocationEvidence
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
  const diagnostics = locationRequestDiagnostics("replay", startedAt);
  const respond = (body: Record<string, unknown>, status = 200, error?: unknown) =>
    diagnostics.finish(privateJson(body, status), error, status >= 400 ? body : undefined);
  try {
    diagnostics.onLocationTiming({ stage: "request_setup", state: "started" });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      diagnostics.onLocationTiming({ stage: "request_setup", state: "completed" });
      return respond({ error: "Location replay request is too large." }, 413);
    }
    diagnostics.onLocationTiming({ stage: "request_setup", state: "completed" });
    diagnostics.onLocationTiming({ stage: "request_auth", state: "started" });
    const session = await resolveRequestSession(request);
    diagnostics.onLocationTiming({ stage: "request_auth", state: "completed" });
    diagnostics.onLocationTiming({ stage: "request_body", state: "started" });
    const requestText = await request.text();
    if (new TextEncoder().encode(requestText).byteLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      diagnostics.onLocationTiming({ stage: "request_body", state: "completed" });
      return respond({ error: "Location replay request is too large." }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(requestText);
    } catch {
      diagnostics.onLocationTiming({ stage: "request_body", state: "completed" });
      return respond({ error: "Location replay body must be valid JSON." }, 400);
    }
    diagnostics.onLocationTiming({ stage: "request_body", state: "completed" });
    const result = await replayRetainedLocationEvidence(body, session, undefined, {
      signal: request.signal,
      deadlineAt: startedAt + 8_000,
      onLocationStage: diagnostics.onLocationStage,
      onLocationTiming: diagnostics.onLocationTiming,
      onLocationCount: diagnostics.onLocationCount,
      onSyncTiming: diagnostics.onSyncTiming
    });
    return respond(result);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) {
        authResponse.headers.set(key, value);
      }
      return diagnostics.finish(authResponse, error);
    }
    if (error instanceof LocationIngestError) {
      return respond({ error: error.message, code: error.code }, error.status, error);
    }
    if (error instanceof ZodError) {
      return respond({ error: "Invalid location replay request." }, 400);
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
    return respond({ error: "Unable to replay retained location evidence." }, 500, error);
  }
}
