import { NextResponse } from "next/server";
import { authErrorResponse } from "./api-errors";
import { isDatabaseReadinessError, isMissingRequiredColumnError } from "./db";
import { resolveRequestSession } from "./ingest-auth";
import type { RequestSession } from "./session";

/** A 400 reply with a plain-language reason; thrown by parameter parsers inside `integrationGet`. */
export class IntegrationParamError extends Error {}

/**
 * One read-only integration GET: a bearer integration token (or the local ingest token) with every
 * scope in `scopes`, then `handler`. Replies are never cached; failures never echo SQL or payloads.
 */
export async function integrationGet(
  request: Request,
  scopes: string[],
  failureMessage: string,
  handler: (session: RequestSession, url: URL) => Promise<unknown>
) {
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      allowBearerIntegrationToken: true,
      requiredScopes: scopes
    });
    const body = await handler(session, new URL(request.url));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof IntegrationParamError) return NextResponse.json({ error: error.message }, { status: 400 });
    const response = authErrorResponse(error);
    if (response) return response;
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error(`Dayframe integration read failed: ${failureMessage}`, error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: failureMessage }, { status: 500 });
  }
}

/** A whole-number parameter in [min, max], or `fallback` when absent. */
export function intParam(url: URL, name: string, fallback: number, min: number, max: number) {
  const value = url.searchParams.get(name);
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new IntegrationParamError(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return Number(value);
}

/** Required ISO-8601 `from`/`to`, `from` before `to`, at most `maxDays` apart. */
export function rangeParams(url: URL, maxDays: number) {
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  if (!fromValue || !toValue) throw new IntegrationParamError("Provide ISO-8601 from and to timestamps.");
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new IntegrationParamError("Provide valid ISO-8601 from and to timestamps.");
  if (fromMs >= toMs) throw new IntegrationParamError("The from timestamp must be earlier than to.");
  if (toMs - fromMs > maxDays * 86_400_000) throw new IntegrationParamError(`Ranges cannot exceed ${maxDays} days.`);
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}
