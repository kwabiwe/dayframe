import crypto from "node:crypto";
import { query } from "./db";
import { AuthError, getAuthMode, getDevSession, hasScopes, resolveAppSession, type RequestSession } from "./session";

export type ResolveSessionOptions = {
  allowIngestToken?: boolean;
  requiredScopes?: string[];
};

type IntegrationTokenRow = {
  id: string;
  workspaceId: string;
  scopes: string[];
};

export async function resolveRequestSession(
  request: Request,
  options: ResolveSessionOptions = {}
): Promise<RequestSession> {
  const requiredScopes = options.requiredScopes ?? [];
  const token = bearerToken(request) ?? headerToken(request);

  if (options.allowIngestToken && token) {
    const tokenSession = await resolveTokenSession(token);
    if (!hasScopes(tokenSession, requiredScopes)) {
      throw new AuthError("Token is missing the required scope.");
    }
    return tokenSession;
  }

  const mode = getAuthMode();
  const session = mode === "dev" ? getDevSession() : resolveAppSession();
  if (!hasScopes(session, requiredScopes)) throw new AuthError("Session is missing the required scope.");
  return session;
}

export function hashIntegrationToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

async function resolveTokenSession(token: string): Promise<RequestSession> {
  const envToken = process.env.DAYFRAME_INGEST_TOKEN;
  if (envToken && timingSafeEqual(token, envToken)) {
    return {
      ...getDevSession(),
      authMode: "token",
      scopes: ["events:write", "events:read", "toggl:import", "exports:read"]
    };
  }

  const tokenHash = hashIntegrationToken(token);
  const result = await query<IntegrationTokenRow>(
    `update integration_tokens
     set last_used_at = now()
     where token_hash = $1 and revoked_at is null
     returning id, workspace_id as "workspaceId", scopes`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) throw new AuthError("Invalid integration token.");

  return {
    userId: getDevSession().userId,
    workspaceId: row.workspaceId,
    authMode: "token",
    scopes: row.scopes
  };
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice("bearer ".length).trim();
}

function headerToken(request: Request) {
  return request.headers.get("x-dayframe-ingest-token")?.trim() || null;
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
