import crypto from "node:crypto";
import { APP_SESSION_COOKIE, inspectLocalSession } from "./auth/local";
import { query } from "./db";
import {
  AuthError,
  devWorkspaceIdFromCookieHeader,
  getAuthMode,
  getDevSession,
  hasScopes,
  resolveAppSession,
  sessionAuthError,
  type RequestSession,
  type SessionReasonCode
} from "./session";

export type ResolveSessionOptions = {
  allowIngestToken?: boolean;
  allowBearerIntegrationToken?: boolean;
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
    return scopedSession(getDevSession(devWorkspaceIdFromCookieHeader(request.headers.get("cookie"))), requiredScopes);
  }

  if (authMode === "local") {
    if (options.allowIngestToken && options.allowBearerIntegrationToken && bearer) {
      return resolveBearerIntegrationOrAppSession(request, bearer, requiredScopes, "local");
    }

    if (appToken) {
      const session = await resolveAppTokenSession(request, appToken, "local");
      return scopedSession(session, requiredScopes);
    }

    if (options.allowIngestToken && ingestHeader) {
      const tokenSession = await resolveTokenSession(ingestHeader);
      return scopedSession(tokenSession, requiredScopes);
    }

    logSessionDiagnostic(request, "session_cookie_missing");
    throw sessionAuthError("session_cookie_missing");
  }

  if (authMode === "provider") {
    if (options.allowIngestToken && options.allowBearerIntegrationToken && bearer) {
      return resolveBearerIntegrationOrAppSession(request, bearer, requiredScopes, "provider");
    }

    if (appToken) {
      const session = await resolveAppTokenSession(request, appToken, "provider");
      return scopedSession(session, requiredScopes);
    }

    if (options.allowIngestToken && ingestHeader) {
      const tokenSession = await resolveTokenSession(ingestHeader);
      return scopedSession(tokenSession, requiredScopes);
    }

    logSessionDiagnostic(request, "session_cookie_missing");
    throw sessionAuthError("session_cookie_missing");
  }

  const session = resolveAppSession();
  return scopedSession(session, requiredScopes);
}

async function resolveBearerIntegrationOrAppSession(
  request: Request,
  bearer: string,
  requiredScopes: string[],
  authMode: "local" | "provider"
) {
  try {
    const tokenSession = await resolveTokenSession(bearer);
    return scopedSession(tokenSession, requiredScopes);
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== "integration_token_invalid") {
      throw error;
    }
  }

  const session = await resolveAppTokenSession(request, bearer, authMode);
  return scopedSession(session, requiredScopes);
}

async function resolveAppTokenSession(
  request: Request,
  token: string,
  authMode: "local" | "provider"
) {
  const resolution = await inspectLocalSession(token, authMode);
  logSessionDiagnostic(request, resolution.reason);
  if (resolution.reason !== "session_valid") throw sessionAuthError(resolution.reason);
  return resolution.session;
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
      scopes: ["events:write", "events:read", "time:read", "exports:read"]
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
  if (!row) {
    throw new AuthError(
      "Invalid integration token.",
      401,
      "integration_token_invalid"
    );
  }

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
  if (!hasScopes(session, requiredScopes)) {
    throw new AuthError(
      "Session is missing the required scope.",
      403,
      "insufficient_scope"
    );
  }
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function logSessionDiagnostic(request: Request, reason: SessionReasonCode) {
  const url = new URL(request.url);
  console.info("Dayframe auth session", {
    reason,
    pathname: url.pathname,
    method: request.method,
    deploymentEnvironment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    cookiePresent: Boolean(cookieToken(request)),
    timestamp: new Date().toISOString(),
    requestCorrelationId: crypto.randomUUID()
  });
}
