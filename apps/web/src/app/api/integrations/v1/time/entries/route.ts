import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { isDatabaseReadinessError, isMissingRequiredColumnError } from "@/lib/db";
import {
  decodeIntegrationTimeCursor,
  getIntegrationTimeEntries,
  INTEGRATION_TIME_ENTRIES_DEFAULT_LIMIT,
  INTEGRATION_TIME_ENTRIES_MAX_LIMIT,
  INTEGRATION_TIME_ENTRIES_MAX_RANGE_DAYS
} from "@/lib/integration-time";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      allowBearerIntegrationToken: true,
      requiredScopes: ["time:read"]
    });
    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

    const cursorValue = url.searchParams.get("cursor");
    const cursor = decodeIntegrationTimeCursor(cursorValue);
    if (cursorValue && !cursor) {
      return NextResponse.json({ error: "Use a valid pagination cursor." }, { status: 400 });
    }
    const limit = parseLimit(url.searchParams.get("limit"));
    if (!limit) {
      return NextResponse.json(
        { error: `Limit must be between 1 and ${INTEGRATION_TIME_ENTRIES_MAX_LIMIT}.` },
        { status: 400 }
      );
    }
    const page = await getIntegrationTimeEntries(session, {
      ...range.value,
      limit,
      cursor
    });
    return NextResponse.json(page);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Dayframe integration time entries failed", error);
    return NextResponse.json({ error: "Unable to load logged time entries." }, { status: 500 });
  }
}

function parseRange(fromValue: string | null, toValue: string | null) {
  if (!fromValue || !toValue) {
    return { ok: false as const, error: "Provide ISO-8601 from and to timestamps." };
  }
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { ok: false as const, error: "Provide valid ISO-8601 from and to timestamps." };
  }
  if (fromMs >= toMs) {
    return { ok: false as const, error: "The from timestamp must be earlier than to." };
  }
  if (toMs - fromMs > INTEGRATION_TIME_ENTRIES_MAX_RANGE_DAYS * 86_400_000) {
    return {
      ok: false as const,
      error: `Time-entry ranges cannot exceed ${INTEGRATION_TIME_ENTRIES_MAX_RANGE_DAYS} days.`
    };
  }
  return {
    ok: true as const,
    value: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString()
    }
  };
}

function parseLimit(value: string | null) {
  if (!value) return INTEGRATION_TIME_ENTRIES_DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= INTEGRATION_TIME_ENTRIES_MAX_LIMIT ? limit : null;
}
