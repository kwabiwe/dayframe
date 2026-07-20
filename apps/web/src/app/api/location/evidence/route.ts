import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { query } from "@/lib/db";
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

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return privateJson({ error: "Location evidence batch is too large." }, 413);
    }
    const session = await resolveRequestSession(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return privateJson({ error: "Location evidence batch is too large." }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return privateJson({ error: "Location evidence body must be valid JSON." }, 400);
    }
    const result = await ingestLocationEvidence(body, session);
    return privateJson(result, result.duplicateBatch ? 200 : 201);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) authResponse.headers.set(key, value);
      return authResponse;
    }
    if (error instanceof LocationIngestError) {
      return privateJson({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof ZodError) {
      return privateJson({ error: "Invalid location evidence batch.", issues: error.issues }, 400);
    }
    console.error("Location evidence sync failed without coordinate payloads", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return privateJson({ error: "Unable to sync location evidence." }, 500);
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
