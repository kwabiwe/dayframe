import crypto from "node:crypto";
import { APP_SESSION_COOKIE, resolveLocalSession } from "./auth/local";
import { query } from "./db";
import { AuthError, getAuthMode, getDevSession, hasScopes, resolveAppSession, type RequestSession } from "./session";

export type ResolveSessionOptions = {
  allowIngestToken?: boolean;
  requiredScopes?: string[];
};

type IntegrationTokenRow = {
  id: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
};

export async function resolveRequestSession(
  request: Request,
  options: ResolveSessionOptions = {}
): Promise<RequestSession> {
  const requiredScopes = options.requiredScopes ?? [];
  const authMode = getAuthMode();
  const bearer = bearerToken(request);
  const ingestHeader = headerToken(request);
  const appCookie = cookieToken(request);
  const appToken = bearer ?? appCookie;

  if (authMode === "dev") {
    if (options.allowIngestToken && (ingestHeader || bearer)) {
      try {
        const tokenSession = await resolveTokenSession(ingestHeader ?? bearer ?? "");
        assertScopes(tokenSession, requiredScopes);
        return tokenSession;
      } catch {
        return scopedSession(getDevSession(), requiredScopes);
      }
    }
    return scopedSession(getDevSession(), requiredScopes);
  }

  if (authMode === "local") {
    if (appToken) {
      const session = await resolveLocalSession(appToken);
      return scopedSession(session, requiredScopes);
    }

    if (options.allowIngestToken && ingestHeader) {
      const tokenSession = await resolveTokenSession(ingestHeader);
      return scopedSession(tokenSession, requiredScopes);
    }

    throw new AuthError("Login required.");
  }

  if (authMode === "provider") {
    if (appToken) {
      const session = await resolveLocalSession(appToken, "provider");
      return scopedSession(session, requiredScopes);
    }

    if (options.allowIngestToken && ingestHeader) {
      const tokenSession = await resolveTokenSession(ingestHeader);
      return scopedSession(tokenSession, requiredScopes);
    }

    throw new AuthError("Login required.");
  }

  const session = resolveAppSession();
  return scopedSession(session, requiredScopes);
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
    `with token as (
       update integration_tokens
       set last_used_at = now()
       where token_hash = $1 and revoked_at is null
       returning id, workspace_id, scopes
     )
     select token.id,
            token.workspace_id as "workspaceId",
            token.scopes,
            owner.user_id as "userId"
     from token
     join lateral (
       select user_id
       from workspace_members
       where workspace_id = token.workspace_id
       order by case role when 'owner' then 0 else 1 end, created_at
       limit 1
     ) owner on true`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) throw new AuthError("Invalid integration token.");

  return {
    userId: row.userId,
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

function cookieToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split("=");
    if (name === APP_SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function scopedSession(session: RequestSession, requiredScopes: string[]) {
  assertScopes(session, requiredScopes);
  return session;
}

function assertScopes(session: RequestSession, requiredScopes: string[]) {
  if (!hasScopes(session, requiredScopes)) throw new AuthError("Session is missing the required scope.");
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
