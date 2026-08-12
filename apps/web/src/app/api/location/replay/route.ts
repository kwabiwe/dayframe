import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
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

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return privateJson({ error: "Location replay request is too large." }, 413);
    }
    const session = await resolveRequestSession(request);
    const requestText = await request.text();
    if (new TextEncoder().encode(requestText).byteLength > LOCATION_EVIDENCE_BODY_LIMIT_BYTES) {
      return privateJson({ error: "Location replay request is too large." }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(requestText);
    } catch {
      return privateJson({ error: "Location replay body must be valid JSON." }, 400);
    }
    const result = await replayRetainedLocationEvidence(body, session);
    return privateJson(result);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      for (const [key, value] of Object.entries(PRIVATE_LOCATION_HEADERS)) {
        authResponse.headers.set(key, value);
      }
      return authResponse;
    }
    if (error instanceof LocationIngestError) {
      return privateJson({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof ZodError) {
      return privateJson({ error: "Invalid location replay request.", issues: error.issues }, 400);
    }
    console.error("Location replay failed without coordinate payloads", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return privateJson({ error: "Unable to replay retained location evidence." }, 500);
  }
}
